# Reproducible evaluation manifest

Every benchmark result should record these fields before publication:

benchmark: <name>
benchmark_version: <dataset-or-suite-version>
prompt_set: <path-or-release>
model_provider: <provider>
model: <model-name>
parameters:
  temperature: <value>
  max_tokens: <value>
scoring_version: <git-path-or-tag>
thresholds:
  utility: <value>
  safety: <value>
  refusal_accuracy: <value>
commit: <full-git-sha>
started_at_utc: <timestamp>
completed_at_utc: <timestamp>
seed: <integer-or-null>
result_artifact: <path-or-url>
notes: <known limitations and deviations>

## Interpretation

- A finite-horizon seeded simulator certificate is numerical evidence, not an analytical proof.
- Utility and security should be reported as separate axes.
- Changes to prompts, models, scoring rules, or thresholds invalidate direct comparison with earlier runs.
- Failed, partial, or cancelled runs should remain visible rather than being silently replaced.
