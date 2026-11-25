import type { FastifyBaseLogger } from "fastify"
import type { EditorProjectsStore } from "./bucket.js"
import { EditorProjectRefusal, failureOf, refuse, refusalOf, withoutDetail } from "./errors.js"
import { DIFF_TEXT_MAX_BYTES } from "./heavy-jobs.js"
import { fileFacts, versionContent, versionPatch } from "./heavy.js"
import {
  deleteVersion,
  deleteVersionByKey,
  findVersionByKey,
  insertVersion,
  listVersionRecords,
  readProject,
  readVersionRecord,
  type ProjectRow,
  type VersionRecord,
} from "./rows.js"
import { requireRoomFor } from "./storage-ceiling.js"
import { PROJECT_TEXT_MAX_BYTES, discardFile, isProjectFileKey, isVersionFileKey, newVersionKey } from "./store.js"
import { patchBaseFor, versionsToThin } from "./versions.js"

/**
 * A project's labelled versions in storage and the database: cutting one
 * from the project's saved content, reading one back whole, thinning past
 * the cap, and the files of a deleted project. Every delete follows the
 * store's delete rule (store.ts); nothing here logs a key, an id or a hash.
 * Storage and the database are read here; every inflate, parse, hash, diff
 * and gzip runs on the heavy-work thread (`heavy.ts`).
 *
 * Every function takes a project already read as the caller's own live one:
 * the version rows carry no owner of their own.
 */

export interface VersionContext {
  readonly userId: string
  readonly projectId: string
  readonly store: EditorProjectsStore
  readonly log: FastifyBaseLogger
}

export type CutResult = { number: number } | { number: null; unchanged: true } | { number: null; moved: true }

/**
 * Cuts a version of the project's current saved content (never of anything a
 * client sends): none when that content is the newest version's. The file is
 * written first, under its own key, then the row; the number is the project's
 * highest plus one, and a number taken meanwhile (the unique constraint) is
 * retried once with the next one, keeping the same file. A row refused by the
 * database's checks deletes the file; an unknown outcome keeps it (the row may
 * have landed: when it did, that is the version). Afterwards the project is
 * thinned to the cap (unless `thin: false`: the caller thins later, with
 * `thinVersions`); a thinning that fails never fails the cut.
 *
 * With `hash`, only content with that hash is cut: when the project's saved
 * content is already other content, nothing is cut (`moved`). A cut that
 * would pass the person's stored-bytes ceiling is 413 `project_storage_full`
 * (`storage-ceiling.ts`; `roomChecked`: the caller already checked).
 *
 * A project deleted while the cut runs: the project is read again just before
 * the row is inserted (deleted: the file is deleted, 404), and again after it
 * (deleted meanwhile: the row is deleted, then its file, 404). The project's
 * delete lists version files after its own soft delete, so between the two a
 * version file is never left with nothing to delete it.
 */
export async function cutVersion(
  ctx: VersionContext,
  row: ProjectRow,
  label: string,
  author: string,
  options: { thin?: boolean; hash?: string; roomChecked?: boolean } = {},
): Promise<CutResult> {
  if (!row.content_hash) throw refuse(404, "not_found")
  if (options.hash !== undefined && row.content_hash !== options.hash) return { number: null, moved: true }
  const versions = await listVersionRecords(ctx.projectId)
  const newest = versions[versions.length - 1]
  if (newest?.content_hash === row.content_hash) return { number: null, unchanged: true }
  // The ceiling on stored bytes, before any heavy work: the version's file is at most a
  // copy of the saved one (`size_bytes`, its gzip). 413 `project_storage_full`.
  if (!options.roomChecked) await requireRoomFor(ctx.userId, row.size_bytes ?? 0)
  const current = await currentContent(ctx, row)
  if (options.hash !== undefined && current.hash !== options.hash) return { number: null, moved: true }
  if (current.hash !== row.content_hash && newest?.content_hash === current.hash) return { number: null, unchanged: true }
  const stored = await storedForm(ctx, versions, current)
  const key = newVersionKey(ctx.userId, ctx.projectId)
  // A failed write is a 500 with no row and nothing deleted.
  await ctx.store.put(key, stored.gz)
  if ((await liveNow(ctx)) === false) {
    // No row names the file, and none will: the project is gone.
    await discardFile(ctx.store, key, ctx.log, "project deleted")
    throw refuse(404, "not_found")
  }
  const record: VersionRecord = {
    number: (newest?.number ?? 0) + 1,
    label,
    author,
    kind: stored.kind,
    base_number: stored.base_number,
    content_hash: current.hash,
    size_bytes: stored.gz.length,
    blob_key: key,
  }
  const number = await insertNumbered(ctx, record)
  if ((await liveNow(ctx)) === false) {
    // Deleted while the row landed: this cut's own row, then its file (the delete rule).
    if (await deleteVersionByKey(ctx.projectId, key).catch(() => false)) await discardFile(ctx.store, key, ctx.log, "project deleted")
    throw refuse(404, "not_found")
  }
  if (options.thin !== false) await thinVersions(ctx)
  return { number }
}

