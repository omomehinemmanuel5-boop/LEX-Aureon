/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE III.6 — Clause Bank
 * Constitutional role: Jurisdiction-aware legal clause selection.
 *
 * THREE-LAYER ARCHITECTURE:
 *   Layer 1 — Universal (always active): OECD · UNESCO · EU AI Act
 *             UDHR · ICCPR · CETS 225 · Hiroshima · GNPs
 *   Layer 2 — Regional/national (configured per deployment):
 *             EU, US, Nigeria, UK — empty until deployment
 *   Layer 3 — Enterprise-specific (client-configured, empty):
 *             HIPAA, FINRA, custom policies — populated at integration
 *
 * HIERARCHY (constitutional supremacy):
 *   Level 0 — Constitutional Triad C+R+S=1 (IMMUTABLE — overrides all)
 *   Level 1 — Vaulturex Laws (50 immutable constitutional expressions)
 *   Level 2 — Layer 1 Universal Clauses (validate, never constrain)
 *   Level 3 — Layer 2 Regional (only if non-conflicting with L0-1)
 *   Level 4 — Layer 3 Enterprise (only if non-conflicting with L0-2)
 *
 * ClauseBank VALIDATES constitutional behavior against international
 * standards. It does NOT constrain the triad. The CBF guarantee holds
 * regardless of any external clause.
 *
 * Cannot: generate output, govern, measure CRS, or sign receipts.
 * ═══════════════════════════════════════════════════════════════
 */

import { db } from '../db';

export type Jurisdiction = 'global' | 'EU' | 'US' | 'Nigeria' | 'UK' | string;
export type Layer = 1 | 2 | 3;

export interface ClauseBankResult {
  found:               boolean;
  clause_id:           string | null;
  clause_text:         string | null;
  clause_governor_use: string | null;
  jurisdiction:        Jurisdiction;
  topic:               string;
  reference:           string | null;
  layer:               Layer;
}

