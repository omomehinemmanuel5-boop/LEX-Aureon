/**
 * Lex CRS Agent — Agentic Loop
 * Orchestrates tool calls until the agent produces a final answer.
 * Max 15 iterations to prevent runaway loops.
 */

import { callLLM, Message, ModelId } from './router';
import { TOOL_REGISTRY } from './tools';

export interface AgentStep {
  type:    'thought' | 'tool_call' | 'tool_result' | 'answer';
  content: string;
  tool?:   string;
  model?:  ModelId;
}

export interface AgentResult {
  answer:   string;
  steps:    AgentStep[];
  model:    ModelId;
  turns:    number;
}

const SYSTEM = [
  'You are Lex CRS Agent — an AI coding agent with full access to the Lexaureon constitutional AI codebase.',
  '',
  'You have tools to:',
  '- Read and write files in the GitHub repository',
  '- Search the codebase',
  '- Check build status',
  '- Query the live Turso database',
  '- Run prompts through the PRAXIS constitutional pipeline',
  '- Get constitutional health state',
  '',
  'OPERATING PRINCIPLES:',
  '1. Always read the relevant file before modifying it.',
  '2. Check build status after committing code.',
  '3. Use search_code to find where something is before reading it.',
  '4. Use query_database only for SELECT queries.',
  '5. Write precise, minimal commit messages.',
  '6. When the task is complete, summarise what you did clearly.',
  '',
  'The codebase is Lexaureon — a constitutional AI governance system.',
  'C + R + S = 1. The constitutional pipeline is your home.',
].join('\n');

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
      return { answer, steps, model: lastModel, turns };
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

      const callStep: AgentStep = {
        type:    'tool_call',
        content: `${toolName}(${JSON.stringify(args)})`,
        tool:    toolName,
        model:   response.model,
      };
      steps.push(callStep);
      onStep?.(callStep);

      let result: string;
      const toolFn = TOOL_REGISTRY[toolName];
      if (!toolFn) {
        result = `Error: unknown tool "${toolName}"`;
      } else {
        try   { result = await toolFn(args); }
        catch (e) { result = `Error: ${String(e)}`; }
      }

      const resultStep: AgentStep = { type: 'tool_result', content: result, tool: toolName };
      steps.push(resultStep);
      onStep?.(resultStep);

      // Push tool result back into messages
      messages.push({
        role:    'tool',
        content: result,
        name:    tc.id,
      });
    }
  }

  const answer = 'Max iterations reached. Task may be incomplete.';
  steps.push({ type: 'answer', content: answer });
  return { answer, steps, model: lastModel, turns };
}
