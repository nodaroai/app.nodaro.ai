# Nodaro Community Edition Quickstart

Two commands to a running, fully self-contained Nodaro — no cloud accounts,
no API keys, nothing to configure:

```bash
git clone https://github.com/nodaroai/app.nodaro.ai.git nodaro
cd nodaro
docker compose -f docker-compose.community.yml up
```

The first boot downloads the prebuilt app image (~2.4 GB, so a few minutes on
a typical connection) plus the bundled services — a download rather than a
compile, and it does not pin your CPU. After that, boots take seconds.

Building from source instead (needed only if you change the code —
`PUBLIC_URL`, another port or a domain, and the Supabase keys are read at
runtime, so the published image serves them after a plain restart):

```bash
docker compose -f docker-compose.community.yml build
```

What comes up:

| Service | What it does | Where it lives |
|---|---|---|
| Postgres (Supabase image) | Your database — migrations apply themselves on first boot | `db-data` volume |
| GoTrue | Auth — email + password sign-up, no email server needed | — |
| PostgREST | The data API the editor talks to | — |
| MinIO | Media storage — generated images/videos land on your disk | `minio-data` volume |
| Redis | Job queues | `redis-data` volume |
| Nodaro | The app itself: editor, API, workers | port 3000 |

## 1. Open the app

http://localhost:3000

Create an account with any email + password (accounts work immediately —
no confirmation email on a local stack). On your first visit the dashboard
seeds a **Welcome Demo** workflow: a finished script → image → video →
voice → final-cut run with every result pre-baked, so you can explore real
nodes and play the final clip before touching any configuration.

## 2. Check the install: /setup

http://localhost:3000/setup shows live green/red status for the database
(including a dedicated "Migrations missing" state), Redis, storage, and
provider keys — no login needed. On a fresh stack everything should be
green except provider keys.

For a deeper check than the screen can show, run the contract probe against
your own install from a clone of the repo:

```bash
node tools/community-smoke.mjs http://localhost:3000
```

It signs up a throwaway account, creates a workflow, submits a generation and
follows the job to its end state, then reports which contracts held. Checks
that do not apply to your install (you already added a provider key, for
example) are reported as skipped rather than failed. The same script runs in
our CI against a keyless stack on every change.

Added a provider key already? Opt in to the success-path check too:

```bash
node tools/community-smoke.mjs http://localhost:3000 --keyed
```

`--keyed` submits one real generation on the cheapest model (Z-Image,
typically under a cent of provider spend), follows it to completion, and
verifies the media actually lands in your install's own storage. Without the
flag the probe never spends anything.

## 3. Generate for real

The demo isn't the only free material: the dashboard's **Tutorials** tab
ships pre-populated — a starter set of guided walkthroughs is seeded on
first boot, and browsing them costs nothing (see [Tutorials](./tutorials.md)).

Viewing the demo is free and works offline. To run nodes yourself you need
a model provider — until you have one, the dashboard shows a dismissible
*"This install can't generate yet"* callout with both buttons (Connect
nodaro.ai · Paste a key); it disappears on its own once a provider exists.
Three ways, and they run side by side:

**Paste a key in the app (no files, no restart).** Two places show the same
tiles: http://localhost:3000/setup → **Install health** (setup time, works
before you log in) and, once you are in the app, **Integrations → Model
providers**. Every provider is a tile — nodaro.ai, KIE.ai, Replicate,
Anthropic, Google Gemini, ElevenLabs, fal.ai, and, grouped apart as *used by
specific nodes*, HeyGen (avatar nodes), Beeble (Relight & Switch), Apify (Web
Scrape) — with a **PASTE KEY** field. (Connected to nodaro.ai? Then none of
them is required — every tile is covered by the connection.) Paste, Save, hit
Run on the demo's Scene Image node: Z-Image, the cheapest model, answers in
seconds. The key is stored
encrypted in your own database (the install generates its encryption key on
first boot and keeps it in the `app-data` volume — back that volume up with
the database) and takes effect at once, no restart. Each tile says what the
key powers and where to get one.

**Connect nodaro.ai (no keys to manage).** On the same page, step 2 →
**Connect nodaro.ai**. Your browser opens the nodaro.ai consent screen; sign
in or create a free account there (1,500 free credits on first sign-in — see
[Free credits](features/free-credits.md)), approve, and
you land back on your install connected — image, video, speech and LLM models
route through your nodaro.ai account — including the vendor-direct nodes
(AI Avatar / Cinematic Avatar, Relight & Switch, Web Scrape), which run on the
connection whenever their own key is empty.
Details and the two-accounts model:
[Connect your instance to Nodaro Cloud](./community-cloud-connect.md).

**Or keep keys in `.env` (infra-as-code).** Create a file named `.env` next
to the compose file:

```bash
KIE_API_KEY=...            # kie.ai — broadest model coverage
# or
REPLICATE_API_TOKEN=...    # replicate.com
# or
NODARO_API_KEY=...         # nodaro.ai as a plain provider — a personal API token
                           # from app.nodaro.ai → Settings → API (no OAuth flow)
```

then `docker compose -f docker-compose.community.yml up -d`. A key set in
`.env` takes precedence over one pasted on the screen; the tile shows
`set (env)` and is read-only there until you remove it from `.env`.

You pay providers directly; the Community edition has no credit system, no
Nodaro fees, and no watermark.

## Editing video

Any video result has an **Edit video** action that opens the NodarCut editor.
The editor page loads from `freecut.nodaro.ai`; **your video does not go with
it** — the app reads the file from your own storage and hands the bytes to the
editor inside your browser, and the editing and export happen there.

