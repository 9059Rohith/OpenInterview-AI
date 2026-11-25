# Threat model

| Boundary | Threat | Required control / limit |
| --- | --- | --- |
| Browser to provider | Personal key leakage | Memory-only keys, direct selected origin, no analytics payloads |
| Renderer to Electron main | Arbitrary local execution | Sandboxed renderer, context isolation, narrow validated IPC, deny navigation |
| Local vault | Disk key disclosure | OS-protected encryption, fail closed if unavailable |
| Account to account | Reading another candidate's data | Owner predicates for every object, revocation and cross-owner tests |
| Browser to account API | CSRF/session theft | Protected cookies, CSRF checks, restrictive CORS, TLS in production |
| Uploaded PDF/DOCX | Oversized/malformed/untrusted input | Size/type limits, bounded parsing, treat extracted text as data |
| Retrieval to model | Prompt injection in documents | Explicit data boundaries, budgeted context, no document-controlled tools |
| Coding lab to host | Code execution/denial of service | Browser sandbox or separately configured isolated runner; never API eval |
| Billing client to entitlement | Forged/duplicate payment | Server HMAC verification, order ownership and idempotency |
| Logs/exports | Credential or transcript disclosure | Sanitization, local exports, explicit sharing |
| Local models | Unexpected downloads/resource use | Visible model controls, installed-runtime checks, resource guidance |

Residual limits: a compromised OS/browser can read data visible to its user. Local inference needs sufficient RAM/disk and an installed runtime. Speech recognition availability depends on browser/OS. Unsigned binaries can trigger OS warnings. No independent security audit has been performed. Serverless filesystems are not persistent databases.
