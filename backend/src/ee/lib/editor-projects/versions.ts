import { canonicalJson, contentHash } from "./canonical.js"
import { refuse } from "./refusal.js"
import { applyProjectPatch } from "./patch.js"

/**
 * The pure rules of a video-editor project's labelled versions (the storage
 * and database side is `version-store.ts`).
 *
 * A version is stored whole (`full`) or as an RFC 6902 JSON Patch (`patch`)
 * against an earlier FULL version (`base_number`), never against another
 * patch, so reading one is one or two files and deleting a patch affects no
 * other version. Either way the row's `content_hash` is the hash of the WHOLE
 * content the version stands for, and a version is only ever answered after
 * its rebuilt text has that hash.
 */

/** How many versions a project keeps before the oldest unprotected ones are thinned. */
export const VERSION_CAP = 50
/** How many versions a project holds at most, protected ones included. */
export const VERSION_CEILING = 200
/** How many patch versions one full version carries before the next version is stored whole. */
export const MAX_PATCHES_PER_FULL = 20
/** The author a person's own versions carry; any other author (an agent's) is never thinned. */
export const OWN_AUTHOR = "you"
/** The label a version cut at export carries; never thinned. */
export const EXPORTED_LABEL = "Exported"

export interface VersionShape {
  number: number
  label: string
  author: string
  kind: "full" | "patch"
  base_number: number | null
}

const isProtected = (v: VersionShape) => v.author !== OWN_AUTHOR || v.label === EXPORTED_LABEL

/**
 * The version numbers to delete, in the order to delete them.
 *
 * Past `cap`: the oldest versions first, but never a version whose author is
 * not "you" and never one labelled "Exported". Past `ceiling`, whatever is
 * still over it goes too, oldest first, protected or not: a client cannot pin
 * unbounded storage by naming its own authors.
 *
 * In both passes: never the newest version (the one just cut), and never a
 * full version while a patch version that is kept is based on it — a full
 * version is returned only after every patch on it. Empty at or under the
 * cap, and when nothing over it may go.
 */
export function versionsToThin(versions: ReadonlyArray<VersionShape>, cap = VERSION_CAP, ceiling = VERSION_CEILING): number[] {
  if (versions.length <= cap) return []
  const ordered = [...versions].sort((a, b) => a.number - b.number)
  const newest = ordered[ordered.length - 1]!.number
  const chosen = new Set<number>()
  const out: number[] = []
  const take = (until: number, protectedToo: boolean) => {
    while (versions.length - out.length > until) {
      const next = ordered.find((v) => {
        if (chosen.has(v.number) || v.number === newest || (!protectedToo && isProtected(v))) return false
        if (v.kind === "patch") return true
        // A full version: only once no remaining patch is based on it.
        return !ordered.some((p) => p.kind === "patch" && p.base_number === v.number && !chosen.has(p.number))
      })
      if (!next) return
      chosen.add(next.number)
      out.push(next.number)
    }
  }
  take(cap, false)
  take(Math.max(ceiling, cap), true)
  return out
}

/**
 * The full version a new patch version would be against: the newest full
 * version, while fewer than `MAX_PATCHES_PER_FULL` patches are based on it;
 * null when the new version must be stored whole.
 */
export function patchBaseFor(versions: ReadonlyArray<VersionShape>): number | null {
  let newestFull: number | null = null
  for (const v of versions) if (v.kind === "full" && (newestFull === null || v.number > newestFull)) newestFull = v.number
  if (newestFull === null) return null
  const onIt = versions.filter((v) => v.kind === "patch" && v.base_number === newestFull).length
  return onIt < MAX_PATCHES_PER_FULL ? newestFull : null
}

/** A patch is stored only when its gzip is under a quarter of the gzip of the whole content. */
export function storesAsPatch(patchGzBytes: number, wholeGzBytes: number): boolean {
  return patchGzBytes * 4 < wholeGzBytes
}

/**
 * A version's whole content as canonical text, rebuilt from its stored file
 * (`fileText`, the file inflated) and, for a patch, its full base's canonical
 * text; verified against the row's `content_hash`. Anything else — a missing
 * base, a file that does not parse, a patch that does not apply (or takes an
 * op other than add / remove / replace / test), a result with another hash —
 * is 500 `version_unreadable`, never other content.
 */
export function rebuildVersionText(
  version: { kind: "full" | "patch"; content_hash: string },
  fileText: string,
  baseText: string | null,
): string {
  let text: string
  try {
    const stored: unknown = JSON.parse(fileText)
    if (version.kind === "full") {
      text = canonicalJson(stored)
    } else {
      if (baseText === null) throw new Error("no base")
      text = canonicalJson(applyProjectPatch(JSON.parse(baseText), stored))
    }
  } catch {
    throw refuse(500, "version_unreadable")
  }
  if (contentHash(text) !== version.content_hash) throw refuse(500, "version_unreadable")
  return text
}
