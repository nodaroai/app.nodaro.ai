import { z } from "zod"
import { config } from "../config.js"
import { DAEMON_NAME_RE } from "../private-plugins/daemons.js"
import type { PluginDaemonRequest, PluginDaemonResponse } from "../private-plugins/daemon-contract.js"

/**
 * The API side of the internal hop to a hosted plugin daemon — what
 * `tk.daemons.request` calls. The listener's address (`PLUGIN_DAEMONS_URL`)
 * and the internal secret come from here, never from the plugin, and the
 * request can only ever reach `/<daemon>/<path>` on that listener: a path that
 * would climb out of the daemon's prefix is refused before any I/O, and
 * redirects are not followed.
 *
 * An unreachable or silent daemon is an ANSWER (`reachable: false`), so the
 * calling route decides what the user sees — typically a 503 — instead of an
 * unhandled throw turning into a generic 500.
 */

const DEFAULT_TIMEOUT_MS = 10_000
const MIN_TIMEOUT_MS = 100
const MAX_TIMEOUT_MS = 120_000
const SECRET_HEADER = "x-internal-orchestrator-secret"

/** Where the listener is and what it expects — injected by tests, read from config otherwise. */
export interface PluginDaemonClientDeps {
  baseUrl: string
  secret: string
}

const requestSchema = z.object({
  daemon: z.string().regex(DAEMON_NAME_RE, "invalid daemon name"),
  path: z.string().min(1).max(2048),
  method: z.enum(["GET", "POST", "DELETE"]).optional(),
  body: z.unknown().optional(),
  timeoutMs: z.number().finite().optional(),
})

/**
 * Control characters and whitespace are refused outright: the URL parser
 * `fetch` uses STRIPS tab / CR / LF before it resolves dot segments, so
 * `/.\t./x` would become `/../x` after any string check had passed.
 */
const UNSAFE_PATH_CHAR = /[\x00-\x20\x7f]/

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function invalidPath(path: string): Error {
  return new Error(`invalid daemon path ${JSON.stringify(path)}`)
}

/**
 * The URL this request may go to: `/<daemon><path>` on the listener's origin,
 * checked twice — on the string (no control characters, no climb, no
 * scheme-relative or backslash tricks) and again on the PARSED result, so
 * whatever the parser normalised, the request cannot leave the daemon's prefix.
 */
function targetUrl(input: PluginDaemonRequest, baseUrl: string): URL {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")
    throw new Error(`invalid daemon request: ${issues}`)
  }
  const { daemon, path } = parsed.data
  const climbs = path
    .split("?", 1)[0]
    .split("/")
    .some((segment) => [".", ".."].includes(decodeSegment(segment)))
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || UNSAFE_PATH_CHAR.test(path) || climbs) {
    throw invalidPath(path)
  }

  const base = new URL(baseUrl)
  const url = new URL(`${base.origin}/${daemon}${path}`)
  if (url.origin !== base.origin || !(url.pathname === `/${daemon}` || url.pathname.startsWith(`/${daemon}/`))) {
    throw invalidPath(path)
  }
  return url
}

function clampTimeout(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(ms)))
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!contentType?.includes("application/json")) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Calls `/<daemon><path>` on the daemon host with the internal secret.
 * Throws only for a target that is not a daemon's own route (a caller bug);
 * every transport failure is `{ reachable: false }`.
 */
export async function requestPluginDaemon(
  input: PluginDaemonRequest,
  deps: PluginDaemonClientDeps = { baseUrl: config.PLUGIN_DAEMONS_URL, secret: config.INTERNAL_ORCHESTRATOR_SECRET },
): Promise<PluginDaemonResponse> {
  const url = targetUrl(input, deps.baseUrl)
  const hasBody = input.body !== undefined

  try {
    const res = await fetch(url, {
      method: input.method ?? "GET",
      headers: {
        [SECRET_HEADER]: deps.secret,
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(clampTimeout(input.timeoutMs)),
    })
    const text = await res.text()
    return { reachable: true, status: res.status, body: parseBody(text, res.headers.get("content-type")) }
  } catch (err) {
    return { reachable: false, error: isTimeout(err) ? "timeout" : "unreachable" }
  }
}
