import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// ── Word content ─────────────────────────────────────────────────────────────

export const wordPacks = sqliteTable("word_packs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const wordPairs = sqliteTable("word_pairs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  packId: text("pack_id").notNull().references(() => wordPacks.id, { onDelete: "cascade" }),
  civilianWord: text("civilian_word").notNull(),
  imposterWord: text("imposter_word"), // nullable = imposter sees nothing (hard mode)
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

// ── Game state ────────────────────────────────────────────────────────────────

export const gameRooms = sqliteTable(
  "game_rooms",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    pin: text("pin").notNull(),
    status: text("status", { enum: ["waiting", "active", "finished"] }).notNull().default("waiting"),
    mode: text("mode", { enum: ["local", "online"] }).notNull().default("online"),
    phase: text("phase", { enum: ["lobby", "reveal", "clues", "voting", "result"] }).notNull().default("lobby"),
    roundNumber: integer("round_number").notNull().default(0),
    maxRounds: integer("max_rounds").notNull().default(3),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex("game_rooms_pin_unique").on(t.pin)],
);

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    roomId: text("room_id").notNull().references(() => gameRooms.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    role: text("role", { enum: ["civilian", "imposter"] }),
    word: text("word"), // null until game starts
    sessionToken: text("session_token").notNull().$defaultFn(() => crypto.randomUUID()),
    isHost: integer("is_host", { mode: "boolean" }).notNull().default(false),
    wordRevealed: integer("word_revealed", { mode: "boolean" }).notNull().default(false),
    joinedAt: text("joined_at").notNull().default(sql`(datetime('now'))`),
    eliminated: integer("eliminated", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("players_session_token_unique").on(t.sessionToken),
    uniqueIndex("players_room_nickname_unique").on(t.roomId, t.nickname),
    index("players_room_id_idx").on(t.roomId),
    index("players_session_idx").on(t.sessionToken),
  ],
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    roomId: text("room_id").notNull().references(() => gameRooms.id, { onDelete: "cascade" }),
    pairId: text("pair_id").references(() => wordPairs.id),
    roundNumber: integer("round_number").notNull(),
    speakingOrderJson: text("speaking_order_json").notNull().default("[]"),
    startedAt: text("started_at").notNull().default(sql`(datetime('now'))`),
    endedAt: text("ended_at"),
    imposterCaught: integer("imposter_caught", { mode: "boolean" }),
    winner: text("winner", { enum: ["civilians", "imposter"] }),
  },
  (t) => [uniqueIndex("rounds_room_round_unique").on(t.roomId, t.roundNumber)],
);

export const votes = sqliteTable(
  "votes",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    voterId: text("voter_id").notNull().references(() => players.id),
    targetId: text("target_id").notNull().references(() => players.id),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("votes_round_voter_unique").on(t.roundId, t.voterId),
    index("votes_round_idx").on(t.roundId),
  ],
);

export const clues = sqliteTable(
  "clues",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    playerId: text("player_id").notNull().references(() => players.id),
    clueText: text("clue_text").notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("clues_round_player_unique").on(t.roundId, t.playerId),
    index("clues_round_idx").on(t.roundId),
  ],
);

// Junction table: which word pairs have been used in a game room
export const gameRoomUsedPairs = sqliteTable(
  "game_room_used_pairs",
  {
    roomId: text("room_id").notNull().references(() => gameRooms.id, { onDelete: "cascade" }),
    pairId: text("pair_id").notNull().references(() => wordPairs.id),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.pairId] })],
);

// ── Relations ─────────────────────────────────────────────────────────────────

export const wordPacksRelations = relations(wordPacks, ({ many }) => ({
  pairs: many(wordPairs),
}));

export const wordPairsRelations = relations(wordPairs, ({ one }) => ({
  pack: one(wordPacks, { fields: [wordPairs.packId], references: [wordPacks.id] }),
}));

export const gameRoomsRelations = relations(gameRooms, ({ many }) => ({
  players: many(players),
  rounds: many(rounds),
}));

export const playersRelations = relations(players, ({ one }) => ({
  room: one(gameRooms, { fields: [players.roomId], references: [gameRooms.id] }),
}));

export const roundsRelations = relations(rounds, ({ one, many }) => ({
  room: one(gameRooms, { fields: [rounds.roomId], references: [gameRooms.id] }),
  clues: many(clues),
  votes: many(votes),
}));

export const cluesRelations = relations(clues, ({ one }) => ({
  round: one(rounds, { fields: [clues.roundId], references: [rounds.id] }),
  player: one(players, { fields: [clues.playerId], references: [players.id] }),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  round: one(rounds, { fields: [votes.roundId], references: [rounds.id] }),
  voter: one(players, { fields: [votes.voterId], references: [players.id] }),
  target: one(players, { fields: [votes.targetId], references: [players.id] }),
}));
