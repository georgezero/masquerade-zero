export class IngestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "IngestError";
  }
}

export class UnsupportedIngestModeError extends IngestError {
  constructor(mode: string) {
    super("unsupported_mode", `Ingest mode '${mode}' is not supported yet.`);
    this.name = "UnsupportedIngestModeError";
  }
}
