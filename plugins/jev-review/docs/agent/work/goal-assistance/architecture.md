# Goal assistance: architecture contract

## Boundaries

Keep three layers: provider evaluation, goal assistance policy, Codex integration.
Expose `jev_evaluate` (working name) accepting bounded state and typed questions,
returning validated native answers, model identity and available usage metadata.
It must accept prompts without fake file wrappers. Move shared question types
out of the code-review-specific module without changing existing tool contracts.

Define a small injected judge interface for goal assessment, normalizing signals
while retaining native results and provenance. Jev is the first implementation;
a deterministic fake verifies replacement without shipping another paid provider.
Do not assume every future model has Jev's calibration or probability semantics.
Codex generates prose, repository summaries and questions. Judge outputs are not
explanations: any rationale must be grounded in visible evidence by Codex.

## Hook and skill

Prefer a bundled command hook using the existing Bun runtime, shared policy code,
and a dedicated built entrypoint. This avoids relying on MCP readiness at prompt
submission and permits fixed guidance when the remote judge is unavailable.
MCP-tool hooks are documented as supported; they are an alternative only if a
host smoke test establishes readiness, naming and output compatibility.

UserPromptSubmit receives prompt/session/turn identifiers and bounded saved state.
Do initial triage only; it cannot gather all repository facts or generate a prose
goal. Return compact trusted workflow instructions plus clearly labeled data.
In assist mode the skill performs context gathering, candidate creation, MCP
assessment and questioning. Do not hard-block prompt submission for ambiguity:
the assistant must be able to ask the user. This is behavioral assistance, not a
complete write-enforcement boundary. Do not claim it prevents every possible edit.

Never interpolate prompt, attachment or repository content as executable shell
text or authoritative developer instructions. Hook output uses a fixed policy
envelope; quoted evidence and model results remain data. Bound input/output and
reject oversize inputs with an explicit fallback; never silently truncate intent.
Revalidate native hook trust/install behavior on the installed Windows Codex host.

## Session state and budgets

Store versioned state under PLUGIN_DATA, scoped to session and workspace. Record
goal revision, source turn, accepted/inferred provenance, constraints, pending
question, and assessment status. Provide a narrow MCP operation to update it after
the assistant handles an answer. Use atomic writes and reject stale revisions;
duplicate hook events must be idempotent. Never use a workspace-global goal.

Avoid parsing the full host transcript: its format is unstable. Missing state
falls back to conversation context; never silently resurrect an old goal. Test
resume, workspace isolation, corrections and compaction. Host mode metadata may
be absent; unknown mode is not evidence that native goal mode was requested.

Use versioned rubrics and configurable thresholds/uncertainty bands, validated at
startup. Defaults are provisional and tuned on development cases only. Bound the
hook to a five-second total deadline, including retries. Judge errors yield
unavailable, never a pass. Fall back to Codex clarification, with a concise notice
once per incident; do not disable assistance or repeatedly interrupt the user.

## Data and compatibility

Reuse credential/provider setup without logging keys. Do not automatically send
attachments, full transcripts or repository files. Document that enabled remote
triage sends submitted prompt text; filter secrets and use only bounded relevant
context. Diagnostics default to metadata, redact content, and offer explicit
content-recording opt-in and deletion. User tuning is explicit, not silent
learning. Preserve Bun packaging, current MCP tools, and both existing providers.
