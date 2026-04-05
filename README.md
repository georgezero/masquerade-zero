# Masquerade

A real-time social deduction game where players give clues about a secret word and try to identify the imposter among them.

## Setup

```bash
npm install
npm run db:migrate
npm run dev
```

The app runs on port 3000 by default.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `file:./data/masquerade.db` | SQLite file path or Neon/Postgres connection string |
| `ADMIN_PASSWORD` | `changeme` | Password for the admin panel |
| `PORT` | `3000` | Port to listen on |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |

## Word Packs

Word packs live in `data/packs/*.json`. Each file defines a pack name, category, and a list of pairs:

```json
{
  "name": "Animals",
  "category": "Nature",
  "pairs": [
    {
      "civilianWord": "Elephant",
      "imposterWord": "A very large land animal with a distinctive nose"
    }
  ]
}
```

### Imposter Hints

Civilians see the `civilianWord`. The imposter sees `imposterWord`, which should be a **vague description or category hint** — not a synonym. The hint should give the imposter just enough to bluff without making the word obvious.

Good hint: `"A very large land animal with a distinctive nose"`
Too close: `"Mammoth"`

### Seed Script

```bash
npx tsx scripts/seed-packs.ts                        # upsert all packs
npx tsx scripts/seed-packs.ts animals                # upsert one pack
npx tsx scripts/seed-packs.ts animals animals2       # upsert multiple packs
npx tsx scripts/seed-packs.ts --reset                # clear DB and reload all packs
npx tsx scripts/seed-packs.ts --reset animals animals2  # clear DB and load specific packs
```

The script is safe to re-run. Existing pairs are skipped, changed `imposterWord` values are updated in place. `--reset` wipes all game and pack data before loading.

To target a remote database (e.g. Neon):

```bash
DATABASE_URL=postgresql://... npx tsx scripts/seed-packs.ts
```

## Deployment

### Vercel + Neon

1. Add environment variables via the Vercel CLI:
   ```bash
   vercel env add DATABASE_URL
   vercel env add ADMIN_PASSWORD
   ```
2. Run the seed script against Neon to load your packs:
   ```bash
   DATABASE_URL=postgresql://... npx tsx scripts/seed-packs.ts
   ```
3. Deploy:
   ```bash
   vercel --prod
   ```

## Cloudflare Tunnel (local/RPI)

The app is exposed via a persistent Cloudflare tunnel at `masq-zero.stuy.dev`.

The tunnel runs as a systemd service and starts automatically on boot:

```bash
sudo systemctl status cloudflared-masq-zero   # check status
sudo systemctl restart cloudflared-masq-zero  # restart
```

Config: `~/.cloudflared/config-masq-zero.yml`
