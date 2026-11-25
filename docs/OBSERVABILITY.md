# Observability

OpenInterview uses a compatible local analysis workflow rather than claiming that an external LogLens product is installed. Inspect structured API request metadata and desktop diagnostic events. User-visible provider errors should give an actionable category (missing setup, authentication, quota, network, cancellation or runtime unavailable).

Allowed fields include request/event ID, route category, provider name, status code, elapsed milliseconds and aggregate counts. Never record authorization/cookie headers, personal provider keys, passwords, OAuth tokens, resume text, raw audio or private transcripts. Avoid full upstream error bodies because providers can echo input or credentials.

Useful operator checks: startup readiness, database connectivity, migration version, failed authentication counts, payment signature failures, provider latency and failures, cancellation counts, speech errors and desktop startup/crashes. Keep production logs access-controlled and apply a documented retention limit.

For incident triage, reproduce with invented input, export sanitized metadata only, identify the failing component, and rerun its tests. Browser local data is not automatically uploaded for diagnostics. The release verification report lists observed runs; it does not establish long-term uptime or two-hour session reliability.
