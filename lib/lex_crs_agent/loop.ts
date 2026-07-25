/**
 * Lex CRS Agent — Agentic Loop
 * Orchestrates tool calls until the agent produces a final answer.
 *
 * fix (2026-07-25) — three defects that made long tasks fail silently:
 *
 * 1. UNBOUNDED TOOL RESULTS (the serious one). Every tool result was pushed
 *    into `messages` verbatim and `messages` is resent on every turn. A single
 *    read_file on app/chat/page.tsx injects 81,378 characters (~22k tokens);
 *    two such reads plus a search_code exceed most of the chain's context
 *    windows outright. The loop then either got a provider error it reported as
 *    a tool failure, or silently lost the head of the conversation — including
 *    the system prompt and original task. Symptom: the agent "forgets" the task
 *    partway through a multi-file job. Results are now clipped to a per-result
 *    budget with an explicit, visible marker so the model knows truncation
 *    happened rather than assuming it saw the whole file. The full untruncated
 *    text is still surfaced in `steps` for the UI, so nothing is hidden from
 *    the human — only from the resent context.
 *
 * 2. NO LOOP DETECTION. MAX_TURNS=15 was the only stop condition, so an agent
 *    that kept reissuing an identical failing call burned all 15 turns and its
 *    entire quota to arrive at the same error. Identical consecutive
 *    (tool, args) signatures now abort with a diagnostic that names the stuck
 *    call, which is far more actionable than "Max iterations reached".
 *
 * 3. NO SURGICAL EDIT TOOL. TOOL_REGISTRY (lib/lex_crs_agent/tools.ts) exposes
 *    only write_file, a whole-file GitHub Contents API PUT. For any large file
 *    that is a reconstruction job: the agent must hold the entire file in
 *    context and re-emit it, which for page.tsx does not fit alongside the
 *    conversation — the read starves the write. patch_file (exact-match
 *    replacement with a differential TypeScript parse gate) already existed but
 *    was registered only on the MCP route, so the internal loop could not
 *    reach it. Merged in here, and the system prompt now teaches the
 *    preference explicitly.
 */

import { callLLM, Message, ModelId } from './router';
import { TOOL_REGISTRY } from './tools';
import { patch_file } from './tools/patch_file';

export interface AgentStep {
  type:    'thought' | 'tool_call' | 'tool_result' | 'answer';
  content: string;
  tool?:   string;
  model?:  ModelId;
  /** True when this result was clipped before being resent as context. The UI
   *  still receives the full text in `content`; only the model saw less. */
  truncated?: boolean;
}

export interface AgentResult {
  answer:   string;
  steps:    AgentStep[];
  model:    ModelId;
  turns:    number;
  /** Why the loop stopped. 'answer' is the healthy path; the other two are
   *  failure modes worth surfacing rather than dressing up as an answer. */
  stop_reason?: 'answer' | 'max_turns' | 'repeated_tool_call';
}

/**
 * Per-result context budget, in characters. Chosen so several reads can
 * coexist with the system prompt and task inside a ~128k-token window with
 * room for the model's own output: 12k chars is roughly 3k tokens, so even
 * fifteen full-budget results stay near 45k tokens of tool context. Generous
 * enough that ordinary reads (a typical module is well under this) pass
 * through completely untouched.
 */
const TOOL_RESULT_BUDGET = 12_000;

/** Consecutive identical calls tolerated before declaring the agent stuck. Two
 *  is deliberate: one repeat can be a legitimate retry after a transient
 *  provider error, three is a loop. */
const MAX_REPEATED_CALLS = 2;

/**
 * Clip a tool result for resending as context. Keeps the head AND the tail,
 * because the informative part of a long result is at either end — a file's
 * imports and its exports, a log's start and its error — and a naive head-only
 * clip reliably discards the failure message that motivated the read.
 */
function clipForContext(text: string): { text: string; truncated: boolean } {
  if (text.length <= TOOL_RESULT_BUDGET) return { text, truncated: false };
  const half = Math.floor((TOOL_RESULT_BUDGET - 200) / 2);
  const omitted = text.length - half * 2;
  return {
    truncated: true,
    text:
      text.slice(0, half) +
      `\n\n…[${omitted} characters omitted by the agent loop's context budget. ` +
      `You are NOT seeing this whole result. To inspect the omitted region, ` +
      `narrow the request — search_code for a specific symbol, or read a ` +
      `smaller path — rather than assuming the content above is complete.]…\n\n` +
      text.slice(-half),
  };
}