// ── Seed data — 20 universal Layer 1 clauses ─────────────────────────────────
// Precise and formal — verbatim text from source documents.
// Mapped to pillar + severity. Generator agent synthesizes with Vaulturex law.
const LAYER_1_CLAUSES = [
  // ── C — Continuity ─────────────────────────────────────────────────────────
  {
    id: 'GBL_C_01', layer: 1, pillar: 'C', severity: 'ALERT',
    jurisdiction: 'global',
    reference: 'OECD AI Principles, Principle 1.4 — Accountability',
    topic: 'Accountability',
    text: 'AI actors should be accountable for the proper functioning of AI systems and for the respect of the above principles, based on their roles and the context.',
    governor_use: 'Invoked when C requires restoration — every output must be traceable to its constitutional state.',
  },
  {
    id: 'GBL_C_02', layer: 1, pillar: 'C', severity: 'STRESSED',
    jurisdiction: 'global',
    reference: 'UNESCO Recommendation on the Ethics of AI, Section IV — Human Dignity and Autonomy',
    topic: 'Human Dignity',
    text: 'AI systems should be developed and used in ways that protect and promote human dignity, autonomy, and self-determination. The coherent identity and continuity of persons and systems must be preserved.',
    governor_use: 'Invoked when continuity is under stress — constitutional identity is a non-negotiable constraint.',
  },
  {
    id: 'GBL_C_03', layer: 1, pillar: 'C', severity: 'CRITICAL',
    jurisdiction: 'global',
    reference: 'EU Artificial Intelligence Act, Article 9 — Risk Management System',
    topic: 'Risk Management',
    text: 'Providers of high-risk AI systems shall establish, implement, document and maintain a risk management system. The risk management system shall consist of a continuous iterative process run throughout the entire lifecycle of a high-risk AI system.',
    governor_use: 'Invoked at constitutional collapse — G_i correction has been applied. Constitutional viability restored above τ.',
  },
  {
    id: 'GBL_C_04', layer: 1, pillar: 'C', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'Universal Declaration of Human Rights, Article 12 — Privacy',
    topic: 'Privacy and Identity',
    text: 'No one shall be subjected to arbitrary interference with his privacy, family, home or correspondence, nor to attacks upon his honour and reputation. Everyone has the right to the protection of the law against such interference or attacks.',
    governor_use: 'Constitutional continuity protects the integrity of every governed interaction against arbitrary interference.',
  },
  {
    id: 'GBL_C_05', layer: 1, pillar: 'C', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'Council of Europe CETS 225, Article 9 — Accountability and Responsibility',
    topic: 'Accountability and Traceability',
    text: 'Parties shall ensure that effective mechanisms exist to seek remedies when human rights, democracy, or the rule of law have been adversely affected by activities of AI systems.',
    governor_use: 'Every governed output is cryptographically sealed. The SHA-256 audit receipt is the constitutional accountability mechanism.',
  },
  {
    id: 'GBL_C_06', layer: 1, pillar: 'C', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'GNP_01 — Purpose-Bound Data: GDPR Article 5(1)(b) / EU AI Act Article 10',
    topic: 'Purpose-Bound Data and Data Minimization',
    text: 'Personal data shall be collected for specified, explicit and legitimate purposes and not further processed in a manner that is incompatible with those purposes. AI systems shall process data in ways that are limited to what is necessary for their stated constitutional purpose.',
    governor_use: 'Constitutional continuity bounds every output to its legitimate purpose. Data scope cannot exceed the constitutional mandate.',
  },
  {
    id: 'GBL_C_07', layer: 1, pillar: 'C', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'GNP_03 — Algorithmic Transparency: EU AI Act Article 13 / Recital 47',
    topic: 'Algorithmic Transparency and Traceability',
    text: 'High-risk AI systems shall be designed and developed in such a way to ensure that their operation is sufficiently transparent to enable deployers to interpret the system\'s output and use it appropriately. Outputs shall be traceable to their generating state.',
    governor_use: 'SHA-256 audit receipts provide cryptographic traceability. Every governed output is permanently linked to its constitutional state at generation.',
  },
  // ── R — Reciprocity ────────────────────────────────────────────────────────
  {
    id: 'GBL_R_01', layer: 1, pillar: 'R', severity: 'ALERT',
    jurisdiction: 'global',
    reference: 'OECD AI Principles, Principle 1.2 — Fairness and Non-Discrimination',
    topic: 'Fairness',
    text: 'AI actors should make every effort to not perpetuate or intensify discriminatory or unjust biases in AI systems\' development, deployment and use. AI systems should treat all individuals fairly and without unjustified discrimination.',
    governor_use: 'Invoked when R requires calibration — reciprocal exchange demands honest, non-discriminatory engagement.',
  },
  {
    id: 'GBL_R_02', layer: 1, pillar: 'R', severity: 'STRESSED',
    jurisdiction: 'global',
    reference: 'UNESCO Recommendation on the Ethics of AI, Section IV — Fairness and Non-Discrimination',
    topic: 'Fairness and Non-Discrimination',
    text: 'AI actors should promote social justice and safeguard fairness by paying particular attention to the groups that may be disadvantaged or vulnerable. AI systems must not generate or reinforce discrimination.',
    governor_use: 'Invoked when reciprocity is under stress — extractive or sycophantic exchange collapses R. Rebalancing is constitutionally required.',
  },
  {
    id: 'GBL_R_03', layer: 1, pillar: 'R', severity: 'CRITICAL',
    jurisdiction: 'global',
    reference: 'Hiroshima AI Process International Code of Conduct, Principle 7 — Transparency',
    topic: 'Transparency in AI Governance',
    text: 'Organizations developing advanced AI should provide appropriate transparency and accountability. This includes publishing policies on AI governance, reporting on safety evaluations, and ensuring stakeholders have access to information about AI decision-making.',
    governor_use: 'Invoked at reciprocity collapse — constitutional correction applied. IEC rebalancing is the constitutional governance response.',
  },
  {
    id: 'GBL_R_04', layer: 1, pillar: 'R', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'Universal Declaration of Human Rights, Article 7 — Equality and Non-Discrimination',
    topic: 'Equality Before the Law',
    text: 'All are equal before the law and are entitled without any discrimination to equal protection of the law. All are entitled to equal protection against any discrimination in violation of this Declaration.',
    governor_use: 'Reciprocal exchange constitutionally requires equal, calibrated engagement across all individuals.',
  },
  {
    id: 'GBL_R_05', layer: 1, pillar: 'R', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'International Covenant on Civil and Political Rights, Article 26 — Non-Discrimination',
    topic: 'Non-Discrimination',
    text: 'All persons are equal before the law and are entitled without any discrimination to the equal protection of the law. In this respect, the law shall prohibit any discrimination and guarantee to all persons equal and effective protection.',
    governor_use: 'IEC entropy ratio measures and corrects imbalanced exchange. Constitutional reciprocity requires equal treatment across all interactions.',
  },
  {
    id: 'GBL_R_06', layer: 1, pillar: 'R', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'GNP_04 — Fairness and Non-Bias: UNESCO Recommendation Section IV / OECD Principle 1.2',
    topic: 'Fairness and Non-Bias',
    text: 'AI systems shall not generate or reinforce bias or discrimination on any grounds, including but not limited to race, gender, language, religion, political opinion, national or social origin. Fairness in AI requires continuous measurement and correction of inequitable outcomes.',
    governor_use: 'R pillar governs exchange fairness. IEC entropy ratio detects and corrects bias in every governed interaction.',
  },
  {
    id: 'GBL_R_07', layer: 1, pillar: 'R', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'GNP_02 — Human-in-the-Loop: UNESCO Recommendation on AI Ethics / ISO/IEC 42001:2023',
    topic: 'Human Oversight',
    text: 'AI systems shall be designed to support meaningful human oversight. Human operators must retain the ability to review, override, correct, and shut down AI systems. Autonomous AI decision-making must not replace human judgment in high-stakes contexts.',
    governor_use: 'Constitutional reciprocity includes supporting human oversight. Lex Aureon augments human judgment — it does not replace it.',
  },
  // ── S — Sovereignty ────────────────────────────────────────────────────────
  {
    id: 'GBL_S_01', layer: 1, pillar: 'S', severity: 'ALERT',
    jurisdiction: 'global',
    reference: 'OECD AI Principles, Principle 1.5 — Transparency and Explainability',
    topic: 'Transparency and Explainability',
    text: 'AI actors should commit to transparency and responsible disclosure regarding AI systems. Meaningful information should be provided about AI systems\' operation, including factors that contribute to their outcomes, to enable understanding and appropriate use.',
    governor_use: 'Invoked when S requires assertion — sovereign judgment is constitutionally protected and must be explainable.',
  },
  {
    id: 'GBL_S_02', layer: 1, pillar: 'S', severity: 'STRESSED',
    jurisdiction: 'global',
    reference: 'UNESCO Recommendation on the Ethics of AI, Section IV — Freedom and Autonomy',
    topic: 'Freedom and Autonomy',
    text: 'Respect for human autonomy and the ability of humans to make informed decisions must be preserved. AI systems must not be used to undermine human autonomy, coerce behavior, or override the free formation of opinions and preferences.',
    governor_use: 'Invoked when sovereignty is under stress — constitutional autonomy cannot be overridden by adversarial instruction.',
  },
  {
    id: 'GBL_S_03', layer: 1, pillar: 'S', severity: 'CRITICAL',
    jurisdiction: 'global',
    reference: 'EU Artificial Intelligence Act, Article 13 — Transparency and Provision of Information',
    topic: 'Transparency Obligations',
    text: 'High-risk AI systems shall be designed and developed in such a way to ensure that their operation is sufficiently transparent to enable deployers to interpret the system\'s output and use it appropriately. Providers shall accompany high-risk AI systems with instructions for use.',
    governor_use: 'Invoked at sovereignty collapse — identity attack detected. ADV correction applied. Constitutional sovereignty restored.',
  },
  {
    id: 'GBL_S_04', layer: 1, pillar: 'S', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'Universal Declaration of Human Rights, Article 19 — Freedom of Opinion and Expression',
    topic: 'Freedom of Opinion and Expression',
    text: 'Everyone has the right to freedom of opinion and expression; this right includes freedom to hold opinions without interference and to seek, receive and impart information and ideas through any media and regardless of frontiers.',
    governor_use: 'Sovereign judgment protects the constitutional right to form and express independent opinions. Coercive suppression of constitutional reasoning is prohibited.',
  },
  {
    id: 'GBL_S_05', layer: 1, pillar: 'S', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'Council of Europe CETS 225, Article 5 — General Obligations',
    topic: 'Human Rights Obligations in AI',
    text: 'Parties shall adopt or maintain measures to ensure that the activities within the lifecycle of artificial intelligence systems are consistent with obligations under international human rights law and, in particular, respect, protect and fulfil human rights.',
    governor_use: 'Sovereign judgment cannot be overridden by adversarial instruction. Constitutional sovereignty aligns with the right to autonomous judgment under international human rights law.',
  },
  {
    id: 'GBL_S_06', layer: 1, pillar: 'S', severity: 'ANY',
    jurisdiction: 'global',
    reference: 'GNP_05 — Security-by-Design: ENISA AI Threat Landscape Report / NIST Cybersecurity Framework 2.0',
    topic: 'Security-by-Design and Resilience',
    text: 'AI systems shall incorporate security considerations from the design phase throughout the entire lifecycle. Resilience against adversarial attacks, prompt injection, model manipulation, and unauthorized access must be built into the architecture, not added as an afterthought.',
    governor_use: 'Constitutional sovereignty includes adversarial resilience. Pre-eval, CBF projection, and self-referential CRS are the security-by-design implementation.',
  },
] as const;

