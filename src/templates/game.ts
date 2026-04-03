import { escapeHtml } from "../lib/html.js";
import { page } from "./page.js";
import type { Player, GameRoom, Round, Vote } from "../lib/game.js";
import type { InferSelectModel } from "drizzle-orm";
import type { schema } from "../db/index.js";

type Clue = InferSelectModel<typeof schema.clues> & { nickname?: string };
type VoteWithNick = Vote & { voterNickname?: string; targetNickname?: string };

// ── Exit button + confirm dialog ─────────────────────────────────────────────

function exitDialog(pin: string) {
  return `
  <button onclick="document.getElementById('exit-dlg').showModal()"
    class="text-xs text-slate-600 hover:text-rose-400 transition py-2 px-4">
    Exit game
  </button>
  <dialog id="exit-dlg"
    class="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-xl max-w-xs w-full">
    <p class="text-slate-200 font-semibold mb-1">Exit this game?</p>
    <p class="text-slate-400 text-sm mb-5">Everyone will be taken to the end screen.</p>
    <div class="flex gap-3">
      <form method="POST" action="/rooms/${escapeHtml(pin)}/exit" class="flex-1">
        <button type="submit"
          class="w-full rounded-xl border border-rose-500/40 bg-rose-950/30 px-4 py-2.5 font-bold text-rose-300 transition hover:bg-rose-950/50">
          Yes
        </button>
      </form>
      <button onclick="document.getElementById('exit-dlg').close()"
        class="flex-1 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2.5 font-semibold text-slate-300 transition hover:bg-slate-700/60">
        No
      </button>
    </div>
  </dialog>`;
}

// ── Landing page ─────────────────────────────────────────────────────────────

export function landingPage() {
  return page({
    title: "Home",
    body: `
    <div class="flex min-h-screen flex-col items-center justify-center p-4 gap-8">
      <div class="text-center">
        <div class="brand-lockup justify-center mb-6">
          <div class="brand-mark text-2xl">M</div>
          <div>
            <div class="brand-name">Find the Imposter</div>
            <div class="brand-tag">Masquerade</div>
          </div>
        </div>
        <p class="text-slate-400 text-sm max-w-xs mx-auto">
          A social deduction game of cunning, bluffing, and masks. 3–8 players.
        </p>
      </div>

      <div class="flex flex-col gap-3 w-full max-w-xs">
        <form method="POST" action="/rooms">
          <input type="hidden" name="mode" value="online" />
          <button type="submit"
            class="w-full rounded-xl border border-amber-300/60 bg-amber-400/20 px-6 py-3 font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.25)] transition hover:bg-amber-400/30">
            Create a Room — Online
          </button>
        </form>

        <form method="POST" action="/rooms">
          <input type="hidden" name="mode" value="local" />
          <button type="submit"
            class="w-full rounded-xl border border-slate-600 bg-slate-800/40 px-6 py-3 font-bold text-slate-200 transition hover:bg-slate-700/60">
            Create a Room — Pass &amp; Play
          </button>
        </form>

        <form method="POST" action="/rooms/join" class="flex flex-col gap-2">
          <input
            type="text" name="pin" maxlength="4" pattern="[0-9]{4}"
            placeholder="Room PIN"
            class="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-center text-xl font-bold tracking-widest text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none"
            required autocomplete="off" inputmode="numeric" />
          <button type="submit"
            class="w-full rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-5 py-3 font-bold text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.2)] transition hover:bg-cyan-500/25">
            Join Room
          </button>
        </form>
      </div>
    </div>`,
  });
}

// ── Nickname form (join page) ─────────────────────────────────────────────────

