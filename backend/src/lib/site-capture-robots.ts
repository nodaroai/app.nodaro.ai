/**
 * Site Capture's robots.txt check (RFC 9309), run on this server before a
 * keyed install creates a capture job. Read through safeFetch: the request
 * leaves from this server, unlike the page itself, which the actor loads.
 */
import { safeFetch } from "./safe-fetch.js"

/** The product token the capture names itself with; robots.txt groups match on it. */
export const ROBOTS_PRODUCT_TOKEN = "NodaroCapture"
/** Appended to the phone user agent, and sent on the robots.txt read. */
export const SITE_CAPTURE_UA_TOKEN = "NodaroCapture/1.0 (+https://nodaro.ai/capture)"
/** RFC 9309 asks parsers to read at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 512 * 1024
export const ROBOTS_TIMEOUT_MS = 5_000

export type RobotsOutcome = "allowed" | "disallowed" | "unreachable" | "site_unreachable" | "refused_address"

export interface RobotsRule {
  allow: boolean
  pattern: string
}

interface RobotsGroup {
  readonly rules: RobotsRule[]
}

/** One robots.txt line as `field: value`, or null. Linear: no regex runs over the attacker-sized parts of the line. */
function splitLine(raw: string): { key: string; value: string } | null {
  const hash = raw.indexOf("#")
  const line = (hash === -1 ? raw : raw.slice(0, hash)).trim()
  const colon = line.indexOf(":")
  if (colon <= 0) return null
  const key = line.slice(0, colon).trimEnd()
  if (!/^[A-Za-z-]+$/.test(key)) return null
  return { key: key.toLowerCase(), value: line.slice(colon + 1).trim() }
}

/**
 * Every group by lower-cased agent. A group that names an agent and no rule still exists (it allows
 * everything). An agent named by several groups maps to all of them. Rules are appended to the
 * group being read, so parsing stays linear in the size of the file.
 */
function parseGroups(text: string): ReadonlyMap<string, readonly RobotsGroup[]> {
  const byAgent = new Map<string, RobotsGroup[]>()
  let current: RobotsGroup | null = null
  let inRules = false
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const field = splitLine(raw)
    if (!field) continue
    const { key, value } = field
    if (key === "user-agent") {
      if (current === null || inRules) {
        current = { rules: [] }
        inRules = false
      }
      const agent = value.toLowerCase()
      const listed = byAgent.get(agent)
      if (!listed) byAgent.set(agent, [current])
      else if (!listed.includes(current)) listed.push(current)
      continue
    }
    if (key !== "allow" && key !== "disallow") continue
    inRules = true
    if (value === "" || current === null) continue // an empty rule matches nothing; a rule before any User-agent belongs to no group
    current.rules.push({ allow: key === "allow", pattern: value })
  }
  return byAgent
}

/** The rules for `productToken`: every group naming it (case-insensitive), else the `*` groups. */
export function rulesFor(text: string, productToken: string): RobotsRule[] {
  const byAgent = parseGroups(text)
  const token = productToken.toLowerCase()
  const mine = new Set<RobotsGroup>()
  for (const [agent, groups] of byAgent) {
    if (agent === token || agent.startsWith(`${token}/`)) for (const g of groups) mine.add(g)
  }
  const chosen = mine.size > 0 ? [...mine] : (byAgent.get("*") ?? [])
  return chosen.flatMap((g) => g.rules.map((r) => ({ ...r })))
}

