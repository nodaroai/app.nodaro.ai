import { randomUUID } from "node:crypto"
import type { FastifyBaseLogger } from "fastify"
import { editorProjectsStore, type EditorProjectsStore } from "./bucket.js"
import { STORAGE_DELETES_OFF } from "../../../lib/storage-deletes-setting.js"
import { refuse } from "./errors.js"

/**
 * Where a video-editor project's content lives, and the one rule of deleting it.
 *
 *   editor-projects/<userId>/<projectId>/<uuid>.json.gz   (EDITOR_PROJECTS_BUCKET)
 *       One file per save that had new content: the gzip of its canonical
 *       text, written by this server from what it parsed. The project row
 *       names its current file (`blob_key`). A key is a fresh UUID each time
 *       and is never reused, so a file a row points to can never be the one
 *       some older delete (or a retried one) was about.
 *   editor-projects/<userId>/<projectId>/v-<uuid>.json.gz
 *       One file per version (its own copy of the whole content, or a JSON
 *       Patch against a whole version), named by its version row's
 *       `blob_key`. Never derived from the version's number.
 *
 * Keys are ASCII only (the user id, the project id and a UUID), so they stay
 * inside the database's 512-character check by bytes as well as characters.
 *
 * THE DELETE RULE: no code path deletes a key it did not either write in this
 * request (a save the database refused BY NAME, or one it answered `saved:
 * false` for — the two outcomes where it said it did not store the key; an
 * unknown outcome never deletes it, since the call may still commit)
 * or receive from its own database call as the key that call replaced
 * (`previous_blob_key`, read under the row lock) — or, for a project being
 * deleted, the key its own row named and the keys its version rows named. A
 * version's file is deleted only when this request wrote it and the database
 * refused its row by a check (so it definitely stored nothing), or after this
 * request deleted the row that named it (thinning). `discardFile` is the only
 * delete, and every caller passes one of those.
 *
 * Nothing here logs a key, a user or project id, or a hash.
 */

export { PATCH_BODY_MAX_BYTES, PATCH_TEXT_MAX_BYTES, PROJECT_BODY_MAX_BYTES, PROJECT_TEXT_MAX_BYTES } from "./limits.js"

export function projectPrefix(userId: string, projectId: string): string {
  return `editor-projects/${userId}/${projectId}/`
}

/** A key no other save has used or will use. */
export function newFileKey(userId: string, projectId: string): string {
  return `${projectPrefix(userId, projectId)}${randomUUID()}.json.gz`
}

/** A key for one version's file: never derived from the version's number, never reused. */
export function newVersionKey(userId: string, projectId: string): string {
  return `${projectPrefix(userId, projectId)}v-${randomUUID()}.json.gz`
}

const FILE_NAME = /^[0-9a-f-]{36}\.json\.gz$/
const VERSION_FILE_NAME = /^v-[0-9a-f-]{36}\.json\.gz$/

/** Whether `key` is one of this project's version file keys (checked on every read and delete of a key from a version row). */
export function isVersionFileKey(userId: string, projectId: string, key: string | null | undefined): key is string {
  const prefix = projectPrefix(userId, projectId)
  return typeof key === "string" && key.startsWith(prefix) && VERSION_FILE_NAME.test(key.slice(prefix.length))
}

/** Whether `key` is one of this project's file keys (a defence on every read and delete of a key from a row). */
export function isProjectFileKey(userId: string, projectId: string, key: string | null | undefined): key is string {
  const prefix = projectPrefix(userId, projectId)
  return typeof key === "string" && key.startsWith(prefix) && FILE_NAME.test(key.slice(prefix.length))
}

/** The private bucket, or 503 `not_available` when this deployment has none (or a misconfigured one, logged once through `log`). */
export function requireStore(log: FastifyBaseLogger): EditorProjectsStore {
  const store = editorProjectsStore(log)
  if (!store) throw refuse(503, "not_available")
  return store
}

/**
 * Deletes one file under the delete rule above. Best effort: a failure is
 * logged (its error name, never the key) and leaves an orphan, which can
 * never be a file a row points to.
 */
export async function discardFile(store: EditorProjectsStore, key: string, log: FastifyBaseLogger, why: string): Promise<void> {
  try {
    const outcome = await store.delete(key)
    if (outcome === "skipped") log.warn({ why }, `[editor-projects] file kept: ${STORAGE_DELETES_OFF}`)
  } catch (err) {
    log.warn({ why, error: (err as { name?: string })?.name ?? "Error" }, "[editor-projects] file delete failed; left as an orphan")
  }
}
