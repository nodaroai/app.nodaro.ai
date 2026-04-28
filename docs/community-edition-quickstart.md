# Nodaro Community Edition Quickstart

5 steps to a running self-hosted Nodaro:

## 1. Create a Supabase project

Go to https://supabase.com and create a new project (free tier is fine for testing).

Copy these values from Project Settings:
- Project URL → `SUPABASE_URL`
- Service role key → `SUPABASE_SERVICE_ROLE_KEY`
- Anon key → `SUPABASE_ANON_KEY`

## 2. Apply database migrations

Run the SQL files in `supabase/migrations/` against your Supabase project, in
filename order, via the Supabase SQL editor or `supabase db push` if you have
the Supabase CLI linked.

## 3. Configure secrets

```bash
cp .env.example .env
echo "INTERNAL_ORCHESTRATOR_SECRET=$(openssl rand -hex 32)" >> .env
echo "SOCIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

Then edit `.env` and fill in the Supabase values from step 1 plus at least one
AI provider key (KIE_API_KEY, REPLICATE_API_TOKEN, or ANTHROPIC_API_KEY).

## 4. Start the stack

```bash
docker compose -f docker-compose.community.yml up
```

Wait for `nodaro-1` to log `server listening on http://0.0.0.0:9000` (backend), then visit http://localhost:3000.

Initial Docker build takes ~5-10 minutes (Node deps, Remotion bundling, frontend build). Subsequent boots are seconds.

## 5. Open the editor

http://localhost:3000

Sign up with an email + password (Supabase Auth handles this — no Google OAuth
required for community edition). The first user is automatically a regular
user; admin promotion is a manual SQL step (see DEPLOYMENT.md).

## Troubleshooting

- **CORS errors in browser**: set `CORS_ORIGIN=http://localhost:3000` in `.env`.
- **`Missing or invalid env vars` on startup**: check the error message lists
  the missing var; add it to `.env` and restart.
- **R2 errors on upload**: configure `R2_*` vars or use a different S3-compatible
  storage (MinIO, AWS S3, Backblaze B2).
- **Need help?** Open an issue at https://github.com/nodaroai/app.nodaro.ai/issues.
