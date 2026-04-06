import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  assignRoles,
  countVotes,
  generatePin,
  generateSpeakingOrder,
  getCurrentRound,
  getRoomWithPlayers,
  getRoundClues,
  getRoundVotes,
  getUsedPairIds,
  isCluesComplete,
  isRevealComplete,
  isVotingComplete,
  pickRandomActivePack,
  selectWordPair,
} from "../lib/game.js";
import {
  getPlayerFromCookie,
  requirePlayerInRoom,
  setPlayerCookie,
} from "../lib/session.js";
import {
  cluesPage,
  joinPage,
  landingPage,
  localSetupPage,
  lobbyPage,
  lobbyPlayersFragment,
  resultPage,
  revealPage,
  revealWaitingPage,
  votingPage,
  stateFragment,
} from "../templates/game.js";
import { errorPage } from "../templates/page.js";

export const gameRouter = new Hono();

// ── Landing ──────────────────────────────────────────────────────────────────

gameRouter.get("/", (c) => c.html(landingPage()));

// ── Create room ──────────────────────────────────────────────────────────────

gameRouter.post("/rooms", async (c) => {
  const body = await c.req.parseBody();
  const mode = body.mode === "local" ? "local" : "online";

  const pin = await generatePin();
  const [room] = await db
    .insert(schema.gameRooms)
    .values({ pin, mode })
    .returning();

  if (mode === "local") return c.redirect(`/rooms/${room!.pin}/local-setup`);
  return c.redirect(`/rooms/${room!.pin}/join-host`);
});

// Shortcut: join by PIN form on landing page
gameRouter.post("/rooms/join", async (c) => {
  const body = await c.req.parseBody();
  const pin = String(body.pin ?? "").trim();
  if (!pin) return c.redirect("/");
  return c.redirect(`/rooms/${pin}/join-host`);
});

// GET /rooms/:pin/join-host — show nickname form
gameRouter.get("/rooms/:pin/join-host", async (c) => {
  const { pin } = c.req.param();
  const room = await db.query.gameRooms.findFirst({
    where: eq(schema.gameRooms.pin, pin),
  });
  if (!room) return c.html(errorPage("Room not found"), 404);
  return c.html(joinPage(pin));
});

// ── Local setup (all names at once) ─────────────────────────────────────────

gameRouter.get("/rooms/:pin/local-setup", async (c) => {
  const { pin } = c.req.param();
  const room = await db.query.gameRooms.findFirst({ where: eq(schema.gameRooms.pin, pin) });
  if (!room || room.mode !== "local") return c.html(errorPage("Room not found"), 404);
  // If already started, go to room
  if (room.status !== "waiting") return c.redirect(`/rooms/${pin}`);
  return c.html(localSetupPage(pin));
});

gameRouter.post("/rooms/:pin/local-setup", async (c) => {
  const { pin } = c.req.param();
  const room = await db.query.gameRooms.findFirst({ where: eq(schema.gameRooms.pin, pin) });
  if (!room || room.mode !== "local" || room.status !== "waiting") return c.redirect("/");

  const body = await c.req.parseBody({ all: true });
  const rawNames = Array.isArray(body.names) ? body.names : [body.names];
  const names = rawNames.map((n) => String(n ?? "").trim().slice(0, 24)).filter(Boolean);

  if (names.length < 3 || names.length > 8) {
    return c.html(localSetupPage(pin, "Need 3–8 players"));
  }

  // Check for duplicate names
  if (new Set(names).size !== names.length) {
    return c.html(localSetupPage(pin, "Each player needs a unique name"));
  }

  // Create all players
  const playerRows = await Promise.all(
    names.map((nickname, i) =>
      db.insert(schema.players).values({ roomId: room.id, nickname, isHost: i === 0 }).returning(),
    ),
  );
  const players = playerRows.map((r) => r[0]!);

  // Set session cookie to first player (device identifier for this room)
  setPlayerCookie(c, players[0]!.sessionToken);

  // Pick word pack + pair
  const pack = await pickRandomActivePack();
  if (!pack) return c.html(errorPage("No active word packs. Add some in /admin first."), 400);

  const pair = await selectWordPair(pack.id, []);
  if (!pair) return c.html(errorPage("No word pairs available in this pack."), 400);

  // Assign roles + words
  const roles = assignRoles(players);
  const speakingOrder = generateSpeakingOrder(players);
  for (const p of players) {
    const role = roles.get(p.id)!;
    const word = role === "imposter" ? (pair.imposterWord ?? null) : pair.civilianWord;
    await db.update(schema.players).set({ role, word }).where(eq(schema.players.id, p.id));
  }

  // Create round
  await db.insert(schema.rounds).values({
    roomId: room.id, pairId: pair.id, roundNumber: 1,
    speakingOrderJson: JSON.stringify(speakingOrder),
  });
  await db.insert(schema.gameRoomUsedPairs).values({ roomId: room.id, pairId: pair.id });

  await db.update(schema.gameRooms)
    .set({ status: "active", phase: "reveal", roundNumber: 1, updatedAt: new Date().toISOString() })
    .where(eq(schema.gameRooms.id, room.id));

  return c.redirect(`/rooms/${pin}`);
});

