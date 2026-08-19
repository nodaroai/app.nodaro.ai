#!/usr/bin/env bash
# Restore a community install from a tools/community-backup.sh archive.
# This is also the DOWNGRADE path: migrations are forward-only, so going
# back a version means restoring the backup taken before the upgrade.
#
# Usage:  tools/community-restore.sh <backup.tar.gz>
#   COMPOSE_FILE=docker-compose.community.yml (override with env var)
#
# DESTRUCTIVE: replaces the database and the media store with the archive's
# contents. It stops the app for the duration and requires typing RESTORE.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.community.yml}"
ARCHIVE="${1:-}"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "usage: tools/community-restore.sh <backup.tar.gz>" >&2
  exit 1
fi
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "error: $COMPOSE_FILE not found — run from the install directory (or set COMPOSE_FILE)" >&2
  exit 1
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$ARCHIVE" -C "$WORK"
if [ ! -f "$WORK/db.dump" ]; then
  echo "error: $ARCHIVE does not look like a community backup (no db.dump inside)" >&2
  exit 1
fi
echo "Manifest:"
cat "$WORK/manifest.json" 2>/dev/null || echo "  (none)"
echo ""
echo "THIS REPLACES the database and media store of the install at $(pwd)."
printf 'Type RESTORE to continue: '
read -r CONFIRM
if [ "$CONFIRM" != "RESTORE" ]; then
  echo "aborted"
  exit 1
fi

echo "[1/6] Stopping the app + DB clients (db/minio stay up for the restore)..."
# auth + rest hold live Postgres connections — pg_restore --clean cannot
# drop objects under them.
compose stop nodaro auth rest
compose up -d db minio
sleep 3

echo "[2/6] Restoring Postgres..."
# --clean --if-exists: drop and recreate objects from the dump. pg_restore's
# exit code cannot distinguish disaster from --clean's benign artifacts on a
# supabase image (live test: ONE ignored error, a graphql_public drop-order
# quirk, data byte-identical) — so its exit code is reported, not obeyed, and
# success is verified FUNCTIONALLY right after.
set +e
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U supabase_admin -d postgres --clean --if-exists' < "$WORK/db.dump" 2>&1 | tail -5
RESTORE_CODE=${PIPESTATUS[0]}
set -e
if [ "$RESTORE_CODE" -ne 0 ]; then
  echo "  pg_restore exit $RESTORE_CODE — ignored-error noise is expected on the supabase image; verifying the data itself..."
fi
TABLES=$(compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '"'"'public'"'"';"' | tr -d '[:space:]')
if [ "${TABLES:-0}" -lt 20 ]; then
  echo "error: restore verification FAILED — only ${TABLES:-0} public tables present. The database may be in a partial state; re-run the restore." >&2
  exit 1
fi
echo "  verified: $TABLES public tables restored"

echo "[3/6] Restoring MinIO media..."
# sh/rm exist in the minio image; tar does not — extract locally, docker cp in.
compose exec -T minio sh -c 'rm -rf /data/* /data/.[!.]* 2>/dev/null; true'
mkdir -p "$WORK/minio-restore"
tar -xf "$WORK/minio-data.tar" -C "$WORK/minio-restore"
compose cp "$WORK/minio-restore/." minio:/data >/dev/null

echo "[4/6] Restoring the encryption key..."
if [ -f "$WORK/encryption-key" ]; then
  compose exec -T nodaro sh -c 'mkdir -p /data/nodaro' 2>/dev/null || true
  # The app is stopped; write via a one-shot container on the same volume.
  compose run --rm --no-deps --entrypoint sh nodaro -c 'cat > /data/nodaro/encryption-key' < "$WORK/encryption-key"
else
  echo "  (archive has no encryption key — skipped)"
fi

echo "[5/6] .env..."
if [ -f "$WORK/env" ]; then
  if [ -f .env ]; then
    cp .env ".env.pre-restore.$(date +%Y%m%d-%H%M%S)"
    echo "  existing .env saved aside"
  fi
  cp "$WORK/env" .env
fi

echo "[6/6] Starting the app..."
compose up -d auth rest nodaro

echo ""
echo "Restore complete. Check http://localhost:3000/setup — every card should be green."
