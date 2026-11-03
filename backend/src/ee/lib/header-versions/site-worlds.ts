import { z } from "zod"
import type { FetchLike } from "./github.js"
import type { SiteWorlds, WorldLink } from "./report-types.js"
import type { AskLink } from "./world-links.js"

/**
 * Where a site's worlds row leads. A product may pass the shared header its
 * own address for some worlds (`worldHrefs`), or hide the row
 * (`worldsRow={false}`); that choice is in the product's code, so its built
 * site says it at `/shell-worlds.json`. A world the file leaves out keeps the
 * header's own address, as the header itself does; a path is a page of the
 * site itself.
 *
 * The file is read like `/shell-version.json`, from the deployment's own
 * hosts. The addresses in it are the file's, not the deployment's, so they are
 * asked only through the probe (`world-links.ts`), never this fetch.
 */

export const WORLDS_FILE = "shell-worlds.json"
const TIMEOUT_MS = 8_000
/** A larger file is refused before it is parsed. */
const MAX_BYTES = 16_000
const MAX_WORLDS = 30

/** An https address, or a path on the site itself (`//…` would leave the site). */
const Href = z
  .string()
  .max(300)
  .refine((value) => value.startsWith("https://") || (value.startsWith("/") && !value.startsWith("//")), "must be an https:// address or a path starting with /")

const FileSchema = z.object({
  worldsRow: z.boolean(),
  worldHrefs: z
    .record(z.string().regex(/^[a-z0-9-]{1,40}$/), Href)
    .refine((hrefs) => Object.keys(hrefs).length <= MAX_WORLDS, `at most ${MAX_WORLDS} worlds`),
})

/** The file as read: where each world it names leads (absolute), or why there is none. */
export type WorldsFile =
  | { readonly status: "reported"; readonly worldsRow: boolean; readonly hrefs: ReadonlyMap<string, string> }
  | { readonly status: "not_reported" }
  | { readonly status: "no_answer" }
  | { readonly status: "invalid"; readonly message: string }

const NOT_REPORTED: WorldsFile = { status: "not_reported" }
const NO_ANSWER: WorldsFile = { status: "no_answer" }

const invalid = (why: string): WorldsFile => ({ status: "invalid", message: `/${WORLDS_FILE} ${why}` })

/**
 * `value` on the site `host`: an https address as given, a path as a page of
 * the site itself (`/\other.host` reads as another site in an address, so a
 * path must stay on `host`); `null` when it is neither.
 */
function resolve(value: string, host: string): string | null {
  try {
    const url = new URL(value, `https://${host}/`)
    if (url.protocol !== "https:") return null
    return value.startsWith("/") && url.host !== host ? null : url.href
  } catch {
    return null
  }
}

/**
 * The file's text as served by `host`. Anything but a JSON object is no file
 * at all (a site that sends its page for every address answers this one too);
 * an object this page cannot read is said so, with where.
 */
export function parseWorldsFile(source: string, host: string): WorldsFile {
  if (!source.trimStart().startsWith("{")) return NOT_REPORTED
  if (Buffer.byteLength(source, "utf8") > MAX_BYTES) return invalid(`is larger than ${MAX_BYTES / 1000} KB.`)
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch {
    return invalid("is not valid JSON.")
  }
  const parsed = FileSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""
    return invalid(`does not have the shape this page reads (${where}${issue?.message ?? "invalid"}).`)
  }
  const entries = Object.entries(parsed.data.worldHrefs).map(([id, value]) => [id, resolve(value, host)] as const)
  const unresolved = entries.find(([, href]) => href === null)
  if (unresolved) return invalid(`does not have the shape this page reads (worldHrefs.${unresolved[0]}: not an https address or a page of this site).`)
  return { status: "reported", worldsRow: parsed.data.worldsRow, hrefs: new Map(entries.flatMap(([id, href]) => (href === null ? [] : [[id, href] as const]))) }
}

/** The file `host` serves, asked past any cache: no such file is "not reported"; a site down or failing, "no answer". */
export async function readWorldsFile(fetch: FetchLike, now: () => number, host: string): Promise<WorldsFile> {
  try {
    const res = await fetch(`https://${host}/${WORLDS_FILE}?t=${now()}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.ok) return parseWorldsFile(await res.text(), host)
    return res.status >= 500 ? NO_ANSWER : NOT_REPORTED
  } catch {
    return NO_ANSWER
  }
}

/**
 * Every world of the header's list (`worlds`, `null` when unknown) with where
 * this site's link leads and what it answered: the site's own address, else
 * the header's. A world the file names that the list does not have is not
 * drawn: the header shows only its list. A hidden row leads nowhere.
 */
export async function siteWorlds(file: WorldsFile, worlds: readonly WorldLink[] | null, ask: AskLink): Promise<SiteWorlds> {
  if (file.status !== "reported") return file
  if (!file.worldsRow || worlds === null) return { status: "reported", worldsRow: file.worldsRow, links: [] }
  const links = await Promise.all(
    worlds.map(async (world) => {
      const own = file.hrefs.get(world.id)
      const href = own ?? world.href
      return { id: world.id, href, own: own !== undefined, answer: await ask(href) }
    }),
  )
  return { status: "reported", worldsRow: true, links }
}