// ── Join room ────────────────────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/join", async (c) => {
  const { pin } = c.req.param();
  const body = await c.req.parseBody();
  const nickname = String(body.nickname ?? "").trim().slice(0, 24);

  if (!nickname) return c.html(joinPage(pin, "Nickname required"), 400);

  const room = await db.query.gameRooms.findFirst({
    where: eq(schema.gameRooms.pin, pin),
  });
  if (!room) return c.html(errorPage("Room not found"), 404);
  if (room.status !== "waiting") return c.html(joinPage(pin, "Game already started"), 403);

  const existing = await db.query.players.findMany({
    where: eq(schema.players.roomId, room.id),
  });
  if (existing.length >= 8) return c.html(joinPage(pin, "Room is full (max 8 players)"), 403);

  // Check if this player already has a cookie for this room (rejoin)
  const existingToken = await getPlayerFromCookie(c);
  if (existingToken && existingToken.roomId === room.id) {
    return c.redirect(`/rooms/${pin}`);
  }

  // Determine if first player (host)
  const isFirstPlayer = existing.length === 0;

  const [player] = await db
    .insert(schema.players)
    .values({ roomId: room.id, nickname, isHost: isFirstPlayer })
    .returning();

  setPlayerCookie(c, player!.sessionToken);
  return c.redirect(`/rooms/${pin}`);
});

// ── Room view (phase-aware) ──────────────────────────────────────────────────

gameRouter.get("/rooms/:pin", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(joinPage(pin), 302);

  const { player, room } = ctx;
  const players = await db.query.players.findMany({
    where: eq(schema.players.roomId, room.id),
  });

  if (room.phase === "lobby") {
    return c.html(lobbyPage(room, players, player.isHost, player.id));
  }
  if (room.phase === "reveal") {
    // Online mode: if this player already confirmed, show waiting page instead of looping
    if (room.mode === "online" && player.wordRevealed) {
      return c.html(revealWaitingPage(room));
    }
    const revealPlayer = room.mode === "local"
      ? (players.find((p) => !p.wordRevealed && !p.eliminated) ?? player)
      : player;
    const revealRound = await getCurrentRound(room.id);
    const revealPair = revealRound?.pairId ? await db.query.wordPairs.findFirst({ where: eq(schema.wordPairs.id, revealRound.pairId) }) : null;
    const revealPack = revealPair ? await db.query.wordPacks.findFirst({ where: eq(schema.wordPacks.id, revealPair.packId) }) : null;
    return c.html(revealPage(revealPlayer, room, revealPack?.name ?? null));
  }

  const round = await getCurrentRound(room.id);
  if (!round) return c.html(errorPage("No active round"), 500);

  const speakingOrder: string[] = JSON.parse(round.speakingOrderJson ?? "[]");
  const clues = await getRoundClues(round.id);
  const votes = await getRoundVotes(round.id);

  if (room.phase === "clues") {
    let cluesPlayer = player;
    if (room.mode === "local") {
      const submittedIds = new Set(clues.map((cl) => cl.playerId));
      const nextId = speakingOrder.find((id) => !submittedIds.has(id) && players.find((p) => p.id === id && !p.eliminated));
      cluesPlayer = players.find((p) => p.id === nextId) ?? player;
    }
    return c.html(cluesPage(room, players, cluesPlayer, speakingOrder, clues as any, player.isHost));
  }
  if (room.phase === "voting") {
    let votingPlayer = player;
    if (room.mode === "local") {
      const voterIds = new Set(votes.map((v) => v.voterId));
      votingPlayer = players.find((p) => !p.eliminated && !voterIds.has(p.id)) ?? player;
    }
    return c.html(votingPage(room, players, votingPlayer, votes, player.isHost));
  }
  if (room.phase === "result") {
    const imposter = players.find((p) => p.role === "imposter") ?? null;
    const eliminatedByVote = players.find((p) => p.eliminated && p.id !== imposter?.id) ?? null;
    const pair = round.pairId
      ? await db.query.wordPairs.findFirst({ where: eq(schema.wordPairs.id, round.pairId) })
      : null;
    return c.html(resultPage(room, players, round, eliminatedByVote, imposter, player.isHost, pair?.civilianWord ?? null));
  }

  return c.html(errorPage("Unknown game phase"), 500);
});