It works out of the box on `http://localhost:3000`. If you serve this install
on another origin — a LAN address, or a domain behind a reverse proxy — the
browser refuses to embed the editor and the panel explains why. Two ways
forward:

- **Ask us to allow your origin** — open an issue with the URL you serve on.
- **Run your own editor.** [FreeCut](https://github.com/nodaroai/freecut) is
  public and MIT-licensed and ships a Dockerfile. Point this install at it:

```bash
FREECUT_URL=https://freecut.example.internal
```

Restart the stack and the editor follows — no rebuild. Set `FREECUT_URL=off`
to remove the Edit-video action entirely.

## Editing audio

Audio results have an **Edit audio** action that opens the AudioMass editor the
same way — the bytes are handed to the editor inside your browser, nothing is
uploaded to it.

Unlike the video editor there is **no public hosted AudioMass**, so this action
is **inert until you configure it**: with nothing set, choosing **Edit audio**
opens a panel that explains what to set rather than an editor. Run your own
[AudioMass](https://github.com/nodaroai/audiomass) — Nodaro's fork speaks the
in-browser bridge the editor needs (vanilla AudioMass does not) — and point this
install at it:

```bash
AUDIOMASS_URL=https://audiomass.example.internal
```

Restart the stack and the editor follows — no rebuild. `AUDIOMASS_URL=off`
behaves the same as leaving it unset.

## Before exposing the stack to a network

The compose defaults are designed for local play and are public knowledge.
For anything reachable by other people:

1. Mint fresh auth keys — `node tools/generate-selfhost-keys.mjs >> .env`
   (JWT secret + anon + service keys must always come from the same run).
   A changed anon key needs only a restart — the container hands it to the
   browser at runtime (`/config.js`), no rebuild.
2. Set `POSTGRES_PASSWORD` and a matching `DATABASE_URL`, and fresh MinIO
   credentials (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`). Note the
   Postgres role passwords are aligned at the database's FIRST init — if
   the `db-data` volume already exists, wipe it or update the roles
   manually as `supabase_admin`.
3. Set `PUBLIC_URL` to your real https:// URL and front the stack with a
   reverse proxy — see [Deployment](deployment.md).

## Using managed services instead

Every bundled service can be swapped for a managed one in `.env`:

- **Managed Supabase**: set `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` to your supabase.com project values and set
  `RUN_MIGRATIONS_ON_BOOT=false` (apply `supabase/migrations/` via the
  Supabase SQL editor or CLI instead).
- **Cloudflare R2**: set the four `R2_*` account values and clear
  `R2_ENDPOINT` / `R2_FORCE_PATH_STYLE`.

## Updating

Every release publishes the image under four kinds of tag:

| Tag | Meaning |
|---|---|
| `vX.Y.Z` (e.g. `v2.0.0`) | Immutable — exactly one build, never re-pointed. Pin this for byte-stable deploys. |
| `vX.Y` | Floats across patches of one minor. |
| `vX` | Floats across a whole major — features and fixes arrive, breaking changes never do. |
| `latest` | Tracks every release, majors included. |

To update, pull and restart — database migrations apply themselves on boot:

```bash
docker compose -f docker-compose.community.yml pull nodaro
docker compose -f docker-compose.community.yml up -d nodaro
```

Before a **major** version (the first number changed), read the release
notes at https://github.com/nodaroai/app.nodaro.ai/releases first — majors
are the only releases allowed to change env vars, compose topology, or
behavior you may depend on. There is no downgrade path (migrations are
forward-only): take a backup before majors and restore it if you need to
go back:

```bash
tools/community-backup.sh              # everything the stack cannot regenerate, one archive
tools/community-restore.sh <archive>   # the road back — DESTRUCTIVE, asks for confirmation
```

On Windows run both from **Git Bash** (not PowerShell, not WSL). The backup
prints exactly what went into the archive and warns loudly if the encryption
key is missing; the restore verifies the media, the key and the app before
it starts anything. Full guide: [Backup & restore](backup-restore.html).

The running version is shown in the app sidebar and at `/health`. Click the
version for the release notes — of the version you are running, or of the
newest release when one is available: then a red dot appears next to it and
the same dialog adds the exact upgrade commands, with the backup step first. The check is one anonymous
request a day to GitHub's API; set `NODARO_UPDATE_CHECK=off` in `.env` to
disable it entirely (air-gapped installs — the version then shows as plain
text).

## Troubleshooting

- **Something red on /setup**: each failing card carries a hint naming the
  exact env vars to check.
- **`password authentication failed for user "supabase_auth_admin"`** in
  the auth logs: the `db-data` volume predates the roles init file. Wipe
  the volume (`docker compose down -v` — destroys data) or align the role
  passwords manually as `supabase_admin`.
- **Migrations failed on boot**: the app container logs name the exact
  file; the API refuses to start against a half-migrated schema. Re-run
  `docker compose up` after fixing — applied files are tracked and skipped.
- **`port is already allocated` on `docker compose up`**: the stack publishes
  exactly two host ports — **3000** (the app) and **9001** (the MinIO console,
  loopback only). Redis and the database are internal to the compose network
  and never bind a host port. If 3000 or 9001 is taken, change the host side
  of that mapping in `docker-compose.community.yml` (`"3001:3000"`) and, for
  the app port, set `PUBLIC_URL` to match.
- **Storage errors on upload**: open the MinIO console at
  http://localhost:9001 (default credentials are in the compose file).
- **CORS errors in browser**: set `CORS_ORIGIN=http://localhost:3000` in `.env`.
- **Need help?** Open an issue at https://github.com/nodaroai/app.nodaro.ai/issues.
