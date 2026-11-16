/**
 * MEDIA INPUTS GIVEN AS LINKS, ON A DEPLOYMENT THAT TURNED LINK IMPORTS OFF
 * (decided 2026-11-16). `imports.links: false` refuses a link to outside
 * content at every IMPORT lane (`lib/link-imports.ts`) and every MCP call
 * (`lib/mcp/tool-addresses.ts`). A reference picture, a source clip or a sound
 * given to a generation or processing route as a link was not covered: our
 * server fetches it, copies it, or hands it to a provider that fetches it.
 * `imports.inputLinks` (`surfaceInputLinksMode`) makes those inputs follow the
 * switch, in two steps the deployment controls:
 *
 *   - `"allow"` (absent, no profile, link imports on): exactly today.
 *   - `"report"`: the request goes on exactly as today; each input link that
 *     `"refuse"` would refuse is logged (lane, field, the link's host only,
 *     user) and counted into the admin reports (`kind: "input-link-report"`).
 *   - `"refuse"`: the switch's one refusal (`403 link_imports_disabled`, its
 *     message), before anything is created, reserved, fetched or sent.
 *
 * ONE RULE: what is outside is `isOutsideLink`, never anything here. WHICH
 * FIELDS: by name, as an MCP call's arguments are read (`lib/address-fields.ts`):
 * an ADDRESS-named field (`…url`, `…link`) is judged when it reads as one, a
 * MEDIA-named one (`…image`, `…video`, `…source`) when it has a fetched scheme,
 * a list item as its list. A prompt, an id, a mode, a JSON text and an endpoint
 * the request posts to (a webhook, a callback) are not judged. What a name
 * cannot say is declared per lane (`InputLinkReading`: a field that holds an
 * address under another name, a subtree read by a reader, a path that is not
 * content), and the declarations are held to the code by
 * `__tests__/input-links-census.test.ts`.
 *
 * THE LANES: every REST request with a body (`middleware/input-links.ts`, one
 * hook in front of every route's own preHandlers), and every node a workflow
 * run executes (`services/workflow-engine/node-executor.ts`: its inputs before
 * anything is read or created, its built payload again before its reservation).
 */
import { fieldFormByName, judgedSubtreeValues, judgedValues, readsAsAddress, stringsIn, type AddressForm } from "./address-fields.js"
import { ADDRESS_NAMES, type InputLinkReader, type InputLinkReading } from "./input-link-lanes.js"
import { LINK_IMPORTS_DISABLED_MESSAGE, isOutsideLink } from "./link-imports.js"
import { collectInputMediaUrls, collectNodeInputMediaUrls } from "./media-portability.js"
import { surfaceInputLinksMode, type InputLinksMode } from "./surface-profile.js"

export type { InputLinkReader, InputLinkReading } from "./input-link-lanes.js"
export type { InputLinksMode } from "./surface-profile.js"

/** Where a judged input came in: a REST route (`POST /v1/x`, its pattern) or a node type of a workflow run. */
export interface InputLinkLane {
  readonly kind: "route" | "node"
  readonly name: string
}

/** One judged link that is outside: where it sat, and its host (never the address itself). */
export interface OutsideInputLink {
  readonly field: string
  readonly host: string
}

export interface InputLinkVerdict {
  readonly mode: InputLinksMode
  /** The outside links found (empty under `"allow"`, where nothing is read). */
  readonly found: readonly OutsideInputLink[]
  /** The refusal to answer with, under `"refuse"` and only when something was found. */
  readonly refusal: { readonly code: "link_imports_disabled"; readonly message: string } | null
}

/**
 * Field names an endpoint the request POSTS TO, never content it takes in: a
 * webhook, a callback, a redirect target. Judged by their own name, like the
 * workflow import's endpoint fields (`lib/media-portability.ts`).
 */
const ENDPOINT_NAME = /(webhook|callback|endpoint|redirect|return|success|cancel)_?(url|uri)s?$/i

