"""Offline benchmark using original synthetic source facts only."""
import json
import statistics
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.intelligence import optimize

facts = [f'Service {i} must keep p95 latency below {100 + i} ms and preserve customer identifier Example-{i}.' for i in range(200)]
documents = [{'id': 'synthetic-constraints', 'text': '\n\n'.join(facts + facts)}]
times, result = [], None
for _ in range(50):
    result = optimize('Service 42 latency customer identifier', documents, 1200)
    times.append(result['latencyMs'])
summary = {key: result[key] for key in ['tokensBefore', 'tokensAfter', 'budget', 'omittedUnits', 'method']}
summary.update({'runs': 50, 'medianLatencyMs': round(statistics.median(times), 2), 'p95LatencyMs': sorted(times)[47], 'selectedUnitsVerbatim': all(c['text'] in facts for c in result['chunks']), 'selectedUnitsUnique': len({c['text'] for c in result['chunks']}) == len(result['chunks']), 'semanticAnswerQualityEvaluated': False, 'fixture': '400 original synthetic constraint paragraphs, including 200 exact duplicates', 'tokenEstimator': 'ceil UTF-8 bytes / 3, conservative estimate rather than model tokenizer'})
print(json.dumps(summary, indent=2))
