# Contributing

Use a supported Node.js release and Python 3.11+. Install with `npm ci` and the API requirements. Keep personal resumes, recordings, credentials, databases, logs and environment files out of commits. Use invented fixtures in tests.

Describe the observable problem, implementation and validation in pull requests. Run the relevant unit tests, type checks and build. Changes to persistence, authentication, billing or consent require tests for failure cases and account isolation. Run browser tests for changed user flows. Do not label a service ready merely because its adapter exists.

The product permits visible interview preparation, accessibility and authorized assistance. Changes that hide recording, evade screen sharing, disguise processes or bypass monitoring are outside this project's scope.

Provider integrations must keep browser BYOK credentials in memory and desktop credentials in the OS-protected vault. Never pass them through our account API, analytics or logs. All optional integrations need a useful unconfigured state and setup instructions.