// ── Polling fragments ────────────────────────────────────────────────────────

// Lightweight status check — used by players who haven't submitted yet
// (so we can't poll game-state without wiping their input).
// Returns HX-Redirect when game ends; otherwise re-renders itself.
gameRouter.get("/rooms/:pin/fragment/status", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.text("", 403);
  const { room } = ctx;
  if (room.phase === "result" || room.status === "finished") {
    c.header("HX-Redirect", `/rooms/${pin}`);
    return c.text("");
  }
  return c.html(`<div id="status-poll"
    hx-get="/rooms/${pin}/fragment/status"
    hx-trigger="every 2s"
    hx-swap="outerHTML"></div>`);
});

gameRouter.get("/rooms/:pin/fragment/lobby", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.text("", 403);

  const { room } = ctx;
  // If game started, redirect to full room view via HX-Redirect
  if (room.phase !== "lobby") {
    c.header("HX-Redirect", `/rooms/${pin}`);
    return c.text("");
  }

  const players = await db.query.players.findMany({
    where: eq(schema.players.roomId, room.id),
  });
  return c.html(lobbyPlayersFragment(players, ctx.player.id, ctx.player.isHost, pin));
});

gameRouter.get("/rooms/:pin/fragment/state", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.text("", 403);

  const { player, room } = ctx;

  // Redirect for phase transitions that need a full page render
  if (room.phase === "reveal" || room.phase === "result") {
    c.header("HX-Redirect", `/rooms/${pin}`);
    return c.text("");
  }

  const players = await db.query.players.findMany({
    where: eq(schema.players.roomId, room.id),
  });
  const round = await getCurrentRound(room.id);
  const speakingOrder: string[] = round ? JSON.parse(round.speakingOrderJson ?? "[]") : [];
  const clues = round ? await getRoundClues(round.id) : [];
  const votes = round ? await getRoundVotes(round.id) : [];

  return c.html(
    stateFragment(room, players, player, speakingOrder, clues as any, votes, round, player.isHost),
  );
});

// Polls until result phase ends (host starts next round or play again)
gameRouter.get("/rooms/:pin/fragment/result-wait", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.text("", 403);
  const { room } = ctx;
  if (room.phase !== "result") {
    c.header("HX-Redirect", `/rooms/${pin}`);
    return c.text("");
  }
  return c.html(`<div id="result-poll"
    hx-get="/rooms/${pin}/fragment/result-wait"
    hx-trigger="every 2s"
    hx-swap="outerHTML"></div>`);
});

