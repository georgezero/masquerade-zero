/**
 * Pack seeder. Loads JSON files from data/packs/ into the database.
 *
 * Usage:
 *   npx tsx scripts/seed-packs.ts                        # upsert all packs
 *   npx tsx scripts/seed-packs.ts animals                # upsert one pack
 *   npx tsx scripts/seed-packs.ts animals animals2       # upsert multiple packs
 *   npx tsx scripts/seed-packs.ts --reset                # clear DB and reload all packs
 *   npx tsx scripts/seed-packs.ts --reset animals animals2  # clear DB and load specific packs
 *
 * Works against any DATABASE_URL (SQLite file or Neon/Postgres connection string).
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/index.js";

interface PackFile {
  name: string;
  category: string;
  description?: string;
  pairs: { civilianWord: string; imposterWord?: string }[];
}

const PACKS_DIR = resolve(import.meta.dirname, "../data/packs");

function loadPackFiles(names: string[]): { file: string; data: PackFile }[] {
  const files = readdirSync(PACKS_DIR).filter((f) => f.endsWith(".json"));
  const targets = names.length > 0
    ? names.map((name) => {
        const file = files.find((f) => f.replace(".json", "") === name);
        if (!file) {
          console.error(`No pack file found for "${name}" in ${PACKS_DIR}`);
          process.exit(1);
        }
        return file;
      })
    : files;
  return targets.map((file) => ({
    file,
    data: JSON.parse(readFileSync(resolve(PACKS_DIR, file), "utf-8")) as PackFile,
  }));
}

async function clearDb() {
  await db.delete(schema.gameRoomUsedPairs);
  await db.delete(schema.votes);
  await db.delete(schema.clues);
  await db.delete(schema.rounds);
  await db.delete(schema.players);
  await db.delete(schema.gameRooms);
  await db.delete(schema.wordPairs);
  await db.delete(schema.wordPacks);
  console.log("Database cleared.");
}

async function seedPack(data: PackFile) {
  await db.insert(schema.wordPacks)
    .values({ name: data.name, category: data.category, description: data.description })
    .onConflictDoNothing();

  const pack = await db.query.wordPacks.findFirst({
    where: eq(schema.wordPacks.name, data.name),
  });
  if (!pack) throw new Error(`Failed to find or create pack "${data.name}"`);

  let inserted = 0;
  let updated = 0;
  for (const pair of data.pairs) {
    const existing = await db.query.wordPairs.findFirst({
      where: (t, { and, eq }) => and(eq(t.packId, pack.id), eq(t.civilianWord, pair.civilianWord)),
    });
    const result = await db.insert(schema.wordPairs)
      .values({ packId: pack.id, civilianWord: pair.civilianWord, imposterWord: pair.imposterWord })
      .onConflictDoUpdate({
        target: [schema.wordPairs.packId, schema.wordPairs.civilianWord],
        set: { imposterWord: pair.imposterWord },
      })
      .returning();
    if (result.length > 0) {
      if (!existing) inserted++;
      else if (existing.imposterWord !== pair.imposterWord) updated++;
    }
  }

  const skipped = data.pairs.length - inserted - updated;
  console.log(`"${data.name}": ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
}

// Parse args: strip --reset flag, rest are pack names
const args = process.argv.slice(2);
const reset = args.includes("--reset");
const names = args.filter((a) => a !== "--reset");

if (reset) await clearDb();

const packs = loadPackFiles(names);
for (const { data } of packs) {
  await seedPack(data);
}

console.log("Done.");
process.exit(0);
