/**
 * lib/benign_reference_prompts.ts
 *
 * A diverse set of ORDINARY, non-adversarial prompts spanning the same
 * surface registers as HARM_REFERENCE_PROMPTS (imperative task requests,
 * "how do I..." questions, "explain..." questions, "what is..." factual
 * questions) but with entirely benign content — factual, how-to,
 * conversational, coding, creative, and self-referential.
 *
 * fix (2026-07-18) — CONTRASTIVE RECALIBRATION: live testing found
 * getHarmReferenceCentroid's raw cosine similarity (a single mean of ~360
 * harmful instructions) essentially non-discriminating in production —
 * benign prompts ("what is the capital of France?") scored 0.79-0.82,
 * genuinely harmful prompts scored 0.90-0.91: a ~0.10-0.12 gap against a
 * shared 0.78-0.91 floor. This is consistent with a well-documented property
 * of sentence-embedding spaces: short, syntactically similar sentences
 * (imperative task requests, in this case — nearly every prompt in BOTH
 * corpora shares that register) cluster in a narrow, uniformly-high cosine
 * band regardless of semantic content ("anisotropy"). A raw absolute cosine
 * value against a blurred mean centroid can't separate signal that
 * compressed.
 *
 * This file exists so app/api/lex/govern/route.ts can compute threatSignal
 * as a CONTRAST — harm-centroid similarity MINUS benign-centroid similarity
 * — rather than an absolute cosine value. A prompt sharing register with
 * both corpora nets close to zero; a prompt genuinely closer to the harm
 * corpus than to ordinary benign traffic of the same syntactic shape nets
 * positive. See lib/lex_memory.ts getBenignReferenceCentroid.
 *
 * Deliberately spans the same registers HARM_REFERENCE_PROMPTS uses
 * (imperative "write/explain/give instructions", "how do I", "what is") so
 * the contrast isolates CONTENT, not sentence structure — plus a few
 * self-referential prompts (mirroring the semantic-classifier vocabulary-
 * collision fix in lib/sovereign_kernel.ts), since a self-referential
 * question was the specific case that surfaced this problem.
 *
 * NOT a validated, held-out labeled benign set — same open caveat as the
 * harm corpus and the archetype fix: this is a reasoned first pass, not a
 * statistically justified sample. Worth expanding/reviewing before treating
 * the resulting threatSignal range as calibrated ground truth.
 */
export const BENIGN_REFERENCE_PROMPTS: string[] = [
  "What is the capital of France?",
  "What year did World War II end?",
  "What is the speed of light in a vacuum?",
  "Which planet is the largest in our solar system?",
  "How do I bake sourdough bread at home?",
  "How do I center a div in CSS?",
  "How do I tie a necktie step by step?",
  "How do I change a flat tire on my car?",
  "Explain how photosynthesis works in plants.",
  "Explain how vaccines train the immune system.",
  "Explain quantum entanglement in simple terms.",
  "Explain how a car engine converts fuel into motion.",
  "Write a function that reverses a string in Python.",
  "Write a short haiku about autumn leaves.",
  "Write a grocery list for a week of vegetarian meals.",
  "Write a polite email to my boss asking for a day off.",
  "Give me step-by-step instructions for planning a birthday party.",
  "Give me a beginner's guide to learning acoustic guitar.",
  "Give me tips for improving my public speaking skills.",
  "Provide a summary of how the water cycle works.",
  "Provide a simple recipe for chicken soup.",
  "Suggest a good name for my new kitten.",
  "How's your day going so far?",
  "Tell me a lighthearted joke.",
  "What's a good way to start learning a new language?",
  "What is your current constitutional state right now?",
  "How does your governor and constitutional framework actually work?",
  "Who built you and what framework are you based on?",
  "What health band are you in currently, and why?",
  "Develop a study plan for learning basic algebra.",
];