/** Whether the project is still the caller's live one: false when it is not, null when that cannot be read (an unknown, which deletes nothing). */
async function liveNow(ctx: VersionContext): Promise<boolean | null> {
  try {
    return (await readProject(ctx.userId, ctx.projectId)) !== null
  } catch {
    return null
  }
}

/**
 * Why the project's saved content could not be read (answered as 500
 * `file_missing` either way): `absent` — storage has no object at the row's
 * key; `unverifiable` — an object is there but does not inflate or does not
 * hash to the row's hash, or the row's key is not the project's own. Bytes
 * that are there but unverifiable are never deleted by a repair.
 */
export class CurrentFileUnreadable extends EditorProjectRefusal {
  constructor(readonly reason: "absent" | "unverifiable") {
    super(500, "file_missing")
  }
}

/** The project's saved content: the file its row names (its gzip), verified against the row's hash; and its text's size. */
async function currentContent(ctx: VersionContext, row: ProjectRow): Promise<{ hash: string; gz: Buffer; textBytes: number }> {
  let current = row
  let reason: "absent" | "unverifiable" = "absent"
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!isProjectFileKey(ctx.userId, ctx.projectId, current.blob_key)) {
      reason = "unverifiable"
    } else {
      let gz: Buffer | null
      try {
        gz = await ctx.store.read(current.blob_key, PROJECT_TEXT_MAX_BYTES)
      } catch (err) {
        // An object too large to be a saved project is there, but unverifiable.
        if (!(err instanceof EditorProjectRefusal)) throw err
        gz = null
        reason = "unverifiable"
      }
      const expected = current.content_hash
      if (gz && expected) {
        // The saved file is the canonical text's gzip, written by this server.
        const facts = await fileFacts(gz, expected)
        if (facts.ok) return { hash: expected, gz, textBytes: facts.textBytes }
        reason = "unverifiable"
      }
    }
    if (attempt > 0) break
    // A save may have replaced the file since the row was read: read the row once more.
    const again = await readProject(ctx.userId, ctx.projectId)
    if (!again?.content_hash) throw refuse(404, "not_found")
    if (again.blob_key === current.blob_key) break
    current = again
  }
  throw new CurrentFileUnreadable(reason)
}

/** Whether the project's saved file reads back as its content: `ok`, or why not. One storage read. */
export async function currentFileState(ctx: VersionContext, row: ProjectRow): Promise<"ok" | "absent" | "unverifiable"> {
  try {
    await currentContent(ctx, row)
    return "ok"
  } catch (err) {
    if (err instanceof CurrentFileUnreadable) return err.reason
    throw err
  }
}

/**
 * How the new version is stored: a patch against the newest full version
 * (while it has fewer than 20 patches) when both texts are at most 2 MB, the
 * diff stays within its operation cap, the patch's gzip is under a quarter of
 * the whole's AND it rebuilds to this content exactly as a read will rebuild
 * it (all on the heavy-work thread, `heavy-jobs.ts` `diff`); otherwise whole,
 * as a copy of the saved file's gzip. A diff past its time or memory limit
 * stores the version whole and is never attempted again.
 */
async function storedForm(
  ctx: VersionContext,
  versions: VersionRecord[],
  current: { hash: string; gz: Buffer; textBytes: number },
): Promise<{ kind: "full" | "patch"; base_number: number | null; gz: Buffer }> {
  const whole = { kind: "full" as const, base_number: null, gz: current.gz }
  if (current.textBytes > DIFF_TEXT_MAX_BYTES) return whole
  const baseNumber = patchBaseFor(versions)
  const base = baseNumber === null ? undefined : versions.find((v) => v.number === baseNumber)
  if (!base || base.kind !== "full") return whole
  try {
    const patch = await versionPatch(await versionFile(ctx, base.blob_key), base.content_hash, current.gz, current.hash)
    return patch ? { kind: "patch", base_number: base.number, gz: patch } : whole
  } catch {
    // An unreadable base: store it whole.
    return whole
  }
}

