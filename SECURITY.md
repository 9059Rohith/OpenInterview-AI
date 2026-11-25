# Security policy

Do not publish credentials, private resumes, transcripts or exploitable vulnerabilities in public issues. Report vulnerabilities through the repository's private security reporting feature when enabled, or contact its owner privately before disclosing details.

The desktop renderer is sandboxed and context isolated. Only validated, named IPC operations cross into the main process. Personal keys require OS-backed encryption; no plaintext fallback is permitted. Browser keys remain in memory. The optional account service uses owner-scoped records and revocable sessions. Billing entitlement changes require verified payment signatures; a checkout button or client response is not proof of payment.

User content is untrusted. Uploaded files need size/type limits, retrieved content is data rather than system instructions, and generated code must run in a constrained sandbox. Never execute user code in the API process. Outbound provider/compatible endpoints require validation. See docs/THREAT_MODEL.md for trust boundaries and limits.

Production operators must supply TLS, persistent PostgreSQL, a strong application secret, restricted CORS, provider/payment credentials when needed, backups and monitoring. Run dependency scans before each public release. This initial release has not received an independent security audit or code-signing certificate.