/** A request is a few levels of fields and lists; past this the walk stops. */
const MAX_DEPTH = 12

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Whether a concrete path (`a.b`, `a[]`) is the declared one (`a.*` matches any key there). */
function pathMatches(declared: string, path: string): boolean {
  const d = declared.split(".")
  const p = path.split(".")
  if (d.length !== p.length) return false
  return d.every((seg, i) => seg === p[i] || (seg === "*" && !p[i]!.endsWith("[]")) || (seg === "*[]" && p[i]!.endsWith("[]")))
}

function declaredAt<T>(table: Readonly<Record<string, T>> | undefined, path: string): T | undefined {
  if (!table) return undefined
  if (Object.hasOwn(table, path)) return table[path]
  for (const [declared, value] of Object.entries(table)) if (declared.includes("*") && pathMatches(declared, path)) return value
  return undefined
}

/** The host of a judged value, for a log line: never its path or query. */
export function linkHost(value: string): string {
  const v = value.trim()
  for (const candidate of [v, `https://${v.replace(/^[\\/]+/, "")}`]) {
    try {
      const host = new URL(candidate).host
      if (host) return host.toLowerCase()
    } catch {
      /* the next reading */
    }
  }
  return "(unreadable)"
}

/** A media field's value is judged as an address field's is (schemeless and `//` forms included). */
const inMediaField = (value: string): boolean => readsAsAddress(value, "address")

/** The links a reader finds in one value at `path`, each with where it sat. */
function readerLinks(reader: InputLinkReader, value: unknown, path: string): Array<{ field: string; value: string }> {
  if (reader === "subtree") return judgedSubtreeValues(value).map((v) => ({ field: path, value: v }))
  if (reader === "media-fields") return collectInputMediaUrls(value, inMediaField).map((v) => ({ field: path, value: v }))
  const nodes = reader === "workflow-nodes" ? (Array.isArray(value) ? value : []) : [value]
  return collectNodeInputMediaUrls(nodes, inMediaField).map((ref) => ({ field: `${path}.data.${ref.field.replace(/\[\d+\]/g, "[]")}`, value: ref.url }))
}

/**
 * Every value of `body` this reading judges, with where it sits: a field by
 * its name (a list item by its list's), a declared address, a declared reader.
 */
export function judgedInputLinks(body: unknown, reading: InputLinkReading = {}): Array<{ field: string; value: string }> {
  const out: Array<{ field: string; value: string }> = []
  const visit = (value: unknown, path: string, form: Exclude<AddressForm, "subtree" | "json"> | undefined, depth: number): void => {
    if (depth > MAX_DEPTH) return
    if (typeof value === "string") {
      if (form) for (const v of judgedValues(value, form)) out.push({ field: path, value: v })
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, `${path}[]`, form, depth + 1)
      return
    }
    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      const at = path ? `${path}.${key}` : key
      if (declaredAt(reading.notContent, at) !== undefined) continue
      const reader = declaredAt(reading.readers, at)
      if (reader) {
        out.push(...readerLinks(reader, child, at))
        continue
      }
      if (ENDPOINT_NAME.test(key)) continue
      // A name that holds an address under another word: everything under it is one.
      if (Object.hasOwn(ADDRESS_NAMES, key)) {
        for (const s of stringsIn(child)) for (const v of judgedValues(s, "address")) out.push({ field: at, value: v })
        continue
      }
      const declared = reading.addresses?.some((p) => pathMatches(p, at) || pathMatches(p, `${at}[]`)) ? "address" : undefined
      const byName = fieldFormByName(key)
      visit(child, at, declared ?? (byName === "json" ? undefined : byName), depth + 1)
    }
  }
  visit(body, "", undefined, 0)
  return out
}

// ── Reporting ──────────────────────────────────────────────────────────────

/** One admin report per lane, field and host at most this often; the count between them rides the next. */
const REPORT_EVERY_MS = 5 * 60_000

interface Tally {
  /** Links seen since the last report. */
  pending: number
  /** Links seen in all, since this process started. */
  total: number
  lastReportAt: number
}

const tallies = new Map<string, Tally>()

/** Hosts come from requests: the counts keep at most this many lanes, fields and hosts, the oldest first out. */
const MAX_TALLIES = 2_000

/** The admin-report writer, loaded once, on the first report (it reaches the database client). */
let appReportsModule: Promise<typeof import("./app-reports.js")> | null = null
const appReports = () => (appReportsModule ??= import("./app-reports.js"))

