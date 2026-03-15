import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(repoRoot, "drizzle");

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not configured.");
}

const sql = neon(databaseUrl);

async function ensureMigrationTable() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS "__app_migrations" (
      "id" bigserial PRIMARY KEY,
      "name" text NOT NULL UNIQUE,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function listMigrationFiles() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function listAppliedMigrations() {
  const rows = await sql.query(`SELECT "name" FROM "__app_migrations" ORDER BY "name"`);
  return new Set(rows.map((row) => String(row.name)));
}

async function applyMigration(name) {
  const filePath = path.join(migrationsDir, name);
  const statementText = await fs.readFile(filePath, "utf8");
  const statements = statementText
    .split(/;\s*\n/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  if (statements.length === 0) {
    console.log(`Skipping empty migration ${name}`);
    return;
  }

  console.log(`Applying ${name}`);
  for (const statement of statements) {
    await sql.query(statement);
  }
  await sql.query(`INSERT INTO "__app_migrations" ("name") VALUES ($1)`, [name]);
}

async function markApplied(names) {
  if (names.length === 0) {
    throw new Error("Provide at least one migration filename after --mark-applied.");
  }

  for (const name of names) {
    await sql.query(
      `INSERT INTO "__app_migrations" ("name") VALUES ($1) ON CONFLICT ("name") DO NOTHING`,
      [name],
    );
    console.log(`Marked ${name} as applied`);
  }
}

async function main() {
  await sql.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  await ensureMigrationTable();

  const markAppliedIndex = process.argv.indexOf("--mark-applied");
  if (markAppliedIndex >= 0) {
    await markApplied(process.argv.slice(markAppliedIndex + 1));
    return;
  }

  const [files, applied] = await Promise.all([
    listMigrationFiles(),
    listAppliedMigrations(),
  ]);

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    await applyMigration(file);
    appliedCount += 1;
  }

  if (appliedCount === 0) {
    console.log("No pending migrations.");
    return;
  }

  console.log(`Applied ${appliedCount} migration${appliedCount === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
