export const INGEST_KINDS = ["goal", "practice", "match", "diet", "exercise"] as const;

export type IngestKind = (typeof INGEST_KINDS)[number];
export type IngestSource = "api" | "mcp" | "journal-ai" | "manual";

export type GoalFields = {
  planText: string;
  weekStart: string;
};

export type PracticeFields = {
  coachName: string | null;
  date: string;
  notes: string;
  withCoach: boolean;
  workedOn: string;
};

export type MatchFields = {
  date: string;
  notes: string;
  opponent: string;
  score: string;
};

export type DietFields = {
  date: string;
  summary: string;
};

export type ExerciseFields = {
  date: string;
  durationMin: number;
  exerciseType: "Strength" | "Cardio" | "Mobility" | "Recovery" | "Other";
  notes: string;
};

export type IngestFieldsByKind = {
  diet: DietFields;
  exercise: ExerciseFields;
  goal: GoalFields;
  match: MatchFields;
  practice: PracticeFields;
};

export type IngestItem = {
  [K in IngestKind]: {
    confidence: number;
    fields: IngestFieldsByKind[K];
    kind: K;
    source: IngestSource;
    warnings: string[];
  };
}[IngestKind];

export type StructuredIngestInput = {
  confidence?: number;
  fields: unknown;
  kind: unknown;
  source?: IngestSource;
  warnings?: unknown;
};

export type StructuredIngestRequest = {
  dryRun?: boolean;
  items: StructuredIngestInput[];
  mode: "structured";
};

export type FreeformIngestRequest = {
  dryRun?: boolean;
  mode: "freeform";
  text: string;
};

export type IngestRequest = StructuredIngestRequest | FreeformIngestRequest;

export type IngestValidationError = {
  index: number;
  kind?: string;
  message: string;
};

export type IngestCreated = {
  index: number;
  kind: IngestKind;
};

export type IngestResult = {
  accepted: boolean;
  candidates: IngestItem[];
  created: IngestCreated[];
  errors: IngestValidationError[];
  warnings: string[];
};

export type PersistEntry = (userId: string, body: Record<string, unknown>) => Promise<void>;

export type IngestPersisters = {
  [K in IngestKind]: PersistEntry;
};
