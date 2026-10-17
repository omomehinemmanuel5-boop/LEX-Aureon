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
  // Both the inner governance cycle and its canonical-state diagnostic must use
  // the same resolved session as the outer executor, including operator-secret
  // callers that did not explicitly supply session_id.
  if (toolName === 'run_governance' || toolName === 'get_constitutional_state') {
    return { ...args, session_id: sessionId };
  }
  return args;
}