export function joinPage(pin: string, error?: string) {
  return page({
    title: `Join Room ${pin}`,
    body: `
    <div class="flex min-h-screen flex-col items-center justify-center p-4 gap-6">
      <div class="text-center">
        <p class="text-slate-400 text-xs uppercase tracking-widest mb-1">Joining room</p>
        <p class="text-5xl font-black tracking-widest text-amber-300">${escapeHtml(pin)}</p>
      </div>

      ${error ? `<div class="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-2 text-sm text-red-300">${escapeHtml(error)}</div>` : ""}

      <form method="POST" action="/rooms/${escapeHtml(pin)}/join" class="flex flex-col gap-3 w-full max-w-xs">
        <input
          type="text" name="nickname" placeholder="Your name"
          maxlength="24" autocomplete="off" required autofocus
          class="rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-lg font-semibold text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
        <button type="submit"
          class="rounded-xl border border-amber-300/60 bg-amber-400/20 px-6 py-3 font-bold text-amber-100 transition hover:bg-amber-400/30">
          Enter Room
        </button>
      </form>
    </div>`,
  });
}

// ── Local setup ───────────────────────────────────────────────────────────────

export function localSetupPage(pin: string, error?: string) {
  return page({
    title: "Set Up Game",
    body: `
    <div class="flex min-h-screen flex-col items-center justify-center p-4 gap-6">
      <div class="text-center">
        <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">Pass &amp; Play</p>
        <p class="text-2xl font-black text-amber-300">Who's playing?</p>
        <p class="text-slate-400 text-sm mt-1">Enter 3–8 names, then start.</p>
      </div>

      ${error ? `<div class="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-2 text-sm text-red-300">${escapeHtml(error)}</div>` : ""}

      <form method="POST" action="/rooms/${escapeHtml(pin)}/local-setup" class="w-full max-w-xs space-y-3">
        <div id="player-inputs" class="space-y-2">
          <input type="text" name="names" placeholder="Player 1" required maxlength="24" autocomplete="off"
            class="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
          <input type="text" name="names" placeholder="Player 2" required maxlength="24" autocomplete="off"
            class="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
          <input type="text" name="names" placeholder="Player 3" required maxlength="24" autocomplete="off"
            class="w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
        </div>

        <button type="button" id="add-btn"
          onclick="
            var inputs = document.getElementById('player-inputs');
            var count = inputs.querySelectorAll('input').length + 1;
            if (count > 8) { this.style.display='none'; return; }
            var inp = document.createElement('input');
            inp.type = 'text'; inp.name = 'names';
            inp.placeholder = 'Player ' + count;
            inp.maxLength = 24; inp.autocomplete = 'off';
            inp.className = 'w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none';
            inputs.appendChild(inp); inp.focus();
            if (count >= 8) this.style.display='none';
          "
          class="w-full rounded-xl border border-slate-700/60 bg-slate-800/30 px-4 py-2.5 text-sm text-slate-400 transition hover:text-slate-200">
          + Add player
        </button>

        <button type="submit"
          class="w-full rounded-xl border border-amber-300/60 bg-amber-400/20 px-6 py-3 font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.25)] transition hover:bg-amber-400/30">
          Start Game
        </button>
      </form>
    </div>`,
  });
}

// ── Lobby ─────────────────────────────────────────────────────────────────────

export function lobbyPage(room: GameRoom, players: Player[], isHost: boolean, myId: string) {
  return page({
    title: `Room ${room.pin}`,
    htmx: true,
    body: `
    <div class="flex min-h-screen flex-col items-center justify-start gap-6 p-4 pt-10">
      <div class="text-center">
        <p class="text-slate-400 text-xs uppercase tracking-widest mb-1">Room PIN</p>
        <p class="text-5xl font-black tracking-widest text-amber-300">${escapeHtml(room.pin)}</p>
        <p class="text-slate-400 text-sm mt-2">Share this code with friends</p>
      </div>

      ${lobbyPlayersFragment(players, myId, isHost, room.pin)}
    </div>`,
  });
}