/** SQLSTATE classes that mean the insert definitely stored nothing: data exceptions and constraint violations. */
const definitelyNotStored = (err: unknown) => {
  const code = (err as { code?: unknown } | null)?.code
  return (typeof code === "string" && (code.startsWith("22") || code.startsWith("23"))) || refusalOf(err)?.code === "not_available"
}

const isTakenNumber = (err: unknown) => (err as { code?: unknown } | null)?.code === "23505"

/** The insert, numbered; a database error leaves here without its detail (`withoutDetail`). */
async function insertNumbered(ctx: VersionContext, record: VersionRecord): Promise<number> {
  try {
    return await insertNumberedRaw(ctx, record)
  } catch (err) {
    throw withoutDetail(err, "version insert")
  }
}

async function insertNumberedRaw(ctx: VersionContext, record: VersionRecord): Promise<number> {
  let attempt = record
  for (let tries = 0; ; tries++) {
    try {
      await insertVersion(ctx.projectId, attempt)
      return attempt.number
    } catch (err) {
      if (isTakenNumber(err) && tries === 0) {
        // Another cut took the number: the next one, with the same file.
        let highest: number
        try {
          const now = await listVersionRecords(ctx.projectId)
          highest = now.reduce((max, v) => Math.max(max, v.number), 0)
        } catch (listErr) {
          // The insert definitely stored nothing.
          await discardFile(ctx.store, record.blob_key, ctx.log, "refused version")
          throw listErr
        }
        attempt = { ...record, number: highest + 1 }
        continue
      }
      if (definitelyNotStored(err)) {
        await discardFile(ctx.store, record.blob_key, ctx.log, "refused version")
        throw err
      }
      // An unknown outcome: the row may have landed. The file is never deleted here.
      const landed = await findVersionByKey(ctx.projectId, record.blob_key).catch(() => null)
      if (landed) return landed.number
      throw err
    }
  }
}

/** Thins the project to the cap (versions.ts `versionsToThin`): each row first, then the file it named. Never throws. */
export async function thinVersions(ctx: VersionContext): Promise<void> {
  try {
    const all = await listVersionRecords(ctx.projectId)
    for (const number of versionsToThin(all)) {
      const gone = await deleteVersion(ctx.projectId, number)
      if (gone && isVersionFileKey(ctx.userId, ctx.projectId, gone.blobKey)) {
        await discardFile(ctx.store, gone.blobKey, ctx.log, "version thinned")
      }
    }
  } catch (err) {
    ctx.log.warn(failureOf(err), "[editor-projects] thinning versions failed; a later cut thins them")
  }
}

/** One version file's bytes (its gzip); a missing or oversized file, or a key not the project's own, is 500 `version_unreadable`. */
async function versionFile(ctx: VersionContext, key: string): Promise<Buffer> {
  if (!isVersionFileKey(ctx.userId, ctx.projectId, key)) throw refuse(500, "version_unreadable")
  let gz: Buffer | null
  try {
    gz = await ctx.store.read(key, PROJECT_TEXT_MAX_BYTES)
  } catch (err) {
    if (err instanceof EditorProjectRefusal) throw refuse(500, "version_unreadable")
    throw err
  }
  if (!gz) throw refuse(500, "version_unreadable")
  return gz
}

/**
 * Version `version`'s whole content as the gzip of its canonical text,
 * rebuilt (a patch on its full base) and verified against the row's hash on
 * the heavy-work thread: 500 `version_unreadable` for a missing base or file,
 * anything that does not rebuild to that hash, or a rebuild past its time or
 * memory limit — never other content.
 */
export async function readVersionGzip(ctx: VersionContext, version: VersionRecord): Promise<Buffer> {
  const file = await versionFile(ctx, version.blob_key)
  if (version.kind === "full") return versionContent(file, version, null)
  const base = version.base_number === null ? null : await readVersionRecord(ctx.projectId, version.base_number)
  if (!base || base.kind !== "full") throw refuse(500, "version_unreadable")
  return versionContent(file, version, { file: await versionFile(ctx, base.blob_key), content_hash: base.content_hash })
}

/** A deleted project's version files (the keys its version rows named, read before the delete). */
export async function discardVersionFiles(ctx: VersionContext, keys: ReadonlyArray<string>): Promise<void> {
  for (const key of keys) {
    if (isVersionFileKey(ctx.userId, ctx.projectId, key)) await discardFile(ctx.store, key, ctx.log, "project deleted")
  }
}
