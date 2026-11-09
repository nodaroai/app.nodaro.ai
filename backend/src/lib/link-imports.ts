/**
 * The deployment's switch for links to outside content: `imports.links` on its
 * surface profile (`lib/surface-profile.ts`). A deployment sets it to `false`
 * when media from other sites has not been reviewed for it (and its network
 * filter blocks those hosts): a link to outside content is then refused before
 * any job, reservation or fetch, with ONE refusal everywhere.
 *
 * What it refuses is decided by the link, not by the lane: a link that is not
 * a file of this deployment's own storage is outside content (`isOutsideLink`).
 * An upload, a generated file and any other own media stays allowed.
 *
 * It sits in front of everything else in the import gate
 * (`requireImportAllowed` and its siblings ask it first, `lib/import-gate.ts`),
 * and is called directly by the import lanes the gate does not hold: a direct
 * file on another site given to Trim Audio, Transcribe or Suno, a copy of a
 * link into the account's storage, a Video URL node whose link a run reads.
 * `link-imports-totality.test.ts` keeps every route that takes a link counted.
 */
import { hasUrlParserHazard } from "@nodaro/shared/video"
import { isOwnMediaUrl } from "./fetch-own-media.js"
import { surfaceAllowsLinkImports } from "./surface-profile.js"

export const LINK_IMPORTS_DISABLED_MESSAGE =
  "Importing media from a link to another site is turned off on this deployment. Upload the file instead."

/**
 * The refusal. A pure function of the deployment's profile and the link, so a
 * worker retry answers the same (`lib/deterministic-job-error.ts`).
 */
export class LinkImportsDisabledError extends Error {
  readonly code = "link_imports_disabled" as const
  readonly deterministic = true
  constructor() {
    super(LINK_IMPORTS_DISABLED_MESSAGE)
    this.name = "LinkImportsDisabledError"
  }
}

/**
 * True when `url` is a link to outside content: anything but a file of this
 * deployment's own storage (`isOwnMediaUrl`). Own media is read strictly, as
 * `isOwnStoredFileUrl` reads it for the rights gate: a link with a character
 * two URL parsers read differently, one not already in its one normal form
 * (the raw string is what is handed on), or a transform of the content network
 * (`/cdn-cgi/…`, read after decoding, which can name a remote source) is
 * outside, whatever host it shows. The strict direction is the safe one, and
 * an unparsable link is not a file of ours either.
 */
export function isOutsideLink(url: string): boolean {
  if (hasUrlParserHazard(url)) return true
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  if (parsed.href !== url) return true
  let path: string
  try {
    path = decodeURIComponent(parsed.pathname)
  } catch {
    return true
  }
  if (/\/cdn-cgi\//i.test(path)) return true
  return !isOwnMediaUrl(url)
}

/**
 * The refusal of this link on this deployment, as a route sends it
 * (`reply.status(403).send({ error: ... })`), or null when it may go ahead.
 * Inert while the switch is on: nothing about the link is read.
 */
export function linkImportRefusal(url: string): { code: "link_imports_disabled"; message: string } | null {
  if (surfaceAllowsLinkImports() || !isOutsideLink(url)) return null
  return { code: "link_imports_disabled", message: LINK_IMPORTS_DISABLED_MESSAGE }
}

/** Throws `LinkImportsDisabledError` when this deployment refuses the link; the worker and gate form of {@link linkImportRefusal}. */
export function assertLinkImportAllowed(url: string): void {
  if (linkImportRefusal(url)) throw new LinkImportsDisabledError()
}
