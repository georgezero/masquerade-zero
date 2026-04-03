/**
 * Replaces all word packs with Animals, Japanese Food, Tennis Words.
 * Run: bun scripts/reseed-packs.ts
 */

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const client = createClient({ url: "file:data/masquerade.db" });
await client.execute("PRAGMA journal_mode=WAL;");
const db = drizzle(client, { schema });

// ── Wipe everything that references word_pairs or word_packs ─────────────────

// Disable FK checks so we can delete in any order
await client.execute("PRAGMA foreign_keys = OFF;");

await client.execute("DELETE FROM game_room_used_pairs");
await client.execute("DELETE FROM votes");
await client.execute("DELETE FROM clues");
await client.execute("DELETE FROM rounds");
await client.execute("DELETE FROM players");
await client.execute("DELETE FROM game_rooms");
await client.execute("DELETE FROM word_pairs");
await client.execute("DELETE FROM word_packs");

await client.execute("PRAGMA foreign_keys = ON;");

console.log("Cleared all existing data.");

// ── Seed data ────────────────────────────────────────────────────────────────

const packs: { name: string; category: string; pairs: { civilianWord: string; imposterWord: string }[] }[] = [
  {
    name: "Animals",
    category: "Nature",
    pairs: [
      { civilianWord: "Elephant", imposterWord: "Mammoth" },
      { civilianWord: "Dolphin", imposterWord: "Shark" },
      { civilianWord: "Eagle", imposterWord: "Hawk" },
      { civilianWord: "Tiger", imposterWord: "Leopard" },
      { civilianWord: "Penguin", imposterWord: "Puffin" },
      { civilianWord: "Gorilla", imposterWord: "Chimpanzee" },
      { civilianWord: "Crocodile", imposterWord: "Alligator" },
      { civilianWord: "Flamingo", imposterWord: "Heron" },
      { civilianWord: "Wolf", imposterWord: "Coyote" },
      { civilianWord: "Octopus", imposterWord: "Squid" },
      { civilianWord: "Giraffe", imposterWord: "Camel" },
      { civilianWord: "Cheetah", imposterWord: "Jaguar" },
      { civilianWord: "Parrot", imposterWord: "Macaw" },
      { civilianWord: "Polar Bear", imposterWord: "Grizzly Bear" },
      { civilianWord: "Kangaroo", imposterWord: "Wallaby" },
      { civilianWord: "Peacock", imposterWord: "Pheasant" },
      { civilianWord: "Whale", imposterWord: "Manatee" },
      { civilianWord: "Cobra", imposterWord: "Mamba" },
      { civilianWord: "Orangutan", imposterWord: "Gibbon" },
      { civilianWord: "Panda", imposterWord: "Raccoon" },
    ],
  },
  {
    name: "Japanese Food",
    category: "Food",
    pairs: [
      { civilianWord: "Sushi", imposterWord: "Sashimi" },
      { civilianWord: "Ramen", imposterWord: "Udon" },
      { civilianWord: "Tempura", imposterWord: "Karaage" },
      { civilianWord: "Miso Soup", imposterWord: "Dashi Broth" },
      { civilianWord: "Takoyaki", imposterWord: "Okonomiyaki" },
      { civilianWord: "Yakitori", imposterWord: "Teriyaki" },
      { civilianWord: "Onigiri", imposterWord: "Sando" },
      { civilianWord: "Matcha", imposterWord: "Hojicha" },
      { civilianWord: "Gyoza", imposterWord: "Shumai" },
      { civilianWord: "Tonkatsu", imposterWord: "Katsu Curry" },
      { civilianWord: "Edamame", imposterWord: "Snap Peas" },
      { civilianWord: "Mochi", imposterWord: "Daifuku" },
      { civilianWord: "Yakisoba", imposterWord: "Yaki Udon" },
      { civilianWord: "Tofu", imposterWord: "Natto" },
      { civilianWord: "Shabu-Shabu", imposterWord: "Sukiyaki" },
      { civilianWord: "Soba", imposterWord: "Ramen" },
      { civilianWord: "Taiyaki", imposterWord: "Dorayaki" },
      { civilianWord: "Karaage", imposterWord: "Tatsuta-Age" },
      { civilianWord: "Unagi", imposterWord: "Anago" },
      { civilianWord: "Wagashi", imposterWord: "Yokan" },
    ],
  },
  {
    name: "Tennis Words",
    category: "Sport",
    pairs: [
      { civilianWord: "Forehand", imposterWord: "Backhand" },
      { civilianWord: "Deuce", imposterWord: "Advantage" },
      { civilianWord: "Ace", imposterWord: "Winner" },
      { civilianWord: "Baseline", imposterWord: "Service Line" },
      { civilianWord: "Volley", imposterWord: "Half-Volley" },
      { civilianWord: "Topspin", imposterWord: "Backspin" },
      { civilianWord: "Grand Slam", imposterWord: "Masters" },
      { civilianWord: "Break Point", imposterWord: "Set Point" },
      { civilianWord: "Lob", imposterWord: "Drop Shot" },
      { civilianWord: "Tiebreak", imposterWord: "Super Tiebreak" },
      { civilianWord: "Serve", imposterWord: "Return" },
      { civilianWord: "Net", imposterWord: "Post" },
      { civilianWord: "Fault", imposterWord: "Let" },
      { civilianWord: "Rally", imposterWord: "Exchange" },
      { civilianWord: "Smash", imposterWord: "Overhead" },
      { civilianWord: "Slice", imposterWord: "Kick Serve" },
      { civilianWord: "Clay Court", imposterWord: "Hard Court" },
      { civilianWord: "Ballboy", imposterWord: "Line Judge" },
      { civilianWord: "Hawkeye", imposterWord: "Replay" },
      { civilianWord: "Wimbledon", imposterWord: "Roland Garros" },
    ],
  },
];

// ── Insert ────────────────────────────────────────────────────────────────────

for (const pack of packs) {
  const [inserted] = await db.insert(schema.wordPacks).values({ name: pack.name, category: pack.category }).returning();
  if (!inserted) continue;
  for (const pair of pack.pairs) {
    await db.insert(schema.wordPairs).values({ packId: inserted.id, civilianWord: pair.civilianWord, imposterWord: pair.imposterWord });
  }
  console.log(`Created "${pack.name}" with ${pack.pairs.length} pairs.`);
}

console.log("Done.");
process.exit(0);
