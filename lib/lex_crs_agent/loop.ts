/**
 * Lex CRS Agent — Agentic Loop
 *
 * Every tool execution in the internal agent loop passes through the same
 * constitutional executor used by the MCP endpoint. Read-only results may use
 * authorization-checked execution caching; consequential tools are never
 * cached. This keeps the internal loop and external MCP surface aligned.
 */

import { callLLM, Message, ModelId } from './router';
import { TOOL_REGISTRY } from './tools';
import { patch_file } from './tools/patch_file';
import { executeGovernedTool } from '../agents/constitutional_tool_executor';

export interface AgentStep {
  type: 'thought' | 'tool_call' | 'tool_result' | 'answer';
  content: string;
  tool?: string;
  model?: ModelId;
  truncated?: boolean;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
  model: ModelId;
  turns: number;
  stop_reason?: 'answer' | 'max_turns' | 'repeated_tool_call';
}

const TOOL_RESULT_BUDGET = 12_000;
const MAX_REPEATED_CALLS = 2;

function clipForContext(text: string): { text: string; truncated: boolean } {
  if (text.length <= TOOL_RESULT_BUDGET) return { text, truncated: false };
  const half = Math.floor((TOOL_RESULT_BUDGET - 200) / 2);
  const omitted = text.length - half * 2;
  return {
    truncated: true,
    text:
      text.slice(0, half) +
      `\n\n…[${omitted} characters omitted by the agent loop's context budget. ` +
      `You are NOT seeing this whole result. Narrow the request rather than ` +
      `assuming the content above is complete.]…\n\n` +
      text.slice(-half),
  };
}

const SYSTEM = [
  'You are Lex CRS Agent — an AI coding agent with full access to the Lexaureon constitutional AI codebase.',
  '',
  'You have tools to read files, edit them, search the codebase, check builds, query the live database, run the PRAXIS constitutional pipeline, and inspect constitutional health.',
  '',
  'OPERATING PRINCIPLES:',
  '1. Always read the relevant file before modifying it.',
  '2. To edit an existing file, use patch_file for surgical edits and write_file for new files.',
  '3. patch_file requires an exact, unique old_str. Prefer dry_run:true for non-trivial patches.',
  '4. Check build status after committing code.',
  '5. Use search_code before reading a symbol or path when possible.',
  '6. Use query_database only for SELECT queries.',
  '7. Write precise, minimal commit messages.',
  '8. If the same tool call fails twice, change approach rather than repeating it.',
  '9. State plainly anything you could not verify rather than implying success.',
  '',
  'The codebase is Lexaureon — a constitutional AI governance system.',
  'C + R + S = 1. The constitutional pipeline is your home.',
].join('\n');

/**
 * Internal-loop tool registry. Unlike the previous implementation, this does
 * not spread raw TOOL_REGISTRY functions into the loop. Every main-suite tool
 * is wrapped by executeGovernedTool, and patch_file is added through the same
 * wrapper. This makes the internal agent loop subject to the same authorization
 * boundary as the public MCP dispatcher.
 */
const LOOP_TOOLS: Record<string, (a: Record<string, unknown>) => Promise<string>> = {
  ...Object.fromEntries(
    Object.entries(TOOL_REGISTRY).map(([name, fn]) => [
      name,
      (args: Record<string, unknown>) => executeGovernedTool(
        name,
        args,
        fn as (args: Record<string, unknown>) => Promise<string>,
        (args.session_id as string | undefined) ?? `agent-${new Date().toISOString().slice(0, 10)}`,
        args.task_context as string | undefined,
      ),
    ])
  ),
  patch_file: (args: Record<string, unknown>) => executeGovernedTool(
    'patch_file',
    args,
    (a) => patch_file(a as unknown as Parameters<typeof patch_file>[0]),
    (args.session_id as string | undefined) ?? `agent-${new Date().toISOString().slice(0, 10)}`,
    args.task_context as string | undefined,
  ),
};

export async function runAgentLoop(
  task: string,
  model?: ModelId,
  onStep?: (step: AgentStep) => void,
): Promise<AgentResult> {
  const messages: Message[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: task },
  ];

  const steps: AgentStep[] = [];
  let turns = 0;
  let lastModel: ModelId = 'groq-70b';
  const MAX_TURNS = 15;
  let lastSignature = '';
  let repeatCount = 0;

  while (turns < MAX_TURNS) {
    turns++;
    const response = await callLLM(messages, model);
    lastModel = response.model;

    if (!response.tool_calls.length) {
      const answer = response.content ?? 'No response generated.';
      const step: AgentStep = { type: 'answer', content: answer, model: response.model };
      steps.push(step);
      onStep?.(step);
      return { answer, steps, model: lastModel, turns, stop_reason: 'answer' };
    }

    messages.push({
      role: 'assistant',
      content: response.content ?? '',
      tool_calls: response.tool_calls,
    });

    for (const tc of response.tool_calls) {
      const toolName = tc.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        // Empty args are passed through the governed boundary and reported as a tool error.
      }

      const signature = `${toolName}:${JSON.stringify(args)}`;
      if (signature === lastSignature) repeatCount++;
      else {
        lastSignature = signature;
        repeatCount = 0;
      }

      if (repeatCount >= MAX_REPEATED_CALLS) {
        const answer =
          `Stopped: the same call was issued ${repeatCount + 1} times in a row ` +
          `without the result changing — ${toolName}(${JSON.stringify(args)}). ` +
          `This is a loop, not progress, so the remaining turns were not spent re-confirming it.`;
        const step: AgentStep = { type: 'answer', content: answer, model: response.model };
        steps.push(step);
        onStep?.(step);
        return { answer, steps, model: lastModel, turns, stop_reason: 'repeated_tool_call' };
      }

      const callStep: AgentStep = {
        type: 'tool_call',
        content: `${toolName}(${JSON.stringify(args)})`,
        tool: toolName,
        model: response.model,
      };
      steps.push(callStep);
      onStep?.(callStep);

      let result: string;
      const toolFn = LOOP_TOOLS[toolName];
      if (!toolFn) {
        result = `Error: unknown tool "${toolName}". Available: ${Object.keys(LOOP_TOOLS).join(', ')}`;
      } else {
        try {
          result = await toolFn(args);
        } catch (e) {
          result = `Error: ${String(e)}`;
        }
      }

      const clipped = clipForContext(result);
      const resultStep: AgentStep = {
        type: 'tool_result',
        content: result,
        tool: toolName,
        ...(clipped.truncated ? { truncated: true } : {}),
      };
      steps.push(resultStep);
      onStep?.(resultStep);

      messages.push({
        role: 'tool',
        content: clipped.text,
        name: tc.id,
      });
    }
  }

  const answer =
    `Stopped: reached the ${MAX_TURNS}-turn ceiling without producing a final answer, ` +
    `so the task is probably incomplete. The steps above are partial work, not a finished result.`;
  steps.push({ type: 'answer', content: answer });
  return { answer, steps, model: lastModel, turns, stop_reason: 'max_turns' };
}
