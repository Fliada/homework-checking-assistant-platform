# Review pipeline

`app.services.pipeline` exposes asynchronous functions independent of SQLAlchemy and Celery. The worker persists their JSON-compatible results.

- `ingest_github_pr(pr_url, token=None, allowed_repositories=None, max_files=200, max_bytes=20_000_000, artifact_root=None)` validates a canonical GitHub PR URL, fetches an immutable head tree and blob SHAs, then extracts artifacts. When `artifact_root` is supplied, original bytes are stored under their SHA-256, never under user-controlled repository paths. GitHub redirects and artifact download URLs are not followed. Secret values and commit emails are not put into job diagnostics.
- `run_review_pipeline(assignment, rubric, agent_config, models, artifacts)` applies the pinned configuration. Every scored criterion needs validated source evidence. Missing configuration, unsupported artifacts, low confidence or invalid evidence produce a null proposed score and a human-review state. A partial score is never represented as a total.
- `run_evaluation(..., examples, repetitions=3)` accepts exactly weak, medium and good examples. Each example supplies `artifacts`, or a GitHub `repository`, commit/branch `ref`, and file/directory `path`. Branches resolve to one commit before repetitions begin. Results include actual per-repetition outputs and model-call metadata; undefined ordering, stability, token usage and anchor metrics remain null.
- `compose_feedback(review)` copies only confirmed criterion scores/notes and accepted or edited annotations visible to the student. Composition is deterministic, so no model can add unconfirmed claims to this result.

PR import first reads the changed-file list and pins its head/base commits. Small repositories retain full snapshots. If the recursive tree is truncated, too large, or exceeds snapshot limits, import falls back to changed files resolved through nonrecursive immutable Git trees. File SHA and PR version checks reject a PR that changes during import; symlinks and submodules are not followed. File and byte limits still apply to the fallback.

Fallback snapshots carry `snapshot_scope=pull_request`, `snapshot_complete=false` and explicit context limitations into review prompts and the UI. Missing repository context cannot establish that a required file or component is absent. Criteria requiring unavailable context remain unscored. Known pipeline errors are translated to actionable messages without exposing provider response bodies or credentials.

The supplied GO fixtures preserve task text and source blob SHAs from [homework_examples](https://github.com/ai-talent-hub-avito/homework_examples). Initial rubric criteria are manually authored from those tasks. Their calibration references are pinned to commit `7a72e08ab417f3ff6503467b51f5a58157fa833a`. The 41 relevant public source files are bundled in `fixtures/go-calibration.json`; the loader verifies their Git blob hashes, so these default examples do not require network access or a GitHub token. Each task has its own rubric; a cumulative solution is never evaluated against all three tasks at once.

## Models and policy

Each task binding selects a registry model ID, prompt and parameters. The default model is `gemma-4-31b-it` hosted by Google AI Studio. Provider `gemini` uses native [`generateContent`](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api) at `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, with `GEMINI_API_KEY` passed only in the `x-goog-api-key` header. The model registry probe requests metadata for the selected model without running inference.

Gemma's default capabilities disable API-enforced JSON mode and JSON schema. The prompt contains the required schema, and the existing parser and evidence validation still reject malformed or unsupported results. The native adapter reads final text parts, excludes thought parts, and records provider-reported usage and model version. Incomplete or blocked responses never yield a score. No tools or search are enabled.

Other providers continue to use the [OpenAI-compatible Chat Completions contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create): one request to `/chat/completions`, JSON output, explicit model name, optional JSON-schema capability, no tools and no execution. `max_output_tokens` is translated to `max_completion_tokens` for OpenAI, `maxOutputTokens` in Gemini's `generationConfig`, or `max_tokens` for other compatible providers. Provider capabilities can disable JSON mode or temperature. Requests record effective parameters, prompt hash, model ID, provider-reported model name, token usage, latency and safe error codes; prompt text and API tokens are not logged.

Credential values are read from the environment identified by `api_key_env`. Public endpoints require `ALLOW_PUBLIC_LLM=true`, `APP_ENV=dev_demo`, an explicit public-data declaration and a verified public repository. Sensitive mode permits local/private IP endpoints or hostnames listed in `APPROVED_MODEL_HOSTS` whose registry capabilities include `zero_retention: true`. HTTP is permitted only for local/private endpoints. Disable and rebind models explicitly: the client never silently falls back to another model.

The scanner masks common API tokens, private keys, credential assignments, connection strings, email addresses, phone numbers and labelled identity fields before inference, including reference and expert context. This basic scanner does not prove that arbitrary content is free of personal information; sensitive submissions must use approved private endpoints regardless of scanning results. Raw artifacts remain accessible only through authorized application endpoints.

## Parser limits

Code/text line numbers are preserved. DOCX paragraphs/tables, PDF text pages, notebook cells/saved text outputs, XLSX cell values/formulas and visible HTML blocks become canonical segments. Formula evaluation, code execution, external document links, notebook execution, OCR and image analysis are disabled. Files are limited to 5 MB, extracted text to 200,000 characters, segments to 2,000 and PDF pages to 100. Office ZIP containers also have expansion limits. Dependency/generated directories, source maps, lockfiles and minified bundles are skipped. Limits or unsupported content produce explicit `needs_human` artifacts.

Integrity is entirely mocked: the pipeline always returns `status: mocked` and no signals, never a simulated score or allegation. There is no web-search adapter or detector call in this implementation.

## Verification

From `backend`, run `python -m pytest tests/test_pipeline.py`. Tests use in-memory artifacts and an HTTP transport stub; they verify real parser behavior, head pinning, URL policy, secret masking, output validation, conditional critic calls, confirmed-only feedback and metric calculations. No test makes a paid model request. Live Google or OpenAI evaluation requires operator-provided credentials and reports no model-quality results until actually run.
