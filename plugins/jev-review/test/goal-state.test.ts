import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "bun:test";

import {
  createGoalStateStore,
  MAX_PROCESSED_GOAL_EVENTS,
  type GoalStateIdentity,
  type GoalStateUpdate
} from "../src/goal/state.js";

async function withStore<T>(run: (pluginData: string) => Promise<T>): Promise<T> {
  const pluginData = await mkdtemp(join(tmpdir(), "jev-goal-state-"));
  try {
    return await run(pluginData);
  } finally {
    await rm(pluginData, { recursive: true, force: true });
  }
}

const primaryIdentity: GoalStateIdentity = {
  sessionId: "session-1",
  workspaceId: "workspace-a"
};

function update(
  overrides: Partial<GoalStateUpdate> & Pick<GoalStateUpdate, "expectedRevision" | "eventId" | "sourceTurnId">
): GoalStateUpdate {
  return { identity: primaryIdentity, ...overrides };
}

describe("versioned product goal state", () => {
  it("resumes persisted state after compaction and reports missing state for safe fallback", async () => {
    await withStore(async (pluginData) => {
      const firstProcess = createGoalStateStore({ pluginData });
      const created = await firstProcess.update(update({
        expectedRevision: 0,
        eventId: "event-1",
        sourceTurnId: "turn-1",
        goal: { text: "Add a focused status view", provenance: "accepted" },
        constraints: ["Keep existing APIs"],
        pendingQuestion: "Should filters persist?",
        assessmentStatus: "pending"
      }));
      assert.equal(created.status, "updated");

      const afterCompaction = await createGoalStateStore({ pluginData }).read(primaryIdentity);
      assert.equal(afterCompaction.status, "found");
      if (afterCompaction.status !== "found") return;
      assert.equal(afterCompaction.state.revision, 1);
      assert.equal(afterCompaction.state.sourceTurnId, "turn-1");
      assert.deepEqual(afterCompaction.state.goal, {
        text: "Add a focused status view",
        provenance: "accepted"
      });
      assert.equal(afterCompaction.state.pendingQuestion, "Should filters persist?");
      assert.deepEqual(afterCompaction.state.constraints, ["Keep existing APIs"]);

      const noSavedState = await createGoalStateStore({
        pluginData: join(pluginData, "new-plugin-data")
      }).read(primaryIdentity);
      assert.deepEqual(noSavedState, { status: "missing" });
    });
  });

  it("applies corrections as new revisions and retains accepted or inferred provenance", async () => {
    await withStore(async (pluginData) => {
      const store = createGoalStateStore({ pluginData });
      const first = await store.update(update({
        expectedRevision: 0,
        eventId: "event-1",
        sourceTurnId: "turn-1",
        goal: { text: "Add a settings page", provenance: "accepted" },
        pendingQuestion: "Which controls belong there?"
      }));
      assert.equal(first.status, "updated");

      const correction = await store.update(update({
        expectedRevision: 1,
        eventId: "event-2",
        sourceTurnId: "turn-2",
        goal: { text: "Add a compact account preferences panel", provenance: "inferred" },
        pendingQuestion: null,
        assessmentStatus: "complete"
      }));
      assert.equal(correction.status, "updated");
      if (correction.status !== "updated") return;
      assert.equal(correction.state.revision, 2);
      assert.deepEqual(correction.state.goal, {
        text: "Add a compact account preferences panel",
        provenance: "inferred"
      });
      assert.equal(correction.state.pendingQuestion, null);
      assert.equal(correction.state.assessmentStatus, "complete");
    });
  });

  it("isolates state by both session and workspace", async () => {
    await withStore(async (pluginData) => {
      const store = createGoalStateStore({ pluginData });
      const identities: GoalStateIdentity[] = [
        primaryIdentity,
        { sessionId: "session-2", workspaceId: "workspace-a" },
        { sessionId: "session-1", workspaceId: "workspace-b" }
      ];

      for (const [index, identity] of identities.entries()) {
        const result = await store.update({
          ...update({
            expectedRevision: 0,
            eventId: `event-${index}`,
            sourceTurnId: `turn-${index}`,
            goal: { text: `Goal ${index}`, provenance: "accepted" }
          }),
          identity
        });
        assert.equal(result.status, "updated");
      }

      const states = await Promise.all(identities.map((identity) => store.read(identity)));
      assert.deepEqual(states.map((result) => result.status), ["found", "found", "found"]);
      assert.deepEqual(states.map((result) => result.status === "found" ? result.state.goal?.text : null), [
        "Goal 0",
        "Goal 1",
        "Goal 2"
      ]);
    });
  });

  it("treats retained duplicate events as idempotent and rejects stale revisions", async () => {
    await withStore(async (pluginData) => {
      const store = createGoalStateStore({ pluginData });
      const initial = await store.update(update({
        expectedRevision: 0,
        eventId: "event-1",
        sourceTurnId: "turn-1",
        goal: { text: "Original goal", provenance: "accepted" }
      }));
      assert.equal(initial.status, "updated");

      const advanced = await store.update(update({
        expectedRevision: 1,
        eventId: "event-2",
        sourceTurnId: "turn-2",
        pendingQuestion: "One clarification"
      }));
      assert.equal(advanced.status, "updated");

      const duplicate = await store.update(update({
        expectedRevision: 0,
        eventId: "event-1",
        sourceTurnId: "turn-1",
        goal: { text: "Conflicting retry payload", provenance: "inferred" }
      }));
      assert.equal(duplicate.status, "duplicate");
      if (duplicate.status !== "duplicate") return;
      assert.equal(duplicate.state.revision, 2);
      assert.deepEqual(duplicate.state.goal, { text: "Original goal", provenance: "accepted" });
      assert.equal(duplicate.state.pendingQuestion, "One clarification");

      const stale = await store.update(update({
        expectedRevision: 1,
        eventId: "event-3",
        sourceTurnId: "turn-3",
        goal: { text: "Stale overwrite", provenance: "accepted" }
      }));
      assert.equal(stale.status, "stale");
      if (stale.status !== "stale") return;
      assert.equal(stale.state?.revision, 2);
      assert.deepEqual((await store.read(primaryIdentity)).status, "found");
    });
  });

  it("serializes concurrent writes against the same expected revision", async () => {
    await withStore(async (pluginData) => {
      const store = createGoalStateStore({ pluginData });
      const results = await Promise.all([
        store.update(update({
          expectedRevision: 0,
          eventId: "event-a",
          sourceTurnId: "turn-a",
          goal: { text: "First candidate", provenance: "accepted" }
        })),
        store.update(update({
          expectedRevision: 0,
          eventId: "event-b",
          sourceTurnId: "turn-b",
          goal: { text: "Second candidate", provenance: "accepted" }
        }))
      ]);

      assert.deepEqual(results.map((result) => result.status).sort(), ["stale", "updated"]);
      const saved = await store.read(primaryIdentity);
      assert.equal(saved.status, "found");
      if (saved.status === "found") assert.equal(saved.state.revision, 1);
    });
  });

  it("keeps event deduplication bounded and rejects an aged-out retry with its old revision", async () => {
    await withStore(async (pluginData) => {
      const store = createGoalStateStore({ pluginData });
      const first = await store.update(update({
        expectedRevision: 0,
        eventId: "old-event",
        sourceTurnId: "turn-0",
        goal: { text: "Retained goal", provenance: "accepted" }
      }));
      assert.equal(first.status, "updated");

      for (let index = 0; index < MAX_PROCESSED_GOAL_EVENTS; index += 1) {
        const result = await store.update(update({
          expectedRevision: index + 1,
          eventId: `event-${index}`,
          sourceTurnId: `turn-${index + 1}`
        }));
        assert.equal(result.status, "updated");
      }

      const current = await store.read(primaryIdentity);
      assert.equal(current.status, "found");
      if (current.status !== "found") return;
      assert.equal(current.state.processedEventIds.length, MAX_PROCESSED_GOAL_EVENTS);
      assert.equal(current.state.processedEventIds.includes("old-event"), false);

      // Once an ID ages out it is no longer recognized as a duplicate; the original
      // expected revision still prevents that retry from overwriting newer state.
      const agedOutRetry = await store.update(update({
        expectedRevision: 0,
        eventId: "old-event",
        sourceTurnId: "turn-0",
        goal: { text: "Old retry", provenance: "accepted" }
      }));
      assert.equal(agedOutRetry.status, "stale");
    });
  });

  it("reports missing and corrupt state without synthesizing or overwriting a goal", async () => {
    await withStore(async (pluginData) => {
      const store = createGoalStateStore({ pluginData });
      assert.deepEqual(await store.read(primaryIdentity), { status: "missing" });

      const absentStaleUpdate = await store.update(update({
        expectedRevision: 1,
        eventId: "old-event",
        sourceTurnId: "old-turn",
        goal: { text: "Must not be restored", provenance: "accepted" }
      }));
      assert.deepEqual(absentStaleUpdate, { status: "stale", state: null });
      assert.deepEqual(await store.read(primaryIdentity), { status: "missing" });

      const created = await store.update(update({
        expectedRevision: 0,
        eventId: "event-1",
        sourceTurnId: "turn-1",
        goal: { text: "Current goal", provenance: "accepted" }
      }));
      assert.equal(created.status, "updated");

      const stateDirectory = join(pluginData, "goal-assistance");
      const [stateFile] = await readdir(stateDirectory);
      assert.ok(stateFile);
      const statePath = join(stateDirectory, stateFile);
      const validState = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
      await writeFile(statePath, "{ truncated", "utf8");
      assert.deepEqual(await store.read(primaryIdentity), { status: "corrupt" });

      const refusedOverwrite = await store.update(update({
        expectedRevision: 1,
        eventId: "event-2",
        sourceTurnId: "turn-2",
        goal: { text: "Must not overwrite corruption", provenance: "accepted" }
      }));
      assert.deepEqual(refusedOverwrite, { status: "corrupt" });
      assert.equal(await readFile(statePath, "utf8"), "{ truncated");

      await writeFile(statePath, JSON.stringify({ ...validState, revision: "invalid" }), "utf8");
      assert.deepEqual(await store.read(primaryIdentity), { status: "corrupt" });
      const invalidShapeOverwrite = await store.update(update({
        expectedRevision: 1,
        eventId: "event-3",
        sourceTurnId: "turn-3",
        goal: { text: "Must not overwrite invalid state", provenance: "accepted" }
      }));
      assert.deepEqual(invalidShapeOverwrite, { status: "corrupt" });
      assert.equal(JSON.parse(await readFile(statePath, "utf8")).revision, "invalid");
    });
  });
});
