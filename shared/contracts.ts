import { z } from "zod";

const nonEmptyText = z.string().trim().min(1);

export const modelSummarySchema = z
  .object({
    provider: nonEmptyText,
    id: nonEmptyText,
    name: nonEmptyText,
  })
  .strict();

export type ModelSummary = z.infer<typeof modelSummarySchema>;

export const runtimeStatusSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(["ready", "unavailable"]),
    message: nonEmptyText.optional(),
  })
  .strict();

export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const modelSelectionSchema = z
  .object({
    provider: nonEmptyText,
    id: nonEmptyText,
  })
  .strict();

export const sessionSelectionSchema = z
  .object({
    model: modelSelectionSchema.optional(),
  })
  .strict();

export type SessionSelection = z.infer<typeof sessionSelectionSchema>;

export const promptRequestSchema = z
  .object({
    text: nonEmptyText.max(100_000),
  })
  .strict();

export const flectEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn_started") }).strict(),
  z
    .object({
      type: z.literal("text_delta"),
      delta: z.string(),
    })
    .strict(),
  z.object({ type: z.literal("turn_completed") }).strict(),
  z.object({ type: z.literal("cancelled") }).strict(),
  z
    .object({
      type: z.literal("error"),
      message: nonEmptyText,
    })
    .strict(),
]);

export type FlectEvent = z.infer<typeof flectEventSchema>;

export const modelsResponseSchema = z
  .object({
    version: z.literal(1),
    models: z.array(modelSummarySchema),
  })
  .strict();

export const sessionResponseSchema = z
  .object({
    version: z.literal(1),
    sessionId: nonEmptyText,
  })
  .strict();

export const cancelResponseSchema = z
  .object({
    version: z.literal(1),
    status: z.literal("cancelled"),
  })
  .strict();

export const publicErrorSchema = z
  .object({
    version: z.literal(1),
    error: nonEmptyText,
  })
  .strict();
