/**
 * Keep the inner governance cycle on the same session as its governed tool call.
 * Other tool arguments are left untouched because they may have their own
 * session semantics or approval-token hashes.
 */
export function bindGovernanceToolSession(
  toolName: string,
  args: Record<string, unknown>,
  sessionId: string,
): Record<string, unknown> {
  if (toolName !== 'run_governance') return args;
  return { ...args, session_id: sessionId };
}
