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
#
# Windows: run from Git Bash, never WSL bash or PowerShell. Git Bash rewrites
# POSIX-looking arguments into Windows paths (MSYS path conversion), which
# broke this script three ways on the first Windows rehearsal (#868): the
# trailing `/.` that makes `docker cp` MERGE into /data was canonicalised
# away (media landed in /data/minio-restore, MinIO saw an empty drive, the
# app could not boot), `docker compose run` tried to allocate a TTY under
# mintty and aborted the key restore, and the script still printed success.
# Container-side paths are only ever passed inside `sh -c '...'` strings
# (which the conversion leaves alone) or as `service:/path` pairs (likewise),
# media is copied to a staging dir and moved in-container, and every step
# that can fail silently is VERIFIED before the app is started.
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
for required in db.dump minio-data.tar; do
  if [ ! -f "$WORK/$required" ]; then
    echo "error: $ARCHIVE does not look like a community backup (no $required inside)" >&2
    exit 1
  fi
done
echo "Manifest:"
cat "$WORK/manifest.json" 2>/dev/null || echo "  (none)"
echo ""
if [ ! -f "$WORK/encryption-key" ]; then
  echo "WARNING: this archive has NO encryption key. The database will come back with provider"
  echo "         keys and social tokens nobody can decrypt, and this install will keep (or"
  echo "         generate) its own key. Only continue if the backup was taken on THIS install"
  echo "         and its app-data volume is intact."
  echo ""
fi
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
# sh/rm/mv exist in the minio image; tar does not — extract locally, copy in.
# The copy lands in a STAGING dir INSIDE the volume that does not exist yet
# (docker cp then creates it with the archive's contents, on every platform);
# the old contents are removed and the staged entries renamed into place in
# one in-container step — same filesystem, so no second copy of the media.
# Copying "dir/." straight onto /data relied on a trailing-dot merge that Git
# Bash canonicalises away.
mkdir -p "$WORK/minio-restore"
tar -xf "$WORK/minio-data.tar" -C "$WORK/minio-restore"
STAGE=/data/.restore-incoming
compose exec -T minio sh -c "rm -rf $STAGE" >/dev/null 2>&1 || true
compose cp "$WORK/minio-restore" "minio:$STAGE" >/dev/null
# Every command substitution / pipeline below that can legitimately come back
# empty ends in `|| true`: under `set -euo pipefail` a silent pipeline failure
# would otherwise kill the script with NO message — after /data was wiped.
if ! compose exec -T minio sh -c "
  set -e
  for entry in /data/* /data/.[!.]*; do
    [ -e \"\$entry\" ] || continue
    [ \"\$entry\" = $STAGE ] && continue
    rm -rf \"\$entry\"
  done
  for entry in $STAGE/* $STAGE/.[!.]*; do
    [ -e \"\$entry\" ] || continue
    mv \"\$entry\" /data/
  done
  rmdir $STAGE
"; then
  echo "error: moving the restored media into place FAILED inside the minio container." >&2
  echo "       The app was NOT started. Inspect with: docker compose -f $COMPOSE_FILE exec minio ls -la /data" >&2
  exit 1
fi
# MinIO does not pick up a data directory swapped underneath it — restart and
# wait for its own health check before the app (which depends on it) starts.
compose restart minio >/dev/null
MINIO_HEALTH=""
for _ in $(seq 1 30); do
  MINIO_HEALTH=$(compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1 == "minio" { print $2 }' || true)
  [ "$MINIO_HEALTH" = "healthy" ] && break
  sleep 2
done
# Bucket dirs = the non-dot entries of /data (the glob skips .minio.sys). No
# grep/find in the minio image — plain sh only.
BUCKETS=$(compose exec -T minio sh -c 'for d in /data/*; do [ -d "$d" ] && basename "$d"; done; true' 2>/dev/null | tr -d '\r' || true)
if [ -z "$BUCKETS" ] || [ "$MINIO_HEALTH" != "healthy" ]; then
  echo "error: media restore verification FAILED — buckets at /data: '${BUCKETS:-none}', minio health: '${MINIO_HEALTH:-unknown}'." >&2
  echo "       The app was NOT started. Inspect with: docker compose -f $COMPOSE_FILE exec minio ls -la /data" >&2
  exit 1
fi
echo "  verified: media restored ($(echo "$BUCKETS" | tr '\n' ' '| sed 's/ $//')), minio healthy"

echo "[4/6] Restoring the encryption key..."
if [ -f "$WORK/encryption-key" ]; then
  # The app is stopped; write via a one-shot container on the same volume.
  # -T: no pseudo-TTY — stdin is a file here, and under Git Bash (mintty)
  # the default TTY allocation fails outright, which is what aborted this
  # step on Windows while the script went on to report success.
  compose run --rm --no-deps -T --entrypoint sh nodaro -c 'mkdir -p /data/nodaro && cat > /data/nodaro/encryption-key && chmod 600 /data/nodaro/encryption-key' < "$WORK/encryption-key"
  EXPECTED=$(wc -c < "$WORK/encryption-key" | tr -d '[:space:]')
  WRITTEN=$(compose run --rm --no-deps -T --entrypoint sh nodaro -c 'wc -c < /data/nodaro/encryption-key' 2>/dev/null | tr -d '[:space:]\r' || true)
  if [ "${WRITTEN:-0}" != "$EXPECTED" ]; then
    echo "error: encryption key verification FAILED — wrote $EXPECTED bytes, volume holds '${WRITTEN:-nothing}'." >&2
    echo "       The app was NOT started: booting without the right key would mint a new one and make" >&2
    echo "       every restored provider key unreadable for good." >&2
    exit 1
  fi
  echo "  verified: encryption key in place ($WRITTEN bytes)"
else
  echo "  (archive has no encryption key — skipped; see the warning above)"
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
# The app's own health check is the last word — migrations run on this boot,
# and the first Windows rehearsal ended with the app down while the script
# said "complete". Bounded wait; the app takes a minute or two to come up.
APP_HEALTH=""
for _ in $(seq 1 60); do
  APP_HEALTH=$(compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1 == "nodaro" { print $2 }' || true)
  [ "$APP_HEALTH" = "healthy" ] && break
  sleep 3
done
if [ "$APP_HEALTH" != "healthy" ]; then
  echo "error: the app did not report healthy within 3 minutes (state: '${APP_HEALTH:-unknown}')." >&2
  echo "       The data is restored; inspect the boot with: docker compose -f $COMPOSE_FILE logs nodaro" >&2
  exit 1
fi

echo ""
echo "Restore complete — app healthy. Check http://localhost:3000/setup — every card should be green."