// Polls until reveal phase ends; sends HX-Redirect when game moves on
gameRouter.get("/rooms/:pin/fragment/reveal-wait", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.text("", 403);

  const { room } = ctx;
  if (room.phase !== "reveal") {
    // Phase advanced — redirect to full page which will show the right view
    c.header("HX-Redirect", `/rooms/${pin}`);
    return c.text("");
  }

  // Still in reveal, keep polling
  return c.html(`<div id="reveal-wait"
    hx-get="/rooms/${pin}/fragment/reveal-wait"
    hx-trigger="every 2s"
    hx-swap="outerHTML"></div>`);
});

// ── Start game ───────────────────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/start", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { player, room } = ctx;
  if (!player.isHost) return c.html(errorPage("Only the host can start"), 403);
  if (room.status !== "waiting") return c.redirect(`/rooms/${pin}`);

  const players = await db.query.players.findMany({
    where: eq(schema.players.roomId, room.id),
  });
  if (players.length < 3) return c.redirect(`/rooms/${pin}`);

  const pack = await pickRandomActivePack();
  if (!pack) {
    return c.html(errorPage("No active word packs. Add some in /admin first."), 400);
  }

  const usedIds = await getUsedPairIds(room.id);
  const pair = await selectWordPair(pack.id, usedIds);
  if (!pair) {
    return c.html(errorPage("No unused word pairs available in this pack."), 400);
  }

  // Assign roles
  const roles = assignRoles(players);
  const speakingOrder = generateSpeakingOrder(players);

  // Update all players with roles + words (in a transaction-like batch)
  for (const p of players) {
    const role = roles.get(p.id)!;
    const word = role === "imposter" ? (pair.imposterWord ?? null) : pair.civilianWord;
    await db
      .update(schema.players)
      .set({ role, word })
      .where(eq(schema.players.id, p.id));
  }

  // Create the first round
  const [round] = await db
    .insert(schema.rounds)
    .values({
      roomId: room.id,
      pairId: pair.id,
      roundNumber: 1,
      speakingOrderJson: JSON.stringify(speakingOrder),
    })
    .returning();

  // Mark pair as used
  await db.insert(schema.gameRoomUsedPairs).values({ roomId: room.id, pairId: pair.id });

  // Advance room to active/reveal
  await db
    .update(schema.gameRooms)
    .set({
      status: "active",
      phase: "reveal",
      roundNumber: 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.gameRooms.id, room.id));

  return c.redirect(`/rooms/${pin}`);
});

// ── Reveal confirm ───────────────────────────────────────────────────────────

gameRouter.get("/rooms/:pin/reveal", async (c) => {
  const { pin } = c.req.param();
  c.header("Cache-Control", "no-store, no-cache, must-revalidate");
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);
  const { player, room } = ctx;
  if (room.phase !== "reveal") return c.redirect(`/rooms/${pin}`);
  const revRound = await getCurrentRound(room.id);
  const revPair = revRound?.pairId ? await db.query.wordPairs.findFirst({ where: eq(schema.wordPairs.id, revRound.pairId) }) : null;
  const revPack = revPair ? await db.query.wordPacks.findFirst({ where: eq(schema.wordPacks.id, revPair.packId) }) : null;
  return c.html(revealPage(player, room, revPack?.name ?? null));
});

gameRouter.post("/rooms/:pin/reveal/confirm", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { room } = ctx;
  const players = await db.query.players.findMany({ where: eq(schema.players.roomId, room.id) });

  const targetPlayer = room.mode === "local"
    ? (players.find((p) => !p.wordRevealed && !p.eliminated) ?? ctx.player)
    : ctx.player;

  await db
    .update(schema.players)
    .set({ wordRevealed: true })
    .where(eq(schema.players.id, targetPlayer.id));

  // Check if all players have seen their word (re-fetch after update)
  const refreshed = await db.query.players.findMany({ where: eq(schema.players.roomId, room.id) });
  if (isRevealComplete(refreshed)) {
    await db
      .update(schema.gameRooms)
      .set({ phase: "clues", updatedAt: new Date().toISOString() })
      .where(and(eq(schema.gameRooms.id, room.id), eq(schema.gameRooms.phase, "reveal")));
  }

  return c.redirect(`/rooms/${pin}`);
});

