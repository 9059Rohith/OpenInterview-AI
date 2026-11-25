# Local AI

Install the official [Ollama runtime](https://ollama.com/download/windows), start its service, then download a model explicitly. In desktop AI providers, check the runtime, refresh models, select a downloaded model and run the test action. The browser may block connections from a hosted HTTPS origin to local HTTP; desktop calls originate in its main process and avoid that browser restriction.

```powershell
ollama serve
ollama pull qwen2.5:0.5b
ollama run qwen2.5:0.5b
```

The [official small Qwen2.5 model](https://ollama.com/library/qwen2.5:0.5b) is a low-resource starting point. Small models can make substantial factual errors. Use a larger supported model when hardware permits and compare real answer quality, latency and memory use. Initial download requires internet; subsequent local inference uses the downloaded weights.

Keep the service on loopback (`127.0.0.1:11434`). Do not expose an unauthenticated model service to a network. If browser access is necessary, allow only the specific trusted website origin using `OLLAMA_ORIGINS`; do not use a wildcard. Set `OLLAMA_NO_CLOUD=true` when requiring local-only operation.

This Windows environment initially had no Ollama installation. For validation, CPU runtime files were extracted from the official v0.40.18 release ZIP, checked against each ZIP entry CRC, and the executable's Authenticode signature was verified as valid for Ollama Inc. The full GPU archive was not installed. Models and runtime diagnostics are outside the source repository. See VALIDATION.md for the actual inference result.

For this specific verified CPU installation, restart the service with the existing downloaded model directory if Windows has restarted:

```powershell
$env:OLLAMA_MODELS = Join-Path $env:LOCALAPPDATA 'OpenInterviewAI-runtime\models'
$env:OLLAMA_NO_CLOUD = 'true'
& "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" serve
```

The desktop app does not bundle GPU drivers or automatically download model weights. Runtime availability is checked independently from the existence of a configuration or API key.
