/**
 * STORAGE_DELETES (lib/config.ts): whether this deployment deletes objects
 * from storage at all.
 *
 * `skip` is for a deployment that shares its media storage with another
 * deployment but runs on its own copy of the database (for example a staging
 * environment restored from production): its rows name files the other
 * deployment still references, so nothing here may delete them. Every delete
 * is then skipped with a warning instead of sent, the way a key under a kept
 * prefix is (lib/kept-storage-prefixes.ts): answered as kept, never as
 * failed, so the funnel (lib/storage-delete.ts) records nothing for the
 * failed-delete retry pass, which stands down (lib/storage-delete-retries.ts).
 * Everything around a delete still happens — rows go, links and quotas are
 * kept up to date — only the objects stay.
 *
 * THE ONE QUESTION. Every function in backend/src that sends a storage delete
 * command asks `storageDeletesSkipped()` first, and
 * `lib/__tests__/storage-delete-census.test.ts` fails the build on one that
 * does not. `deleteFromR2` / `batchDeleteFromR2` (lib/storage.ts) ask it
 * themselves, so a delete through them — and through the funnel, and the
 * plugin toolkit's `deleteFromR2` — needs nothing more.
 *
 * Asked at call time, not at import: `config` is parsed once at boot, and a
 * test sets the field on its config. A config with no such field (a test's
 * plain stub) reads as `on`.
 */
import { config } from "./config.js"

/** What a skipped delete's warning says. */
export const STORAGE_DELETES_OFF = "storage deletes are off on this deployment (STORAGE_DELETES=skip)"

/** Whether this deployment skips every storage delete (`STORAGE_DELETES=skip`). */
export function storageDeletesSkipped(): boolean {
  return config.STORAGE_DELETES === "skip"
}
