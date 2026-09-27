# Goal assistance: evidence and starting points

## Repository inspection (2026-09-27)

- `src/mcp/server.ts`, `createMcpServer`: exposes only `jev_review` and
  `jev_signal`; injected functions support offline MCP tests.
- `src/signal/signal.ts`, `signalInputSchema` and `signalWithJev`: requires a
  file; uses two Nouls and turns the judgment into null below evidence 0.5.
  This existing file-specific threshold is not a calibrated prompt-policy default.
- `src/jev/client.ts`, `JevClient.evaluate`: arbitrary state plus typed questions,
  bounded retries and response validation. Its 30-second per-attempt default is
  unsuitable for an every-prompt hook without a separate total deadline.
- `src/evaluation/questions.ts`: already defines Choice, Score and Noul request
  types, but couples them to review metric construction.
- `src/jev/schema.ts`: validates all three native answer types.
- `src/jev/provider.ts`, `src/config/environment.ts`: direct TypeSafe and OpenRouter
  routing, environment overrides and PLUGIN_DATA credential persistence.
- `skills/jev-review/SKILL.md`: current skill concerns code-quality review after
  implementation and one-off file judgments; goal assistance needs a distinct flow.
- `package.json`, `mcp.json`, `.mcp.json`, `plugin.json`, `test/package.test.ts`:
  Bun build/distribution and plugin configuration; no hook integration was found.
- `test/mcp.test.ts`: in-memory and bundled stdio coverage; exact tool-list
  assertions must change intentionally when adding tools.
- `scripts/work-ledger.ts`, `scripts/check-work-context.ts`,
  `docs/agent/work/README.md`: existing Beads context/ownership infrastructure.

No repository AGENTS.md or routed CONTEXT.md was found in the inspected checkout.
At exploration time the nested Jev checkout was clean; the parent had unrelated
agents-ledger edits. Recheck status before implementation and preserve that work.

## Prior experiment

`experiments/prompt-loop/report.md` records a small synthetic support experiment:
control revision 12/12, Jev-guided revision 11/12, baseline 10/12. Some Jev-positive
judgments disagreed with reference labels. It does not establish whether goal
assistance helps this user, and is not a reason to abandon the product direction.
It motivates comparing the workflow alone against adding an external judge.

## External facts checked

[Codex hooks](https://learn.chatgpt.com/docs/hooks), checked 2026-09-27:
UserPromptSubmit receives prompt and turn information; can add developer context
or block submission. Command and MCP-tool handlers are supported, while prompt and
agent handlers are skipped. MCP hooks use existing connections and do not block
on missing servers/errors. Plugin hooks require trust. Transcript format is not
stable. These constraints motivate fixed policy envelopes and a command-hook v1.

[TypeSafe introduction](https://docs.typesafe.ai/introduction): Jev returns typed
Choice, Score and Noul answers and permits mixed, independently evaluated questions
against the same state. It does not generate goal prose. Narrow questions are the
appropriate unit; goal construction remains with Codex.

## Implementation uncertainties with bounded resolution

Verify installed host hook behavior, native goal metadata availability, Windows
paths and packaging in the integration task. Keep a manual skill entrypoint if
the host cannot run hooks. Do not claim native `/goal` interception without an
observed supported interface. Provider request limits and judge thresholds must
be validated against the selected model before fixing schemas or calibration.
These are integration/evaluation checks, not missing user product decisions.
