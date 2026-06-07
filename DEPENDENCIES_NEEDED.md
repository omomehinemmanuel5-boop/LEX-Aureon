# Optional Dependencies for V2 Suite

The V2 Suite features are designed to work with your existing dependencies. However, for enhanced functionality, consider adding these optional packages:

## For Real-Time Visualization

```bash
# Optional: For advanced charting (if you want more visualization options)
npm install plotly.js-dist-min
npm install --save-dev @types/plotly.js
```

## For Red-Team Testing

```bash
# No additional dependencies needed
# The red-team suite uses only built-in Node.js APIs
```

## For Deep Observability

```bash
# Optional: For OpenTelemetry export
npm install @opentelemetry/api
npm install @opentelemetry/sdk-node
npm install @opentelemetry/sdk-trace-node
npm install @opentelemetry/exporter-trace-otlp-http

# Optional: For LangSmith integration
npm install langsmith

# Optional: For Arize Phoenix integration
npm install phoenix-client
```

## Installation Commands

### Minimal Setup (No Additional Dependencies)

The V2 Suite works out of the box with your existing setup:

```bash
# No installation needed - features are ready to use
npm run dev
```

### Full Setup (Recommended for Production)

```bash
# Install all optional dependencies
npm install plotly.js-dist-min @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http langsmith

# Install types
npm install --save-dev @types/plotly.js
```

## Environment Variables

To enable all features, set these optional environment variables:

```bash
# Deep Observability
export OTEL_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006/v1/traces

# LangSmith Integration
export LANGSMITH_API_KEY=your_api_key

# Datadog Integration
export DD_API_KEY=your_api_key
export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.datadoghq.com/v1/traces
```

## Feature Availability

| Feature | Required Deps | Optional Deps | Status |
|---------|---------------|---------------|--------|
| Lyapunov Visualizer | None | plotly.js | ✅ Ready |
| Red-Team Suite | None | None | ✅ Ready |
| Observability Dashboard | None | @opentelemetry/* | ✅ Ready |
| OpenTelemetry Export | None | @opentelemetry/* | ⚠️ Optional |
| LangSmith Integration | None | langsmith | ⚠️ Optional |

## Notes

- All core features work without additional dependencies
- Optional dependencies enhance functionality but are not required
- The visualizer uses Canvas API (built into browsers)
- The red-team suite uses only Node.js built-ins
- Observability works with or without backend export

## Troubleshooting

If you encounter issues:

1. **Visualizer not rendering**: Ensure browser supports Canvas API
2. **Red-team tests failing**: Check API endpoint is accessible
3. **Observability not exporting**: Verify backend endpoint and credentials
4. **Missing types**: Install `@types/*` packages as needed

## Recommendations

For a production deployment:

```bash
# Install recommended packages
npm install --save-optional plotly.js-dist-min @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http
```

This provides full functionality while keeping core dependencies minimal.