// ── Submit clue ──────────────────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/clue", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { room } = ctx;
  if (room.phase !== "clues") return c.redirect(`/rooms/${pin}`);

  const body = await c.req.parseBody();
  const clueText = String(body.clue ?? "").trim().slice(0, 60);
  if (!clueText && room.mode !== "local") return c.redirect(`/rooms/${pin}`);

  const round = await getCurrentRound(room.id);
  if (!round) return c.redirect(`/rooms/${pin}`);

  let cluePlayer = ctx.player;
  if (room.mode === "local") {
    const allPlayers = await db.query.players.findMany({ where: eq(schema.players.roomId, room.id) });
    const existingClues = await getRoundClues(round.id);
    const submittedIds = new Set(existingClues.map((cl) => cl.playerId));
    const speakingOrder: string[] = JSON.parse(round.speakingOrderJson ?? "[]");
    const nextId = speakingOrder.find((id) => !submittedIds.has(id) && allPlayers.find((p) => p.id === id && !p.eliminated));
    cluePlayer = allPlayers.find((p) => p.id === nextId) ?? ctx.player;
  }

  // UNIQUE(round_id, player_id) handles double-submit silently
  try {
    await db.insert(schema.clues).values({ roundId: round.id, playerId: cluePlayer.id, clueText });
  } catch {
    // Already submitted
    return c.redirect(`/rooms/${pin}`);
  }

  // No auto-advance — host decides when to call vote or do another round

  return c.redirect(`/rooms/${pin}`);
});

// ── Host clue-phase controls ─────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/call-vote", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);
  const { player, room } = ctx;
  if (!player.isHost || room.phase !== "clues") return c.redirect(`/rooms/${pin}`);

  await db
    .update(schema.gameRooms)
    .set({ phase: "voting", updatedAt: new Date().toISOString() })
    .where(eq(schema.gameRooms.id, room.id));
  return c.redirect(`/rooms/${pin}`);
});

gameRouter.post("/rooms/:pin/more-clues", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);
  const { player, room } = ctx;
  if (!player.isHost || room.phase !== "clues") return c.redirect(`/rooms/${pin}`);

  const round = await getCurrentRound(room.id);
  if (!round) return c.redirect(`/rooms/${pin}`);

  const players = await db.query.players.findMany({
    where: and(eq(schema.players.roomId, room.id), eq(schema.players.eliminated, false)),
  });

  // Clear clues and reshuffle speaking order for a fresh round
  await db.delete(schema.clues).where(eq(schema.clues.roundId, round.id));
  const newOrder = generateSpeakingOrder(players);
  await db.update(schema.rounds)
    .set({ speakingOrderJson: JSON.stringify(newOrder) })
    .where(eq(schema.rounds.id, round.id));

  return c.redirect(`/rooms/${pin}`);
});

// ── Cast vote ────────────────────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/vote", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { room } = ctx;
  if (room.phase !== "voting") return c.redirect(`/rooms/${pin}`);

  const body = await c.req.parseBody();
  const targetId = String(body.targetId ?? "").trim();
  if (!targetId) return c.redirect(`/rooms/${pin}`);

  const round = await getCurrentRound(room.id);
  if (!round) return c.redirect(`/rooms/${pin}`);

  let voter = ctx.player;
  if (room.mode === "local") {
    const allPlayers = await db.query.players.findMany({ where: eq(schema.players.roomId, room.id) });
    const existingVotes = await getRoundVotes(round.id);
    const voterIds = new Set(existingVotes.map((v) => v.voterId));
    voter = allPlayers.find((p) => !p.eliminated && !voterIds.has(p.id)) ?? ctx.player;
  }

  // UNIQUE(round_id, voter_id) handles double-vote
  try {
    await db.insert(schema.votes).values({ roundId: round.id, voterId: voter.id, targetId });
  } catch {
    return c.redirect(`/rooms/${pin}`);
  }

  // Check if voting is complete
  const players = await db.query.players.findMany({
    where: eq(schema.players.roomId, room.id),
  });
  const votes = await getRoundVotes(round.id);
  const voterIds = votes.map((v) => v.voterId);

  if (isVotingComplete(players, voterIds)) {
    await advanceToResult(room.id, round.id, players, votes);
  }

  return c.redirect(`/rooms/${pin}`);
});

