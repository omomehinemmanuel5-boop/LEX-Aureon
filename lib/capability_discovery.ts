import { TOOL_DEFINITIONS } from './lex_crs_agent/tools';

/**
 * Returns a summary of the system's current capabilities.
 */
export function getCapabilitiesSummary(): string {
  const toolNames = TOOL_DEFINITIONS.map(t => t.name);
  const toolCount = toolNames.length;
  
  return `Capabilities: Lex Aureon is equipped with ${toolCount} specialized tools for cyber reasoning, including: ${toolNames.join(', ')}. These tools allow for code analysis, repository management, database querying, and GitHub Actions orchestration.`;
}

/**
 * Returns detailed capability information for dynamic identity injection.
 */
export function getDetailedCapabilities(): string {
  return TOOL_DEFINITIONS.map(t => `- ${t.name}: ${t.description}`).join('\n');
}
