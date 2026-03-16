import {
  createDiet,
  createExercise,
  createGoal,
  createMatch,
  createPractice,
} from "../lib/app.js";
import { UnsupportedIngestModeError } from "./errors.js";
import { normalizeStructuredItem } from "./normalize.js";
import type {
  IngestCreated,
  IngestPersisters,
  IngestRequest,
  IngestResult,
  IngestValidationError,
} from "./types.js";

const defaultPersisters: IngestPersisters = {
  diet: createDiet,
  exercise: createExercise,
  goal: createGoal,
  match: createMatch,
  practice: createPractice,
};

export class IngestService {
  constructor(private readonly persisters: IngestPersisters = defaultPersisters) {}

  async ingest(userId: string, request: IngestRequest): Promise<IngestResult> {
    if (request.mode !== "structured") {
      throw new UnsupportedIngestModeError(request.mode);
    }

    const errors: IngestValidationError[] = [];
    const candidates = request.items
      .map((item, index) => {
        try {
          return normalizeStructuredItem(item, index);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Invalid payload.";
          errors.push({ index, kind: typeof item.kind === "string" ? item.kind : undefined, message });
          return null;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (errors.length > 0) {
      return {
        accepted: false,
        candidates,
        created: [],
        errors,
        warnings: candidates.flatMap((candidate) => candidate.warnings),
      };
    }

    const created: IngestCreated[] = [];

    if (!request.dryRun) {
      for (const [index, candidate] of candidates.entries()) {
        await this.persisters[candidate.kind](userId, candidate.fields as Record<string, unknown>);
        created.push({ index, kind: candidate.kind });
      }
    }

    return {
      accepted: true,
      candidates,
      created,
      errors: [],
      warnings: candidates.flatMap((candidate) => candidate.warnings),
    };
  }
}
