/**
 * Game state logic — pure functions, no HTTP concerns.
 *
 * Phase state machine:
 *   lobby → reveal → clues → voting → result
 *                              ↑
 *          (new round) ────────┘  or  finished
 */

import { db, schema } from "../db/index.js";
import { and, eq, inArray, notInArray } from "drizzle-orm";

export type Player = typeof schema.players.$inferSelect;
export type GameRoom = typeof schema.gameRooms.$inferSelect;
export type Round = typeof schema.rounds.$inferSelect;
export type Vote = typeof schema.votes.$inferSelect;

// ── Role assignment ──────────────────────────────────────────────────────────

/**
 * Returns player IDs mapped to roles.
 * Exactly one imposter, randomly chosen.
 */
export function assignRoles(players: Player[]): Map<string, "civilian" | "imposter"> {
  const ids = players.map((p) => p.id);
  const imposterIndex = Math.floor(Math.random() * ids.length);
  const result = new Map<string, "civilian" | "imposter">();
  for (let i = 0; i < ids.length; i++) {
    result.set(ids[i]!, i === imposterIndex ? "imposter" : "civilian");
  }
  return result;
}

// ── Word pair selection ──────────────────────────────────────────────────────

/**
 * Selects a random active word pair from the pack, excluding already-used pairs.
 * Returns null if no unused pairs remain.
 */
export async function selectWordPair(packId: string, usedPairIds: string[]) {
  const query = db
    .select()
    .from(schema.wordPairs)
    .where(
      and(
        eq(schema.wordPairs.packId, packId),
        eq(schema.wordPairs.active, true),
        usedPairIds.length > 0
          ? notInArray(schema.wordPairs.id, usedPairIds)
          : undefined,
      ),
    );

  const available = await query;
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)]!;
}

// ── Phase completion checks ──────────────────────────────────────────────────

/**
 * Returns true when all active (non-eliminated) players have revealed their word.
 */
export function isRevealComplete(players: Player[]): boolean {
  const active = players.filter((p) => !p.eliminated);
  return active.length > 0 && active.every((p) => p.wordRevealed);
}

/**
 * Returns true when all active players have submitted a clue this round.
 */
export function isCluesComplete(
  players: Player[],
  cluePlayerIds: string[],
): boolean {
  const active = players.filter((p) => !p.eliminated);
  const submitted = new Set(cluePlayerIds);
  return active.length > 0 && active.every((p) => submitted.has(p.id));
}

/**
 * Returns true when all eligible (active, non-eliminated) players have voted.
 */
export function isVotingComplete(
  players: Player[],
  voterIds: string[],
): boolean {
  const eligible = players.filter((p) => !p.eliminated);
  const voted = new Set(voterIds);
  return eligible.length > 0 && eligible.every((p) => voted.has(p.id));
}

// ── Vote counting ────────────────────────────────────────────────────────────

export type VoteResult =
  | { eliminated: string; tie: false }
  | { eliminated: null; tie: true };

/**
 * Counts votes and returns the player to eliminate.
 * On a tie, returns null (no elimination, game continues).
 */
export function countVotes(votes: Vote[]): VoteResult {
  const tally = new Map<string, number>();
  for (const vote of votes) {
    tally.set(vote.targetId, (tally.get(vote.targetId) ?? 0) + 1);
  }
  if (tally.size === 0) return { eliminated: null, tie: true };

  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const [topId, topCount] = sorted[0]!;
  const secondCount = sorted[1]?.[1] ?? 0;

  if (topCount === secondCount) {
    return { eliminated: null, tie: true };
  }
  return { eliminated: topId, tie: false };
}

// ── Speaking order ───────────────────────────────────────────────────────────

/**
 * Returns a randomly shuffled array of active player IDs for speaking order.
 */
export function generateSpeakingOrder(players: Player[]): string[] {
  const active = players.filter((p) => !p.eliminated).map((p) => p.id);
  for (let i = active.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [active[i], active[j]] = [active[j]!, active[i]!];
  }
  return active;
}

// ── Used pairs helper ────────────────────────────────────────────────────────

export async function getUsedPairIds(roomId: string): Promise<string[]> {
  const used = await db
    .select({ pairId: schema.gameRoomUsedPairs.pairId })
    .from(schema.gameRoomUsedPairs)
    .where(eq(schema.gameRoomUsedPairs.roomId, roomId));
  return used.map((r) => r.pairId);
}

// ── Room + players helpers ───────────────────────────────────────────────────

export async function getRoomWithPlayers(pin: string) {
  const room = await db.query.gameRooms.findFirst({
    where: eq(schema.gameRooms.pin, pin),
  });
  if (!room) return null;

  const players = await db.query.players.findMany({
    where: eq(schema.players.roomId, room.id),
  });
  return { room, players };
}

export async function getCurrentRound(roomId: string) {
  const rounds = await db.query.rounds.findMany({
    where: eq(schema.rounds.roomId, roomId),
    orderBy: (r, { desc }) => [desc(r.roundNumber)],
  });
  return rounds[0] ?? null;
}

export async function getRoundClues(roundId: string) {
  return db.query.clues.findMany({
    where: eq(schema.clues.roundId, roundId),
  });
}

export async function getRoundVotes(roundId: string) {
  return db.query.votes.findMany({
    where: eq(schema.votes.roundId, roundId),
  });
}

// ── Random active pack ───────────────────────────────────────────────────────

export async function pickRandomActivePack() {
  const packs = await db.select().from(schema.wordPacks).where(eq(schema.wordPacks.active, true));
  if (packs.length === 0) return null;
  return packs[Math.floor(Math.random() * packs.length)]!;
}

// ── PIN generation ───────────────────────────────────────────────────────────

export async function generatePin(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const existing = await db.query.gameRooms.findFirst({
      where: and(
        eq(schema.gameRooms.pin, pin),
        inArray(schema.gameRooms.status, ["waiting", "active"]),
      ),
    });
    if (!existing) return pin;
  }
  throw new Error("Could not generate a unique PIN after 10 attempts");
}
