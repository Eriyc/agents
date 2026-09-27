# Goal assistance: behavior contract

## Interpret the whole request

Classify primary intent as answer, discuss, investigate, implement, or mixed;
retain secondary intents. Separately classify relationship to current work as
new, refine, replace, answer-to-clarification, or unrelated. Questions can request
actions. Short replies such as "yes" need the pending question and prior goal.
Use explicit unknown/abstain outcomes when supplied context is inadequate.

Goal status is clear, inferable, ambiguous, absent, or not-needed. Investigation
has a valid deliverable: findings or a recommendation can establish completion.
An ordinary answer need not become a tracked autonomous goal.

## Draft an achievable goal

Codex supplies outcome, deliverable, in/out scope, completion evidence, constraints,
assumptions, and unresolved decisions. Preserve explicit user wording where useful.
Distinguish user statements, repository facts, and inferred assumptions. Reference
the supporting prompt/context for consequential commitments. Do not invent numeric
acceptance targets or silently replace user criteria with generic quality scores.

Inspect relevant repository evidence before asking factual questions it can
answer. Bound discovery to relevant docs, code and tests; report what was inspected
and what remains unknown. Repository conventions cannot resolve user preferences.
An incomplete scan means unknown, not proof that information does not exist.

## Assess and choose the next action

Judge separately: preservation of requested outcome, coverage of explicit
constraints, unsupported scope, observable completion, sufficiency of supplied
evidence, and unresolved material choices. Keep raw signals; do not average away
a scope violation. Deterministic policy selects answer, discover, proceed,
confirm-candidate, or ask-missing-information. Confidence alone grants no authority.

In assist mode, state a concise inferred goal before substantial work when useful.
Proceed on a clear supported interpretation within existing authorization. If a
candidate depends on a core concept or material preference, present it and ask
about that exact assumption. If no defensible candidate exists, offer plausible
outcomes and ask a focused question rather than "please define a goal".

Ask one compact question at a time, normally with two or three meaningful options
and free text. Multiple related unknowns may be grouped when that is easier.
Do not treat silence as agreement. Allow useful independent investigation while
awaiting an answer; stop dependent implementation. Never reconfirm an already
settled decision unless new evidence conflicts with it.

Bound automated refinement to one initial draft and one revised draft per turn,
with at most one targeted discovery pass between them. Then ask the user rather
than loop. Additional user answers can legitimately start another clarification
round; do not cap the user's ability to explore.

## Continuation and controls

Preserve accepted goals through clarification and follow-ups. Corrections update
the relevant constraint; a status question does not replace the goal. Explicit
cancellation/replacement wins. A detailed prompt can proceed without a redundant
interview. User overrides remain visible as user decisions, not judge approvals.

Off does no judging. Observe records recommendations locally when diagnostics are
enabled but does not alter the agent's task behavior. Assist injects the workflow.
Native goal mode is entered only under the host's explicit authorization rules;
the plugin must not simulate or automatically invoke `/goal` from an inferred goal.

## Motivating regression

Screenshot example: "Explore" native iOS/Android headers, retain thumb-reachable
primary actions, and consider secondary actions in headers. Expected candidate:
evaluate fit by screen type and recommend action placement. Implementing native
stack headers immediately is an unsupported expansion. The screenshot is example
evidence, not an instruction to change this repository's UI.