/** What this process has counted so far, per `lane|field|host` (for tests and diagnostics). */
export function inputLinkReportCounts(): ReadonlyMap<string, number> {
  return new Map([...tallies].map(([key, t]) => [key, t.total]))
}

/** For tests: forget the counts and the report clock. */
export function __resetInputLinkReportsForTests(): void {
  tallies.clear()
}

function laneLabel(lane: InputLinkLane): string {
  return lane.kind === "route" ? `route=${JSON.stringify(lane.name)}` : `node=${lane.name}`
}

/**
 * The log line and the count of one judged link. Best-effort and never
 * awaited: a report can neither fail nor slow the request it observes.
 */
function recordFinding(mode: InputLinksMode, lane: InputLinkLane, link: OutsideInputLink, userId: string | undefined): void {
  const outcome = mode === "refuse" ? "refused" : "would-refuse"
  console.warn(`[input-links] ${outcome} ${laneLabel(lane)} field=${link.field} host=${link.host} user=${userId ?? "anonymous"}`)
  const key = `${lane.kind}:${lane.name}|${link.field}|${link.host}`
  const now = Date.now()
  const tally = tallies.get(key) ?? { pending: 0, total: 0, lastReportAt: -Infinity }
  tally.pending++
  tally.total++
  if (!tallies.has(key) && tallies.size >= MAX_TALLIES) tallies.delete(tallies.keys().next().value!)
  tallies.set(key, tally)
  if (now - tally.lastReportAt < REPORT_EVERY_MS) return
  const count = tally.pending
  tally.pending = 0
  tally.lastReportAt = now
  void appReports()
    .then(({ insertAppReport }) =>
      insertAppReport({
        node: "input-links",
        kind: mode === "refuse" ? "input-link-refused" : "input-link-report",
        severity: mode === "refuse" ? "warning" : "info",
        title: `${mode === "refuse" ? "Refused" : "Would refuse"} ${count} input link${count === 1 ? "" : "s"} to ${link.host} (${lane.name}, ${link.field})`,
        payload: { mode, lane: lane.kind, name: lane.name, field: link.field, host: link.host, count },
        userId: userId ?? null,
      }),
    )
    .catch(() => {})
}

// ── The verdict ────────────────────────────────────────────────────────────

const ALLOWED: InputLinkVerdict = Object.freeze({ mode: "allow", found: Object.freeze([]), refusal: null })

/** Whether this mode refuses what it finds: `"refuse"` does, after recording it as `"report"` would. */
function refusesInputLinks(mode: InputLinksMode): boolean {
  return mode === "refuse"
}

/**
 * The verdict on the media inputs `value` carries, in `lane`, for this
 * deployment: inert under `"allow"` (nothing is read). Under `"report"` each
 * outside link is logged and counted and the verdict refuses nothing; under
 * `"refuse"` the same, and the switch's refusal when one was found. `skip`
 * names values judged already in this request (a payload judged after its
 * inputs), so a link is reported once.
 */
export function judgeInputLinks(
  lane: InputLinkLane,
  value: unknown,
  opts: { readonly reading?: InputLinkReading; readonly userId?: string; readonly skip?: ReadonlySet<string> } = {},
): InputLinkVerdict {
  const mode = surfaceInputLinksMode()
  if (mode === "allow") return ALLOWED
  const seen = new Set<string>()
  const found: OutsideInputLink[] = []
  for (const { field, value: link } of judgedInputLinks(value, opts.reading)) {
    if (opts.skip?.has(link) || !isOutsideLink(link)) continue
    const finding = { field, host: linkHost(link) }
    const key = `${finding.field}|${finding.host}`
    if (seen.has(key)) continue
    seen.add(key)
    found.push(finding)
  }
  const refuses = refusesInputLinks(mode) && found.length > 0
  for (const finding of found) recordFinding(refuses ? "refuse" : "report", lane, finding, opts.userId)
  const refusal = refuses ? { code: "link_imports_disabled" as const, message: LINK_IMPORTS_DISABLED_MESSAGE } : null
  return { mode, found, refusal }
}
