import { ZodError } from "zod";

import { IngestError } from "./errors.js";
import { ingestFieldsByKindSchema, ingestItemInputSchema } from "./schemas.js";
import type { IngestItem, IngestKind, StructuredIngestInput } from "./types.js";

function toValidationMessage(error: ZodError): string {
  const first = error.issues[0];
  if (!first) {
    return "Invalid payload.";
  }
  return first.message;
}

export function normalizeStructuredItem(input: StructuredIngestInput, index: number): IngestItem {
  let base: ReturnType<typeof ingestItemInputSchema.parse>;
  try {
    base = ingestItemInputSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new IngestError("validation_error", toValidationMessage(error));
    }
    throw error;
  }

  const kind = base.kind as IngestKind;
  const fieldsSchema = ingestFieldsByKindSchema[kind];

  try {
    const fields = fieldsSchema.parse(base.fields);
    return {
      confidence: base.confidence,
      fields,
      kind,
      source: base.source,
      warnings: base.warnings,
    } as IngestItem;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new IngestError("validation_error", `Item ${index}: ${toValidationMessage(error)}`);
    }
    throw error;
  }
}