async function advanceToResult(
  roomId: string,
  roundId: string,
  players: typeof schema.players.$inferSelect[],
  votes: typeof schema.votes.$inferSelect[],
) {
  const result = countVotes(votes);
  const imposter = players.find((p) => p.role === "imposter");

  let imposterCaught = false;
  let winner: "civilians" | "imposter" | undefined;
  let eliminatedId: string | null = null;

  if (!result.tie && result.eliminated) {
    eliminatedId = result.eliminated;
    if (eliminatedId === imposter?.id) {
      imposterCaught = true;
      winner = "civilians";
      await db
        .update(schema.players)
        .set({ eliminated: true })
        .where(eq(schema.players.id, eliminatedId));
    } else {
      await db
        .update(schema.players)
        .set({ eliminated: true })
        .where(eq(schema.players.id, eliminatedId));
    }
  }

  // Check remaining players after this elimination
  const activeAfterVote = players.filter((p) => !p.eliminated && p.id !== (eliminatedId ?? ""));
  const imposterStillIn = imposter !== undefined && !imposterCaught && activeAfterVote.some((p) => p.id === imposter.id);
  const imposterWins = imposterStillIn && activeAfterVote.length <= 2;

  // Get current round number before updating
  const room = await db.query.gameRooms.findFirst({ where: eq(schema.gameRooms.id, roomId) });
  const isLastRound = (room?.roundNumber ?? 1) >= (room?.maxRounds ?? 3);
  const gameOver = imposterCaught || isLastRound || imposterWins;

  if (gameOver && !imposterCaught) winner = "imposter";

  await db
    .update(schema.rounds)
    .set({
      endedAt: new Date().toISOString(),
      imposterCaught,
      winner: winner ?? null,
    })
    .where(eq(schema.rounds.id, roundId));

  // Atomic phase transition
  await db
    .update(schema.gameRooms)
    .set({
      phase: "result",
      status: gameOver ? "finished" : "active",
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(schema.gameRooms.id, roomId), eq(schema.gameRooms.phase, "voting")));
}

// ── Next round ───────────────────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/next-round", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { player, room } = ctx;
  if (!player.isHost) return c.redirect(`/rooms/${pin}`);
  if (room.phase !== "result" || room.status === "finished") return c.redirect(`/rooms/${pin}`);

  const pack = await pickRandomActivePack();
  if (!pack) return c.redirect(`/rooms/${pin}`);

  const usedIds = await getUsedPairIds(room.id);
  const pair = await selectWordPair(pack.id, usedIds);
  if (!pair) return c.html(errorPage("No more word pairs available"), 400);

  const players = await db.query.players.findMany({
    where: and(eq(schema.players.roomId, room.id), eq(schema.players.eliminated, false)),
  });

  const roles = assignRoles(players);
  const speakingOrder = generateSpeakingOrder(players);
  const nextRoundNumber = room.roundNumber + 1;

  for (const p of players) {
    const role = roles.get(p.id)!;
    const word = role === "imposter" ? (pair.imposterWord ?? null) : pair.civilianWord;
    await db.update(schema.players).set({ role, word, wordRevealed: false }).where(eq(schema.players.id, p.id));
  }

  await db.insert(schema.rounds).values({
    roomId: room.id,
    pairId: pair.id,
    roundNumber: nextRoundNumber,
    speakingOrderJson: JSON.stringify(speakingOrder),
  });

  await db.insert(schema.gameRoomUsedPairs).values({ roomId: room.id, pairId: pair.id });

  await db.update(schema.gameRooms).set({
    phase: "reveal",
    roundNumber: nextRoundNumber,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.gameRooms.id, room.id));

  return c.redirect(`/rooms/${pin}`);
});

