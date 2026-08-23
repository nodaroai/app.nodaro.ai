#!/usr/bin/env bash
# One-command backup of a community compose install (versioning spec,
# versioning spec, 2026-08-19). Produces a single tar.gz holding everything the
# stack cannot regenerate:
#
#   db.dump           - Postgres (pg_dump custom format: workflows, users,
#                       jobs, asset metadata)
#   minio-data.tar    - generated media (the MinIO data dir)
#   encryption-key    - /data/nodaro/encryption-key. Restoring the DB
#                       WITHOUT this gives rows nobody can read (provider
#                       keys, social tokens) - deployment.md §8.
#   env               - the install's .env (provider keys, secrets)
#   manifest.json     - app version + timestamps, for the restore script
#
# Redis is deliberately absent: only ephemeral job state lives there.
#
# Usage:  tools/community-backup.sh [output-dir]
#   COMPOSE_FILE=docker-compose.community.yml (override with env var)
#
# The stack must be RUNNING (pg_dump goes through the db container).
# Consistency note: media written while the dump runs may miss the archive;
# for a guaranteed-consistent snapshot, stop the app first:
#   docker compose -f docker-compose.community.yml stop nodaro
#
# Windows: run this from Git Bash (the shell Git for Windows installs), never
# from WSL's bash or PowerShell. Git Bash rewrites arguments that look like
# POSIX paths into Windows paths before Docker sees them (MSYS path
# conversion) - `/data/nodaro/encryption-key` became
# `C:/Program Files/Git/data/nodaro/encryption-key` and the key was silently
# left out of every archive (#868). Container-side paths are therefore written
# with a doubled leading slash (`//data/...`), which the conversion leaves
# alone and the container's shell reads as `/data/...`. MSYS_NO_PATHCONV=1 is
# NOT the fix: it breaks the host-side paths `docker compose cp` needs.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.community.yml}"
OUT_DIR="${1:-./backups}"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "error: $COMPOSE_FILE not found — run from the install directory (or set COMPOSE_FILE)" >&2
  exit 1
fi
if ! compose ps --services --status running 2>/dev/null | grep -qx db; then
  echo "error: the db service is not running — start the stack first (docker compose -f $COMPOSE_FILE up -d)" >&2
  exit 1
fi

# setup-status carries the version on current images; /health as fallback.
VERSION=$(curl -sf --max-time 5 http://localhost:3000/v1/setup/status 2>/dev/null \
  | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1 || true)
if [ -z "$VERSION" ]; then
  VERSION=$(curl -sf --max-time 5 http://localhost:3000/health 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1 || true)
fi
VERSION="${VERSION:-unknown}"
STAMP=$(date +%Y%m%d-%H%M%S)
NAME="nodaro-backup-${STAMP}-v${VERSION}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT_DIR"

echo "[1/5] Postgres dump..."
# supabase_admin (the image's actual superuser; password stays inside the
# container) — dumping as plain `postgres` produces a dump whose supabase
# system objects cannot be restored (441 ownership errors on the live test).
compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U supabase_admin -d postgres --format=custom' > "$WORK/db.dump"

echo "[2/5] MinIO media..."
# docker cp, not in-container tar: the minio image ships no tar at all
# (exit 127 on the first live test of this script).
compose cp minio:/data "$WORK/minio-data" >/dev/null
tar -cf "$WORK/minio-data.tar" -C "$WORK/minio-data" .
rm -rf "$WORK/minio-data"

echo "[3/5] Encryption key..."
# Read through a one-shot container on the app-data volume (-T: no TTY — the
# default allocation fails under Git Bash's mintty), NOT `exec` into the app:
# the consistent-snapshot procedure in the docs stops `nodaro` first, and an
# exec into a stopped container silently produced a keyless archive. stderr
# is NOT silenced either — the first Windows failure was a path-conversion
# error, and hiding it read as "first boot may not have generated one yet", a
# wrong, reassuring diagnosis for an archive that could not restore its
# provider keys (#868). The path lives inside the -c string, which Git Bash
# leaves alone.
if ! compose run --rm --no-deps -T --entrypoint sh nodaro -c 'cat /data/nodaro/encryption-key' > "$WORK/encryption-key"; then
  rm -f "$WORK/encryption-key"
  echo "  WARNING: could not read the encryption key — see the error above." >&2
  echo "           This archive CANNOT restore pasted provider keys or social tokens." >&2
fi
if [ -f "$WORK/encryption-key" ] && [ "$(wc -c < "$WORK/encryption-key" | tr -d '[:space:]')" -lt 32 ]; then
  echo "  WARNING: the encryption key read back too short ($(wc -c < "$WORK/encryption-key") bytes) — not trusting it." >&2
  rm -f "$WORK/encryption-key"
fi

echo "[4/5] .env..."
if [ -f .env ]; then cp .env "$WORK/env"; else echo "  (no .env in $(pwd) — skipped)"; fi

echo "[5/5] Manifest + archive..."
# The manifest lists what is ACTUALLY in the archive, built from the work dir —
# a literal list claimed the key was present on every run that lost it.
CONTENTS=""
for f in db.dump minio-data.tar encryption-key env; do
  [ -f "$WORK/$f" ] && CONTENTS="${CONTENTS:+$CONTENTS, }\"$f\""
done
cat > "$WORK/manifest.json" <<MANIFEST
{
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "appVersion": "${VERSION}",
  "composeFile": "${COMPOSE_FILE}",
  "contents": [${CONTENTS}]
}
MANIFEST

ARCHIVE="$OUT_DIR/$NAME.tar.gz"
tar -czf "$ARCHIVE" -C "$WORK" .
# The archive holds .env (provider keys) and the instance encryption key —
# it IS a credential. Owner-only by default.
chmod 600 "$ARCHIVE"
SIZE=$(du -h "$ARCHIVE" | cut -f1)

echo ""
echo "Backup complete: $ARCHIVE ($SIZE)"
echo "Contents: ${CONTENTS}"
if [ -f "$WORK/env" ] || [ -f "$WORK/encryption-key" ]; then
  echo "NOTE: this archive contains secrets (the .env and/or the instance encryption key) —"
  echo "      treat it like a password. It is chmod 600; keep it that way."
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      echo "      On Windows chmod has no real effect — keep the file out of synced folders"
      echo "      and shared drives, and restrict it with NTFS permissions if others use this PC." ;;
  esac
fi
echo "Restore with:    tools/community-restore.sh '$ARCHIVE'"
if [ ! -f "$WORK/encryption-key" ]; then
  echo "" >&2
  echo "WARNING: NO ENCRYPTION KEY in this archive — a restore will bring back the database" >&2
  echo "         with provider keys and social tokens nobody can decrypt. Fix the error" >&2
  echo "         above and back up again before relying on this file." >&2
  # Nonzero on purpose: a cron job's log is rarely read, its exit code is.
  exit 2
fi
