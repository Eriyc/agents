import { z } from "zod";

import { parseJevState } from "../jev/schema.js";

const boundedText = z.string().trim().min(1).max(2_048);
const choiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: boundedText,
  criteria: z.record(z.string().min(1).max(128), boundedText).refine(
    (criteria) => Object.keys(criteria).length >= 2 && Object.keys(criteria).length <= 32,
    { message: "Choice questions need between 2 and 32 criteria." }
  )
}).strict();
const scoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: boundedText,
  criteria: z.array(boundedText).min(2).max(32)
}).strict();
const noulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: boundedText,
  criteria: z.object({ true: boundedText, false: boundedText }).strict()
}).strict();

export const jevEvaluateInputSchema = z.object({
  state: z.json().superRefine((value, context) => {
    try {
      parseJevState(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Jev state is invalid."
      });
    }
  }),
  questions: z.record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,127}$/),
    z.discriminatedUnion("type", [choiceQuestionSchema, scoreQuestionSchema, noulQuestionSchema])
  ).refine((questions) => Object.keys(questions).length >= 1 && Object.keys(questions).length <= 64, {
    message: "Supply between 1 and 64 typed questions."
  })
}).strict();

const idSchema = z.string().min(1).max(4_096).refine((value) => value.trim().length > 0);
const identitySchema = z.object({ sessionId: idSchema, workspaceId: idSchema }).strict();
const storedGoalSchema = z.object({
  text: z.string().min(1).max(16_384).refine((value) => value.trim().length > 0),
  provenance: z.enum(["accepted", "inferred"])
}).strict();
const constraintsSchema = z.array(z.string().max(8_192)).max(256);
const assessmentStatusSchema = z.enum(["pending", "complete", "unavailable"]);

/** Only the assistant's handled goal update is writable through MCP. */
export const goalStateUpdateInputSchema = z.object({
  identity: identitySchema,
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  eventId: idSchema,
  sourceTurnId: idSchema,
  goal: storedGoalSchema.nullable().optional(),
  constraints: constraintsSchema.optional(),
  pendingQuestion: z.string().max(16_384).nullable().optional(),
  assessmentStatus: assessmentStatusSchema.optional()
}).strict();

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  identity: identitySchema,
  revision: z.number().int().min(1),
  sourceTurnId: idSchema,
  goal: storedGoalSchema.nullable(),
  constraints: constraintsSchema,
  pendingQuestion: z.string().max(16_384).nullable(),
  assessmentStatus: assessmentStatusSchema,
  processedEventIds: z.array(idSchema).min(1).max(128)
}).strict();

export const goalStateUpdateOutputSchema = z.object({
  status: z.enum(["updated", "duplicate", "stale", "corrupt"]),
  state: stateSchema.nullable().optional()
}).strict().superRefine((value, context) => {
  if (value.status === "corrupt" && value.state !== undefined) {
    context.addIssue({ code: "custom", message: "Corrupt state has no readable value." });
  }
  if (value.status !== "corrupt" && value.state === undefined) {
    context.addIssue({ code: "custom", message: "State result is missing its value." });
  }
  if ((value.status === "updated" || value.status === "duplicate") && value.state === null) {
    context.addIssue({ code: "custom", message: "Successful state update needs a value." });
  }
});