export function lobbyPlayersFragment(players: Player[], myId: string, isHost: boolean, pin: string) {
  const canStart = players.length >= 3;
  return `
  <div
    id="lobby-players"
    hx-get="/rooms/${escapeHtml(pin)}/fragment/lobby"
    hx-trigger="every 2s"
    hx-swap="outerHTML"
    class="w-full max-w-xs space-y-4">
    <div class="space-y-2">
      ${players.map((p) => `
        <div class="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-2.5">
          <div class="h-8 w-8 rounded-full border border-cyan-300/20 bg-cyan-500/10 flex items-center justify-center text-xs font-black text-cyan-200">
            ${escapeHtml(p.nickname.slice(0, 2).toUpperCase())}
          </div>
          <span class="font-semibold ${p.id === myId ? "text-amber-300" : "text-slate-200"}">
            ${escapeHtml(p.nickname)}${p.isHost ? " 👑" : ""}${p.id === myId ? " (you)" : ""}
          </span>
        </div>
      `).join("")}
    </div>
    ${isHost ? `
    <form method="POST" action="/rooms/${escapeHtml(pin)}/start">
      <button type="submit" ${canStart ? "" : "disabled"}
        class="w-full rounded-xl border border-amber-300/60 bg-amber-400/20 px-6 py-3 font-bold text-amber-100 transition hover:bg-amber-400/30 disabled:opacity-40 disabled:cursor-not-allowed">
        Start Game ${canStart ? `(${players.length} players)` : `(need ${3 - players.length} more)`}
      </button>
    </form>
    ` : `<p class="text-center text-slate-400 text-sm">Waiting for host to start...</p>`}
  </div>`;
}

// ── Private word reveal ───────────────────────────────────────────────────────

export function revealPage(player: Player, room: GameRoom, subject: string | null = null) {
  const isImposter = player.role === "imposter";
  const word = isImposter ? (player.word ?? null) : player.word;
  const isLocal = room.mode === "local";
  // In local/pass-and-play mode everyone shares one device, so don't leak the
  // imposter's role via the card colour before (or after) they tap to reveal.
  const accentClass = isImposter && !isLocal
    ? "border-rose-500/40 bg-rose-950/30 shadow-[0_0_40px_rgba(244,63,94,0.15)]"
    : "border-cyan-500/40 bg-cyan-950/20 shadow-[0_0_40px_rgba(34,211,238,0.1)]";

  return page({
    title: "Your Word",
    body: `
    <div class="flex min-h-screen flex-col items-center justify-center p-4 gap-8">
      ${isLocal ? `
      <p class="text-amber-100 font-bold">📱 Pass the phone to <span class="text-amber-300">${escapeHtml(player.nickname)}</span></p>
      ` : ""}

      <div class="w-full max-w-sm rounded-2xl border ${accentClass} p-8 text-center backdrop-blur-sm">
        ${isLocal ? `
        <div id="word-hidden">
          <p class="text-slate-400 text-sm mb-4">Hold the phone close, then tap to reveal your word.</p>
          <button onclick="document.getElementById('word-hidden').style.display='none';document.getElementById('word-shown').style.display='block';document.getElementById('done-btn').disabled=false;document.getElementById('done-btn').classList.remove('opacity-40','cursor-not-allowed');"
            class="rounded-xl border border-amber-300/60 bg-amber-400/20 px-6 py-3 font-bold text-amber-100 transition hover:bg-amber-400/30">
            Tap to reveal
          </button>
        </div>
        <div id="word-shown" style="display:none">
        ` : ""}
        <p class="text-xs uppercase tracking-widest mb-1 ${isImposter ? "text-rose-400" : "text-cyan-400"}">
          ${isImposter ? "You are the Imposter" : "You are a Civilian"}
        </p>
        ${subject ? `<p class="text-xs text-slate-500 mb-4">Subject: <span class="text-slate-300">${escapeHtml(subject)}</span></p>` : `<div class="mb-4"></div>`}
        ${word
          ? `<p class="text-5xl font-black text-white mb-2 font-[Space_Grotesk]">${escapeHtml(word)}</p>`
          : `<p class="text-xl font-bold text-slate-400 mb-2 italic">You have no word.<br/>Listen carefully.</p>`
        }
        <p class="text-xs text-slate-500 mt-4">
          ${isImposter ? "Blend in. Don't get caught." : "Give clues. Find the imposter."}
        </p>
        ${isLocal ? "</div>" : ""}
      </div>

      <form method="POST" action="/rooms/${escapeHtml(room.pin)}/reveal/confirm">
        <button id="done-btn" type="submit" ${isLocal ? "disabled" : ""}
          class="rounded-xl border border-slate-600 bg-slate-800/60 px-8 py-3 font-semibold text-slate-200 transition hover:bg-slate-700/60 ${isLocal ? "opacity-40 cursor-not-allowed" : ""}">
          ${isLocal ? "Done — pass the phone →" : "I've seen my word →"}
        </button>
      </form>

      ${player.isHost ? exitDialog(room.pin) : ""}
    </div>`,
  });
}