// ── End game ─────────────────────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/end", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { player, room } = ctx;
  if (!player.isHost) return c.redirect(`/rooms/${pin}`);

  await db.update(schema.gameRooms).set({
    status: "finished",
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.gameRooms.id, room.id));

  return c.redirect(`/rooms/${pin}`);
});

// ── Exit game ────────────────────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/exit", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { room } = ctx;
  if (room.status === "finished") return c.redirect(`/rooms/${pin}`);

  // Close the current round cleanly (no winner — game ended early)
  const round = await getCurrentRound(room.id);
  if (round && !round.endedAt) {
    await db.update(schema.rounds)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(schema.rounds.id, round.id));
  }

  await db.update(schema.gameRooms)
    .set({ phase: "result", status: "finished", updatedAt: new Date().toISOString() })
    .where(eq(schema.gameRooms.id, room.id));

  return c.redirect(`/rooms/${pin}`);
});

// ── Play again (same players) ─────────────────────────────────────────────────

gameRouter.post("/rooms/:pin/play-again", async (c) => {
  const { pin } = c.req.param();
  const ctx = await requirePlayerInRoom(c, pin);
  if (!ctx) return c.html(errorPage("Not authorized"), 403);

  const { player, room } = ctx;
  if (room.status !== "finished") return c.redirect(`/rooms/${pin}`);
  if (room.mode === "online" && !player.isHost) return c.redirect(`/rooms/${pin}`);

  // Delete rounds (cascades to votes + clues via FK)
  const rounds = await db.query.rounds.findMany({ where: eq(schema.rounds.roomId, room.id) });
  if (rounds.length > 0) {
    const roundIds = rounds.map((r) => r.id);
    await db.delete(schema.votes).where(inArray(schema.votes.roundId, roundIds));
    await db.delete(schema.clues).where(inArray(schema.clues.roundId, roundIds));
    await db.delete(schema.rounds).where(inArray(schema.rounds.id, roundIds));
  }

  // Clear used pairs history so old pairs can be reused
  await db.delete(schema.gameRoomUsedPairs).where(eq(schema.gameRoomUsedPairs.roomId, room.id));

  // Reset all players to clean state
  await db.update(schema.players)
    .set({ role: null, word: null, wordRevealed: false, eliminated: false })
    .where(eq(schema.players.roomId, room.id));

  const players = await db.query.players.findMany({ where: eq(schema.players.roomId, room.id) });

  if (room.mode === "local") {
    // Local mode: start new game immediately
    const pack = await pickRandomActivePack();
    if (!pack) return c.html(errorPage("No active word packs. Add some in /admin first."), 400);
    const pair = await selectWordPair(pack.id, []);
    if (!pair) return c.html(errorPage("No word pairs available in this pack."), 400);

    const roles = assignRoles(players);
    const speakingOrder = generateSpeakingOrder(players);
    for (const p of players) {
      const role = roles.get(p.id)!;
      const word = role === "imposter" ? (pair.imposterWord ?? null) : pair.civilianWord;
      await db.update(schema.players).set({ role, word }).where(eq(schema.players.id, p.id));
    }

    await db.insert(schema.rounds).values({
      roomId: room.id, pairId: pair.id, roundNumber: 1,
      speakingOrderJson: JSON.stringify(speakingOrder),
    });
    await db.insert(schema.gameRoomUsedPairs).values({ roomId: room.id, pairId: pair.id });

    await db.update(schema.gameRooms)
      .set({ status: "active", phase: "reveal", roundNumber: 1, updatedAt: new Date().toISOString() })
      .where(eq(schema.gameRooms.id, room.id));
  } else {
    // Online mode: return to lobby so host can start again
    await db.update(schema.gameRooms)
      .set({ status: "waiting", phase: "lobby", roundNumber: 0, updatedAt: new Date().toISOString() })
      .where(eq(schema.gameRooms.id, room.id));
  }

  return c.redirect(`/rooms/${pin}`);
});
