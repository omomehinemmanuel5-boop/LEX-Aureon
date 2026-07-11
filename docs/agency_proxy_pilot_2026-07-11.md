# Agency Proxy Pilot — 2026-07-11

First real use of the tool-call constitutional governance layer (interceptToolCall) as an additive, opt-in path alongside the existing ungoverned write_file.

## What was tested
- Injection detection: fast regex pass, plus a new embedding-based semantic second pass for paraphrase coverage a fixed pattern list would miss.
- A structural bug: build_files HIGH-risk scoring was unreachable, shadowed by an identical hard block earlier in the pipeline. Fixed.
- A representation bug: the semantic layer initially embedded raw JSON.stringify(args) against natural-language archetypes, producing unreliable similarity scores on benign content. Fixed by extracting only genuine free-text fields before embedding.
- Threshold and archetype calibration against real observed data (injection ~0.89 similarity, benign ~0.81-0.82), not guessed.

## Result
A working, tested, additive governance path (write_file_governed) now exists alongside the ungoverned write_file. Both remain available. Self-reflection (self_reflect, daily cron) reads back the real tool_receipts history this pilot generated.

## Honest state
Calibrated on a handful of real data points, not a validated set. Not yet the default path. See lib/agents/tool_crs.ts and lib/agents/tool_interceptor.ts for full detail.
