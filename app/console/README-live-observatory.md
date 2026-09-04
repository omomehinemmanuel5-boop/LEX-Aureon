# Live Governance Observatory

This milestone upgrades the existing Governance Console instead of creating a duplicate.

## Phase 1
- Constitutional state bar (Continuity, Reciprocity, Sovereignty)
- Stability margin indicator
- Governor state indicator

## Phase 2
- Receipt-generated events
- Trajectory-stabilized events
- Benchmark-verified events

## Phase 3
- Timeline replay
- Live / Pause / Step / Replay controls

## Phase 4
- Bridge GovernanceFeed receipts to /verify.
## Operational access and telemetry

The observability console and all `/api/observability/*` routes use the existing admin Basic Auth boundary. Requests receive or preserve these response headers:

- `X-Request-ID` — stable request correlation identifier.
- `X-Trace-ID` — W3C trace identifier, preserved from a valid `traceparent` header when supplied.

Available endpoints:

- `GET /api/observability/metrics?window_minutes=60` — JSON governance health metrics. The window must be an integer from 5 to 1440 minutes.
- `GET /api/observability/sessions?limit=10` — bounded recent session list.
- `GET /api/observability/timeline?session_id=...&limit=50` — bounded session timeline.
- `GET /api/observability/prometheus?window_minutes=60` — Prometheus text exposition for Grafana scraping.

Optional structured log shipping remains compatible with `LOG_DRAIN_URL` and adds Grafana Loki support when all three values are configured: `GRAFANA_LOKI_URL`, `GRAFANA_LOKI_USER`, and `GRAFANA_LOKI_TOKEN`. Delivery is best-effort and never blocks an application request.
