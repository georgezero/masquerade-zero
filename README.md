# Masquerade

A real-time social deduction game where players give clues about a secret word and try to identify the imposter among them.

## Setup

```bash
npm install
npm run db:migrate
npm run dev
```

The app runs on port 3000 by default (configurable via `PORT`).

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./data/masquerade.db` | SQLite file path or Turso `libsql://` URL |
| `DATABASE_AUTH_TOKEN` | — | Auth token for Turso (not needed for local SQLite) |
| `ADMIN_PASSWORD` | `changeme` | Password for the admin panel |
| `PORT` | `3000` | Port to listen on (RPI/local only) |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |

## Word Packs

Word packs live in `data/packs/*.json`. Each file defines a pack name, category, and a list of pairs:

```json
{
  "name": "Animals",
  "category": "Nature",
  "pairs": [
    { "civilianWord": "Elephant", "imposterWord": "wrinkled" }
  ]
}
```

### Imposter Hints

Civilians see the `civilianWord`. The imposter sees `imposterWord` — a short, vague word or two (typically an adjective or loosely related concept) that hints at the word without giving it away.

Good hint: `"wrinkled"`, `"soft"`, `"soaring"`
Too close: `"Mammoth"`, `"A very large animal with a trunk"`

The end-of-round screen reveals both the imposter's name and the real civilian word.

### Seed Script

```bash
npx tsx scripts/seed-packs.ts                        # upsert all packs
npx tsx scripts/seed-packs.ts animals                # upsert one pack
npx tsx scripts/seed-packs.ts animals animals2       # upsert multiple packs
npx tsx scripts/seed-packs.ts --reset                # clear DB and reload all packs
npx tsx scripts/seed-packs.ts --reset animals animals2  # clear DB and load specific packs
```

The script is safe to re-run. Existing pairs are skipped, changed `imposterWord` values are updated in place. `--reset` wipes all game and pack data before loading.

To target Turso:

```bash
DATABASE_URL=libsql://your-db.turso.io \
DATABASE_AUTH_TOKEN=your-token \
npx tsx scripts/seed-packs.ts --reset
```

## Deployment

### Vercel + Turso

The Vercel deployment runs at **masquerade-zero.vercel.app** using Turso as the database.

1. Add environment variables in the Vercel dashboard or CLI:
   ```bash
   vercel env add DATABASE_URL        # libsql://your-db.turso.io
   vercel env add DATABASE_AUTH_TOKEN
   vercel env add ADMIN_PASSWORD
   ```
2. Seed Turso:
   ```bash
   DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... npx tsx scripts/seed-packs.ts --reset
   ```
3. Push to `master` — Vercel auto-deploys on every push.

### RPI (local)

The RPI version runs with a local SQLite file and is exposed publicly via Cloudflare Tunnel at **masq-zero.stuy.dev**.

```bash
npm run dev        # starts tsx watch src/index.ts
```

Seed the local database:

```bash
npx tsx scripts/seed-packs.ts --reset
```

## Cloudflare Tunnel (RPI)

The app is exposed via a persistent Cloudflare tunnel at `masq-zero.stuy.dev`.

The tunnel runs as a systemd service and starts automatically on boot:

```bash
sudo systemctl status cloudflared-masq-zero   # check status
sudo systemctl restart cloudflared-masq-zero  # restart
```

Config: `~/.cloudflared/config-masq-zero.yml`

## Game Flow

```
lobby → reveal → clues → voting → result
                   ↑                 │
                   └── next round ───┘
                                     └── play again (same players)
                                     └── new game (back to home)
```

- **Pass & Play** — one device, players pass the phone to see their word
- **Online** — each player joins on their own device via room PIN
- Host controls round pacing (Start Voting, Next Round, Exit Game)
- End screen shows the imposter's name, the real word, and the imposter's hint
