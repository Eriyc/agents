# Goal-assistance implementation contracts

Frozen boundaries for independent implementation owners.

## Typed evaluation

- Put reusable Choice, Score, and Noul question types at the provider boundary; review-specific question construction stays a consumer.
- General evaluation accepts bounded JSON-compatible state and typed questions. Return validated native answers, model identity, and available usage metadata. Do not wrap prompts as fake files or reinterpret Jev probabilities as universal confidence.
- Expose the capability in the existing MCP server as working name `jev_evaluate`. Reuse the current OpenRouter credentials and provider selection; preserve `jev_review` and `jev_signal` behavior. Direct TypeSafe provider support is out of scope.

## Goal judgment and routing

- Inject a narrow replaceable judge. Keep raw answers and provenance beside normalized signals; a deterministic fake supports tests.
- Assess intent (answer/discuss/investigate/implement/mixed), work relationship (new/refine/replace/answer-to-clarification/unrelated), goal status (clear/inferable/ambiguous/absent/not-needed), and separately preservation, constraints, scope, completion evidence, evidence sufficiency, and unresolved choices.
- Deterministic policy selects answer, discover, proceed, confirm-candidate, or ask-missing-information. Keep scope violations visible; confidence grants no authority. Codex writes prose and grounds questions in visible evidence.
- Limit automatic refinement to an initial and revised draft with one discovery pass between them. New user answers may begin another round.

## Hook, skill, and product state

- UserPromptSubmit reads bounded prompt/session/turn data and saved state, performs initial triage, and emits fixed trusted instructions plus labeled data. It does not discover repository facts or write goal prose. Never interpolate untrusted content as shell text or authoritative instructions.
- Off makes no judge call; observe records locally only when diagnostics are enabled and does not change task behavior; assist injects the workflow. The manual skill performs discovery, drafting, MCP assessment, and clarification.
- Reject oversize input with explicit fallback; never truncate intent. Apply a five-second total deadline including retries. Timeout, missing credentials, or invalid output means unavailable and falls back to clarification, with one concise notice per incident.
- Store versioned state in `PLUGIN_DATA`, keyed by session and workspace, including revision, source turn, accepted/inferred provenance, constraints, pending question, and assessment status. Updates are atomic; stale revisions fail; duplicate events are idempotent. Missing state does not revive an old goal. A narrow MCP operation records the assistant's handled update.
- Do not send attachments, transcripts, or repository files automatically. Explain that enabled remote triage sends prompt text; redact secrets. Diagnostics default to redacted metadata, with explicit content opt-in and deletion. Do not learn preferences silently.

## Host and package acceptance

Use the supported native hook schema and dedicated bundled Bun entrypoint. Verify placement, trust/install behavior, invocation, output handling, and goal-mode metadata on the installed Windows host. Mock/MCP tests do not prove host acceptance. Preserve current manifests, OpenRouter integration, and tools; hook failure must leave a path for clarification.