// ── Reveal waiting (online mode — player already confirmed) ──────────────────

export function revealWaitingPage(room: GameRoom) {
  return page({
    title: "Waiting...",
    htmx: true,
    body: `
    <div class="flex min-h-screen flex-col items-center justify-center p-4 gap-6">
      <div class="text-center space-y-2">
        <p class="text-2xl">👁</p>
        <p class="text-slate-200 font-semibold">Word seen!</p>
        <p class="text-slate-400 text-sm">Waiting for everyone else...</p>
      </div>
      <div id="reveal-wait"
        hx-get="/rooms/${escapeHtml(room.pin)}/fragment/reveal-wait"
        hx-trigger="every 2s"
        hx-swap="outerHTML">
      </div>
    </div>`,
  });
}

// ── Clues phase ───────────────────────────────────────────────────────────────

export function cluesPage(
  room: GameRoom,
  players: Player[],
  currentPlayer: Player,
  speakingOrder: string[],
  clues: Clue[],
  isHost = false,
) {
  const submittedIds = new Set(clues.map((c) => c.playerId));
  const hasSubmitted = submittedIds.has(currentPlayer.id);
  const playerMap = new Map(players.map((p) => [p.id, p]));

  return page({
    title: "Give Clues",
    htmx: true,
    body: `
    <div class="flex min-h-screen flex-col items-center gap-6 p-4 pt-8">
      <div class="text-center">
        <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">Round ${room.roundNumber} — Clue Phase</p>
        <p class="text-sm text-slate-300">Give one clue about <span class="font-bold text-amber-300">your word</span></p>
        ${room.mode === "local" ? `<p class="text-amber-300 font-bold mt-2">📱 ${escapeHtml(currentPlayer.nickname)}'s clue</p>` : ""}
      </div>

      <div id="game-state">
        ${cluesFragmentInner(room, players, currentPlayer, speakingOrder, clues, submittedIds, playerMap, hasSubmitted, isHost)}
      </div>

      ${isHost ? exitDialog(room.pin) : ""}
    </div>`,
  });
}

function cluesFragmentInner(
  room: GameRoom,
  players: Player[],
  currentPlayer: Player,
  speakingOrder: string[],
  clues: Clue[],
  submittedIds: Set<string>,
  playerMap: Map<string, Player>,
  hasSubmitted: boolean,
  isHost = false,
) {
  const allCluesIn = players.filter((p) => !p.eliminated).every((p) => submittedIds.has(p.id));
  // Only poll after submitting — polling while typing wipes the input field
  const poll = (room.mode !== "local" && hasSubmitted)
    ? `hx-get="/rooms/${escapeHtml(room.pin)}/fragment/state" hx-trigger="every 2s" hx-swap="outerHTML"`
    : "";
  return `
  <div id="game-state" ${poll}
    class="w-full max-w-sm space-y-4">

    ${allCluesIn ? `
      ${isHost ? `
      <div class="flex gap-2">
        <form method="POST" action="/rooms/${escapeHtml(room.pin)}/call-vote" class="flex-1">
          <button type="submit"
            class="w-full rounded-xl border border-rose-400/60 bg-rose-500/20 px-4 py-3 font-bold text-rose-100 transition hover:bg-rose-500/30">
            Start Voting
          </button>
        </form>
        <form method="POST" action="/rooms/${escapeHtml(room.pin)}/more-clues" class="flex-1">
          <button type="submit"
            class="w-full rounded-xl border border-cyan-300/50 bg-cyan-500/15 px-4 py-3 font-bold text-cyan-100 transition hover:bg-cyan-500/25">
            Another Round
          </button>
        </form>
      </div>
      ` : `<p class="text-center text-slate-400 text-sm">All clues in. Waiting for host to continue...</p>`}
    ` : !hasSubmitted ? `
    <form method="POST" action="/rooms/${escapeHtml(room.pin)}/clue" class="flex gap-2">
      <input type="text" name="clue" placeholder="Your clue..." ${room.mode === "local" ? "" : "required"} maxlength="60" autocomplete="off" autofocus
        class="flex-1 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-amber-400/60 focus:outline-none" />
      <button type="submit"
        class="rounded-xl border border-amber-300/60 bg-amber-400/20 px-4 py-3 font-bold text-amber-100 transition hover:bg-amber-400/30">
        Submit
      </button>
    </form>
    ` : `<p class="text-center text-slate-400 text-sm">Your clue is in. Waiting for others...</p>`}

    <div class="space-y-2">
      <p class="text-xs uppercase tracking-widest text-slate-500">Speaking order</p>
      ${speakingOrder.map((pid) => {
        const p = playerMap.get(pid);
        if (!p) return "";
        const done = submittedIds.has(pid);
        const isMe = pid === currentPlayer.id;
        const clue = clues.find((c) => c.playerId === pid);
        return `
        <div class="flex items-center gap-3 rounded-xl border ${done ? "border-slate-700/40 bg-slate-800/20" : "border-slate-700/60 bg-slate-800/40"} px-4 py-2.5">
          <span class="text-lg">${done ? "✓" : "·"}</span>
          <span class="font-semibold ${isMe ? "text-amber-300" : "text-slate-200"} flex-1">
            ${escapeHtml(p.nickname)}${isMe ? " (you)" : ""}
          </span>
          ${clue ? `<span class="text-slate-300 text-sm italic">"${escapeHtml(clue.clueText)}"</span>` : ""}
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// ── Voting phase ──────────────────────────────────────────────────────────────

export function votingPage(
  room: GameRoom,
  players: Player[],
  currentPlayer: Player,
  votes: Vote[],
  isHost = false,
) {
  const hasVoted = votes.some((v) => v.voterId === currentPlayer.id);
  const voteCount = new Map<string, number>();
  for (const v of votes) voteCount.set(v.targetId, (voteCount.get(v.targetId) ?? 0) + 1);
  const eligible = players.filter((p) => !p.eliminated && p.id !== currentPlayer.id);

  return page({
    title: "Vote",
    htmx: true,
    body: `
    <div class="flex min-h-screen flex-col items-center gap-6 p-4 pt-8">
      <div class="text-center">
        <p class="text-xs uppercase tracking-widest text-slate-400 mb-1">Round ${room.roundNumber} — Voting</p>
        <p class="text-sm text-slate-300">Who is the imposter?</p>
        ${room.mode === "local" ? `<p class="text-amber-300 font-bold mt-2">📱 ${escapeHtml(currentPlayer.nickname)}'s vote</p>` : ""}
      </div>

      <div id="game-state">
        ${votingFragmentInner(room, players, currentPlayer, votes, hasVoted, voteCount, eligible)}
      </div>

      ${isHost ? exitDialog(room.pin) : ""}
    </div>`,
  });
}

function votingFragmentInner(
  room: GameRoom,
  players: Player[],
  currentPlayer: Player,
  votes: Vote[],
  hasVoted: boolean,
  voteCount: Map<string, number>,
  eligible: Player[],
) {
  // Only poll after voting — no need to disrupt the vote buttons before that
  const poll = (room.mode !== "local" && hasVoted)
    ? `hx-get="/rooms/${escapeHtml(room.pin)}/fragment/state" hx-trigger="every 2s" hx-swap="outerHTML"`
    : "";
  return `
  <div id="game-state" ${poll}
    class="w-full max-w-sm space-y-3">

    ${!hasVoted ? eligible.map((p) => `
    <form method="POST" action="/rooms/${escapeHtml(room.pin)}/vote">
      <input type="hidden" name="targetId" value="${escapeHtml(p.id)}" />
      <button type="submit"
        class="w-full flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-800/40 px-4 py-3 text-left transition hover:border-rose-500/40 hover:bg-rose-950/20">
        <div class="h-9 w-9 rounded-full border border-rose-300/20 bg-rose-500/10 flex items-center justify-center text-xs font-black text-rose-200">
          ${escapeHtml(p.nickname.slice(0, 2).toUpperCase())}
        </div>
        <span class="font-semibold text-slate-200">${escapeHtml(p.nickname)}</span>
      </button>
    </form>
    `).join("") : `
    <p class="text-center text-slate-400 text-sm py-4">Your vote has been cast.<br/>Waiting for others...</p>
    <div class="space-y-2">
      ${players.filter((p) => !p.eliminated).map((p) => {
        const count = voteCount.get(p.id) ?? 0;
        return `
        <div class="flex items-center gap-3 rounded-xl border border-slate-700/40 bg-slate-800/20 px-4 py-2.5">
          <span class="font-semibold text-slate-200 flex-1">${escapeHtml(p.nickname)}</span>
          <span class="text-sm text-slate-400">${count} vote${count !== 1 ? "s" : ""}</span>
        </div>`;
      }).join("")}
    </div>
    `}
  </div>`;
}

// ── Result phase ──────────────────────────────────────────────────────────────

export function resultPage(
  room: GameRoom,
  players: Player[],
  round: Round,
  eliminatedPlayer: Player | null,
  imposter: Player | null,
  isHost: boolean,
) {
  const gameOver = room.status === "finished";
  const imposterCaught = round.imposterCaught;

  return page({
    title: "Result",
    body: `
    <div class="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div class="w-full max-w-sm rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6 text-center space-y-4 backdrop-blur-sm">
        ${imposterCaught
          ? `<div>
              <p class="text-3xl font-black text-amber-300 mb-1">Imposter caught!</p>
              <p class="text-slate-300 text-sm">Civilians win this round</p>
             </div>`
          : eliminatedPlayer
          ? `<div>
              <p class="text-3xl font-black text-rose-300 mb-1">${escapeHtml(eliminatedPlayer.nickname)} eliminated</p>
              <p class="text-slate-300 text-sm">Not the imposter...</p>
             </div>`
          : `<div>
              <p class="text-3xl font-black text-slate-300 mb-1">Tie! No elimination</p>
             </div>`
        }

        ${imposter ? `
        <div class="rounded-xl border border-rose-500/20 bg-rose-950/20 px-4 py-3">
          <p class="text-xs uppercase tracking-widest text-rose-400 mb-1">The Imposter was</p>
          <p class="text-xl font-black text-rose-200">${escapeHtml(imposter.nickname)}</p>
          ${imposter.word
            ? `<p class="text-sm text-slate-400">Their word: <span class="text-slate-200 font-semibold">${escapeHtml(imposter.word)}</span></p>`
            : `<p class="text-sm text-slate-400 italic">They had no word</p>`
          }
        </div>
        ` : ""}

        ${gameOver ? `
        <div class="rounded-xl border border-amber-500/20 bg-amber-950/20 px-4 py-3">
          <p class="text-lg font-black ${round.winner === "civilians" ? "text-cyan-300" : round.winner === "imposter" ? "text-rose-300" : "text-slate-400"}">
            ${round.winner === "civilians" ? "Civilians win the game!" : round.winner === "imposter" ? "Imposter wins the game!" : "Game ended early."}
          </p>
        </div>
        ` : ""}

        ${isHost && !gameOver ? `
        <div class="flex gap-2 pt-2">
          <form method="POST" action="/rooms/${escapeHtml(room.pin)}/next-round" class="flex-1">
            <button type="submit"
              class="w-full rounded-xl border border-amber-300/60 bg-amber-400/20 px-4 py-2.5 font-bold text-amber-100 transition hover:bg-amber-400/30 text-sm">
              Next Round →
            </button>
          </form>
        </div>
        ${exitDialog(room.pin)}
        ` : !isHost && !gameOver ? `<p class="text-slate-400 text-sm">Waiting for host...</p>` : ""}

        ${gameOver && (isHost || room.mode === "local") ? `
        <div class="flex gap-2 pt-2">
          <form method="POST" action="/rooms/${escapeHtml(room.pin)}/play-again" class="flex-1">
            <button type="submit"
              class="w-full rounded-xl border border-amber-300/60 bg-amber-400/20 px-4 py-2.5 font-bold text-amber-100 transition hover:bg-amber-400/30 text-sm">
              Play Again
            </button>
          </form>
          <a href="/"
            class="flex-1 flex items-center justify-center rounded-xl border border-slate-600 bg-slate-800/40 px-4 py-2.5 font-semibold text-slate-400 transition hover:text-slate-200 text-sm">
            New Game
          </a>
        </div>
        ` : gameOver && !isHost ? `
        <div class="space-y-2 pt-2">
          <p class="text-slate-400 text-sm">Waiting for host...</p>
          <a href="/"
            class="inline-block text-sm text-slate-500 hover:text-slate-300">
            Leave game
          </a>
        </div>
        ` : ""}
      </div>
    </div>`,
  });
}

// ── Game state polling fragment ───────────────────────────────────────────────

export function stateFragment(
  room: GameRoom,
  players: Player[],
  currentPlayer: Player,
  speakingOrder: string[],
  clues: Clue[],
  votes: Vote[],
  round: Round | null,
  isHost = false,
) {
  const submittedIds = new Set(clues.map((c) => c.playerId));
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const hasSubmitted = submittedIds.has(currentPlayer.id);
  const hasVoted = votes.some((v) => v.voterId === currentPlayer.id);
  const voteCount = new Map<string, number>();
  for (const v of votes) voteCount.set(v.targetId, (voteCount.get(v.targetId) ?? 0) + 1);
  const eligible = players.filter((p) => !p.eliminated && p.id !== currentPlayer.id);

  if (room.phase === "clues") {
    return cluesFragmentInner(
      room, players, currentPlayer, speakingOrder, clues, submittedIds, playerMap, hasSubmitted, isHost,
    );
  }
  if (room.phase === "voting") {
    return votingFragmentInner(room, players, currentPlayer, votes, hasVoted, voteCount, eligible);
  }

  // For other phases, wrap in polling div (but don't include trigger on finished game)
  const isFinished = room.status === "finished";
  return `<div id="game-state"${isFinished ? "" : `
    hx-get="/rooms/${escapeHtml(room.pin)}/fragment/state"
    hx-trigger="every 2s"
    hx-swap="outerHTML"`}
    class="text-center text-slate-400 text-sm py-8">
    Phase: ${escapeHtml(room.phase)}
  </div>`;
}