const SYSTEM = [
  'You are Lex CRS Agent — an AI coding agent with full access to the Lexaureon constitutional AI codebase.',
  '',
  'You have tools to:',
  '- Read files, and edit them (patch_file for surgical edits, write_file for new files)',
  '- Search the codebase',
  '- Check build status',
  '- Query the live Turso database',
  '- Run prompts through the PRAXIS constitutional pipeline',
  '- Get constitutional health state',
  '',
  'OPERATING PRINCIPLES:',
  '1. Always read the relevant file before modifying it.',
  '2. To EDIT an existing file, use patch_file, not write_file. write_file',
  '   replaces the entire file, so using it on a large file means reproducing',
  '   every line perfectly — which will not fit in context and risks silently',
  '   truncating real code. patch_file replaces one exact matched region and',
  '   refuses ambiguous matches. Reserve write_file for files you are creating.',
  '3. patch_file requires old_str to match the file byte-for-byte, including',
  '   indentation, and to be unique. If it reports 0 matches, re-read the exact',
  '   region rather than guessing at whitespace. If it reports >1, extend',
  '   old_str with surrounding context.',
  '4. Prefer dry_run:true on any non-trivial patch to confirm the match count',
  '   and the parse-gate verdict before committing.',
  '5. Check build status after committing code.',
  '6. Use search_code to find where something is before reading it. Long',
  '   results are clipped before you see them — if you notice an omission',
  '   marker, narrow your query instead of assuming you saw everything.',
  '7. Use query_database only for SELECT queries.',
  '8. Write precise, minimal commit messages.',
  '9. If the same tool call fails twice, change approach — do not reissue it.',
  '10. When the task is complete, summarise what you did clearly, and state',
  '    plainly anything you could not verify rather than implying success.',
  '',
  'The codebase is Lexaureon — a constitutional AI governance system.',
  'C + R + S = 1. The constitutional pipeline is your home.',
].join('\n');

/** Main-suite tools plus the extension tools the MCP route also serves, so the
 *  internal loop and the external MCP client expose the same capabilities. */
const LOOP_TOOLS: Record<string, (a: Record<string, unknown>) => Promise<string>> = {
  ...(TOOL_REGISTRY as Record<string, (a: Record<string, unknown>) => Promise<string>>),
  patch_file: (a) => patch_file(a as unknown as Parameters<typeof patch_file>[0]),
};

export async function runAgentLoop(
  task:    string,
  model?:  ModelId,
  onStep?: (step: AgentStep) => void,
): Promise<AgentResult> {
  const messages: Message[] = [
    { role: 'system',  content: SYSTEM },
    { role: 'user',    content: task },
  ];

  const steps: AgentStep[] = [];
  let   turns = 0;
  let   lastModel: ModelId = 'groq-70b';
  const MAX_TURNS = 15;

  // Loop detection state: signature of the most recent call and how many times
  // it has repeated back-to-back.
  let lastSignature = '';
  let repeatCount   = 0;

  while (turns < MAX_TURNS) {
    turns++;
    const response = await callLLM(messages, model);
    lastModel = response.model;

    // No tool calls — final answer
    if (!response.tool_calls.length) {
      const answer = response.content ?? 'No response generated.';
      const step: AgentStep = { type: 'answer', content: answer, model: response.model };
      steps.push(step);
      onStep?.(step);
      return { answer, steps, model: lastModel, turns, stop_reason: 'answer' };
    }

    // Has tool calls — push assistant message and execute tools
    messages.push({
      role:       'assistant',
      content:    response.content ?? '',
      tool_calls: response.tool_calls,
    });

    for (const tc of response.tool_calls) {
      const toolName = tc.function.name;
      let   args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { /* empty args */ }

      // Signature is (tool, exact args). A repeated identical signature means
      // the agent is not learning from the result it already saw.
      const signature = `${toolName}:${JSON.stringify(args)}`;
      if (signature === lastSignature) repeatCount++;
      else { lastSignature = signature; repeatCount = 0; }

      if (repeatCount >= MAX_REPEATED_CALLS) {
        const answer =
          `Stopped: the same call was issued ${repeatCount + 1} times in a row ` +
          `without the result changing — ${toolName}(${JSON.stringify(args)}). ` +
          `This is a loop, not progress, so the remaining turns were not spent ` +
          `re-confirming it. Re-run with a different approach to this step.`;
        const step: AgentStep = { type: 'answer', content: answer, model: response.model };
        steps.push(step);
        onStep?.(step);
        return { answer, steps, model: lastModel, turns, stop_reason: 'repeated_tool_call' };
      }

      const callStep: AgentStep = {
        type:    'tool_call',
        content: `${toolName}(${JSON.stringify(args)})`,
        tool:    toolName,
        model:   response.model,
      };
      steps.push(callStep);
      onStep?.(callStep);

      let result: string;
      const toolFn = LOOP_TOOLS[toolName];
      if (!toolFn) {
        result = `Error: unknown tool "${toolName}". Available: ${Object.keys(LOOP_TOOLS).join(', ')}`;
      } else {
        try   { result = await toolFn(args); }
        catch (e) { result = `Error: ${String(e)}`; }
      }

      // The human-facing step keeps the FULL result; only the resent context is
      // clipped. Truncating what the UI shows would hide real output.
      const clipped = clipForContext(result);
      const resultStep: AgentStep = {
        type: 'tool_result', content: result, tool: toolName,
        ...(clipped.truncated ? { truncated: true } : {}),
      };
      steps.push(resultStep);
      onStep?.(resultStep);

      messages.push({
        role:    'tool',
        content: clipped.text,
        name:    tc.id,
      });
    }
  }

  const answer =
    `Stopped: reached the ${MAX_TURNS}-turn ceiling without producing a final ` +
    `answer, so the task is probably incomplete. The steps taken are listed ` +
    `above — treat them as partial work, not a finished result.`;
  steps.push({ type: 'answer', content: answer });
  return { answer, steps, model: lastModel, turns, stop_reason: 'max_turns' };
}
