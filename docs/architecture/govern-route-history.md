# Govern Route Architecture Notes

`app/api/lex/govern/route.ts` is the canonical non-streamed governance endpoint.
It should stay focused on the live request contract:

1. validate the govern request;
2. load session state and session-adaptive z weights;
3. build memory context and threat-signal inputs;
4. run `SovereignKernel.runCycle()`;
5. persist the audit receipt and calibration signals;
6. return one coherent CRS vector with receipt metadata.

Historical implementation notes, benchmark-driven calibration details, and
migration rationale should live here (or in dated research/operations notes),
not as ever-growing route-file headers. Keeping the route concise makes the
live governance path easier to audit while preserving the research trail.

## Current live invariants

- Session z weights are loaded through `loadKernelZ()` and passed into
  `runCycle(sessionZ)`.
- The response reports one coherent constitutional vector: the kernel's governed
  state, with `M` and health band derived from that same vector.
- Embedding failures are surfaced as degraded detection rather than hidden.
- The capitulation judge remains measurement-only until calibration evidence is
  sufficient to promote it to an enforcement signal.
- Public errors should remain generic through `publicError()` while details are
  logged server-side.

## Maintenance rule

When a future change needs a long rationale, add a dated section here and keep
only a short summary comment near the executable code.
