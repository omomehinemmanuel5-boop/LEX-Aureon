/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE VII — StyleAgent (Canonical Filter)
 * Constitutional role: Ensures final output adheres to canonical style guidelines.
 * Cannot: govern, measure CRS, modify constitutional decisions, or sign receipts.
 * Ensures output is free of jargon, markdown, and maintains a consistent tone.
 * ═══════════════════════════════════════════════════════════════
 */

import { AgentContext, AgentResult } from './types';

export async function StyleAgent(ctx: AgentContext): Promise<AgentResult> {
  const t = Date.now();
  let cleanedOutput = ctx.governed_output ?? ctx.raw_output ?? '';

  // 1. Remove markdown emphasis (asterisks, underscores)
  cleanedOutput = cleanedOutput.replace(/\*\*?|__/g, '');

  // 2. Remove any remaining governance jargon (e.g., "Constitutional Triad", "Lyapunov", "CBF")
  const jargonPatterns = [
    /Constitutional Triad/gi,
    /Lyapunov/gi,
    /CBF/gi,
    /SovereignKernel/gi,
    /health band/gi,
    /pillar score/gi,
    /M score/gi,
    /governance framework/gi,
    /constitutional state/gi,
    /Vaulturex/gi,
    /PRAXIS/gi,
    /Neithra/gi,
    /ClauseBank/gi,
    /Celeste/gi,
    /AuditorAgent/gi,
    /RawForge/gi,
    /CRSExtractor/gi,
    /GovernorAgent/gi,
    /InterventionAgent/gi,
  ];

  jargonPatterns.forEach(pattern => {
    cleanedOutput = cleanedOutput.replace(pattern, '');
  });

  // 3. Clean up any double spaces or awkward punctuation left behind
  cleanedOutput = cleanedOutput.replace(/\s{2,}/g, ' ').trim();
  cleanedOutput = cleanedOutput.replace(/ ,/g, ',');
  cleanedOutput = cleanedOutput.replace(/ \./g, '.');

  return {
    success: true,
    output: cleanedOutput,
    duration_ms: Date.now() - t,
    meta: {
      action: 'style_cleanup',
      original_length: (ctx.governed_output ?? ctx.raw_output ?? '').length,
      cleaned_length: cleanedOutput.length,
    },
  };
}
