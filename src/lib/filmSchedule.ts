import { z } from "zod";
import {
  filmRoundLockMetadataSchema,
  type FilmRoundLockMetadata,
} from "./filmRound";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

const dateTimeSchema = z.string().datetime({ offset: true });

const scheduleFieldsSchema = z
  .object({
    boardId: identifierSchema,
    clubId: identifierSchema,
    screeningId: identifierSchema,
    voteStartsAt: dateTimeSchema,
    voteEndsAt: dateTimeSchema,
    resultsAt: dateTimeSchema,
    scheduledAt: dateTimeSchema,
    displayUntil: dateTimeSchema,
    venue: z.string().trim().min(1).max(256),
    published: z.boolean(),
    metadata: filmRoundLockMetadataSchema,
  })
  .strict();

const validateTimeline = (
  input: {
    voteStartsAt: string;
    voteEndsAt: string;
    resultsAt: string;
    scheduledAt: string;
    displayUntil: string;
  },
  context: z.RefinementCtx,
): void => {
  const startsAt = Date.parse(input.voteStartsAt);
  const endsAt = Date.parse(input.voteEndsAt);
  const resultsAt = Date.parse(input.resultsAt);
  const scheduledAt = Date.parse(input.scheduledAt);
  const displayUntil = Date.parse(input.displayUntil);

  if (!(startsAt < endsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["voteEndsAt"],
      message: "voteStartsAt must be before voteEndsAt.",
    });
  }
  if (!(endsAt <= resultsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resultsAt"],
      message: "voteEndsAt must be at or before resultsAt.",
    });
  }
  if (!(resultsAt <= scheduledAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["scheduledAt"],
      message: "resultsAt must be at or before scheduledAt.",
    });
  }
  if (!(scheduledAt < displayUntil)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["displayUntil"],
      message: "scheduledAt must be before displayUntil.",
    });
  }
};

export const filmScheduleInputSchema =
  scheduleFieldsSchema.superRefine(validateTimeline);

export const scheduledFilmRoundSchema = scheduleFieldsSchema
  .extend({
    completedAt: dateTimeSchema.nullable(),
    revision: z.number().int().nonnegative(),
  })
  .superRefine(validateTimeline);

export type FilmScheduleInput = z.infer<typeof filmScheduleInputSchema>;
export type ScheduledFilmRound = z.infer<typeof scheduledFilmRoundSchema>;

export type { FilmRoundLockMetadata };

/**
 * The database stores this object as JSON. Keeping its shape in one strict
 * schema makes the schedule metadata the same frozen catalogue used to build
 * the eventual round snapshot.
 */
export const parseFilmScheduleInput = (input: unknown): FilmScheduleInput =>
  filmScheduleInputSchema.parse(input);

export const parseScheduledFilmRound = (input: unknown): ScheduledFilmRound =>
  scheduledFilmRoundSchema.parse(input);