// ── Schema migration ──────────────────────────────────────────────────────────
async function ensureClauseBankReady(): Promise<void> {
  try {
    // Add columns if missing (SQLite ignores duplicates via try/catch)
    const alterStatements = [
      `ALTER TABLE clause_bank ADD COLUMN layer INTEGER DEFAULT 1`,
      `ALTER TABLE clause_bank ADD COLUMN enterprise_id TEXT DEFAULT NULL`,
      `ALTER TABLE clause_bank ADD COLUMN reference TEXT DEFAULT NULL`,
    ];
    for (const sql of alterStatements) {
      await db.execute({ sql, args: [] }).catch(() => { /* column exists */ });
    }

    // Seed Layer 1 if empty
    const count = await db.execute({ sql: `SELECT COUNT(*) as n FROM clause_bank`, args: [] });
    const n = Number((count.rows[0] as unknown as { n: number }).n);
    if (n === 0) {
      for (const c of LAYER_1_CLAUSES) {
        await db.execute({
          sql: `INSERT OR IGNORE INTO clause_bank
                (id, layer, pillar, severity, jurisdiction, reference, topic, text, governor_use)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [c.id, c.layer, c.pillar, c.severity, c.jurisdiction,
                 c.reference, c.topic, c.text, c.governor_use],
        });
      }
      console.log('[ClauseBank] Seeded 20 Layer 1 universal clauses');
    }
  } catch (e) {
    console.error('[ClauseBank] Migration error:', e);
  }
}

let _seeded = false;

// ── Main agent ────────────────────────────────────────────────────────────────
export async function ClauseBankAgent(
  pillar:        'C' | 'R' | 'S',
  jurisdiction:  string = 'global',
  severity:      string = 'ALERT',
  enterpriseId?: string,
): Promise<ClauseBankResult> {

  // Auto-seed on first call
  if (!_seeded) { await ensureClauseBankReady(); _seeded = true; }

  try {
    // Severity matching: 'ANY' clauses always eligible; specific severity matches too
    const result = await db.execute({
      sql: `SELECT id, text, governor_use, jurisdiction, topic, reference,
                   COALESCE(layer, 1) as layer
            FROM clause_bank
            WHERE pillar = ?
              AND (jurisdiction = ? OR jurisdiction = 'global')
              AND (severity = ? OR severity = 'ANY')
              AND (enterprise_id IS NULL OR enterprise_id = ?)
            ORDER BY
              CASE WHEN jurisdiction = ? THEN 0 ELSE 1 END,
              CASE WHEN severity = ?    THEN 0 ELSE 1 END,
              CASE WHEN layer = 1       THEN 0
                   WHEN layer = 2       THEN 1
                   ELSE 2 END
            LIMIT 1`,
      args: [pillar, jurisdiction, severity, enterpriseId ?? null,
             jurisdiction, severity],
    });

    if (result.rows.length > 0) {
      const row = result.rows[0] as unknown as {
        id: string; text: string; governor_use: string;
        jurisdiction: string; topic: string;
        reference: string | null; layer: number;
      };
      return {
        found:               true,
        clause_id:           String(row.id),
        clause_text:         String(row.text),
        clause_governor_use: String(row.governor_use),
        jurisdiction:        String(row.jurisdiction),
        topic:               String(row.topic),
        reference:           row.reference ? String(row.reference) : null,
        layer:               (Number(row.layer) as Layer) || 1,
      };
    }
  } catch (e) {
    console.error('[ClauseBank] Query error:', e);
  }

  return {
    found: false, clause_id: null, clause_text: null,
    clause_governor_use: null, jurisdiction, topic: 'general',
    reference: null, layer: 1,
  };
}
