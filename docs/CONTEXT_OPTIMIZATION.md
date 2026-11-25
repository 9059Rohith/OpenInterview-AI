# Context optimization decision

The [official Headroom repository](https://github.com/headroomlabs-ai/headroom) offers Python/TypeScript context compression, a proxy and integration surfaces. Its published performance figures are workload-dependent; they are not benchmarks of this product.

For the initial release we use a small modular alternative for the browser/offline and API paths: score candidate passages against the question, deduplicate repeated passages, select within a fixed budget and retain source text for inspection. No private resume needs to be sent to a compression service. Token counts are explicitly estimates unless a provider tokenizer/usage result is available.

Decision: avoid coupling the initial device-local application to an additional proxy, model download or server process. Browser guest use and desktop use should work with identical context selection behavior. This is an engineering scope decision, not a claim that Headroom is technically unsuitable. A future adapter can implement the same input/output contract and compare against the baseline.

Acceptance evidence should include before/after estimates, elapsed time, chosen passages, deduplication and budget tests. A smaller prompt alone does not prove unchanged answer quality. Critical names, numbers, code and constraints need retention tests; a human/provider evaluation is required before claiming quality preservation. Original documents remain editable and exportable rather than being replaced by lossy summaries.

The local synthetic benchmark (`python services/api/scripts/benchmark_context.py`) ran 50 iterations over 400 original constraint paragraphs including 200 exact duplicates. It selected 1,178 estimated tokens from 12,386 before selection with a 1,200 estimate budget; median 3.79 ms, p95 4.44 ms. Selected units were unique and verbatim, and the queried numeric constraint was retained. Counts use conservative UTF-8 byte estimates, not a model tokenizer. Semantic answer quality was not evaluated, so this is not a universal compression or accuracy claim.