/**
 * Whether a robots pattern matches the start of `path` (all of it with a trailing `$`). `*` matches
 * any run of characters. Matched segment by segment, each at its leftmost place, which is exact for
 * this pattern language and linear in the path: no regex, so a pattern full of `*` cannot backtrack.
 */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$")
  const body = anchored ? pattern.slice(0, -1) : pattern
  const parts = body.split("*")
  const first = parts[0]!
  if (parts.length === 1) return anchored ? path === first : path.startsWith(first)
  if (!path.startsWith(first)) return false
  const last = parts[parts.length - 1]!
  let pos = first.length
  let end = path.length
  if (anchored) {
    if (path.length - last.length < pos || !path.endsWith(last)) return false
    end = path.length - last.length
  }
  const middle = anchored ? parts.slice(1, -1) : parts.slice(1)
  for (const part of middle) {
    if (part === "") continue // a run of `*` is one `*`
    const at = path.indexOf(part, pos)
    if (at === -1 || at + part.length > end) return false
    pos = at + part.length
  }
  return true
}

/** RFC 9309 §2.2.2: the longest matching rule wins; Allow wins a tie; no match allows. */
export function isPathAllowed(rules: readonly RobotsRule[], pathAndQuery: string): boolean {
  let longest = -1
  let allowed = true
  for (const r of rules) {
    if (r.pattern.length < longest || !robotsPatternMatches(r.pattern, pathAndQuery)) continue
    if (r.pattern.length > longest) {
      longest = r.pattern.length
      allowed = r.allow
    } else if (r.allow) {
      allowed = true
    }
  }
  return allowed
}

/** What a failed robots.txt read means for the capture. */
export function classifyRobotsFetchError(err: unknown): RobotsOutcome {
  const chain: Array<{ name?: string; message?: string; code?: string }> = []
  let current: unknown = err
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const e = current as { name?: string; message?: string; code?: string; cause?: unknown }
    chain.push({ name: e.name, message: e.message, code: e.code })
    current = e.cause
  }
  const messages = chain.map((e) => e.message ?? "")
  // RFC 9309 §2.3.1.2: more than five redirects — robots.txt is unavailable, so everything is allowed.
  if (messages.some((m) => /^safeFetch: blocked — more than \d+ redirects/.test(m))) return "allowed"
  if (messages.some((m) => m.startsWith("safeFetch: blocked") || m.startsWith("safeFetch: refusing connection") || m.startsWith("safeFetch: not a valid URL"))) {
    return "refused_address"
  }
  if (chain.some((e) => e.name === "TimeoutError" || e.name === "AbortError")) return "unreachable"
  const SITE_DOWN = /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|CERT_|ERR_TLS_|ERR_SSL_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT)/
  if (chain.some((e) => typeof e.code === "string" && SITE_DOWN.test(e.code)) || messages.some((m) => m.startsWith("safeFetch: no DNS resolution"))) {
    return "site_unreachable"
  }
  return "unreachable"
}

async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const room = maxBytes - total
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value)
    total += Math.min(value.byteLength, room)
    if (total >= maxBytes) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks))
}

/** RFC 9309 for one page: 2xx parse, 4xx allow, 5xx or a timeout unreachable. */
export async function checkRobots(pageUrl: string, deps: { fetch?: typeof safeFetch } = {}): Promise<RobotsOutcome> {
  const fetchImpl = deps.fetch ?? safeFetch
  const target = new URL(pageUrl)
  let res: Response
  try {
    res = await fetchImpl(`${target.origin}/robots.txt`, {
      timeoutMs: ROBOTS_TIMEOUT_MS,
      headers: { "user-agent": `Mozilla/5.0 (compatible; ${SITE_CAPTURE_UA_TOKEN})`, accept: "text/plain,*/*" },
    })
  } catch (err) {
    return classifyRobotsFetchError(err)
  }
  if (res.status >= 500) {
    await res.body?.cancel().catch(() => undefined)
    return "unreachable"
  }
  if (res.status >= 300) {
    await res.body?.cancel().catch(() => undefined)
    return "allowed"
  }
  let text: string
  try {
    text = await readTextCapped(res, ROBOTS_MAX_BYTES)
  } catch (err) {
    return classifyRobotsFetchError(err)
  }
  return isPathAllowed(rulesFor(text, ROBOTS_PRODUCT_TOKEN), `${target.pathname}${target.search}`) ? "allowed" : "disallowed"
}
