/**
 * "A server is not a person": is this address inside a range a hosting
 * provider publishes as its own?
 *
 * The list is `hosting-ranges.generated.json`, written by
 * `backend/scripts/update-hosting-ranges.mjs` from the providers' OWN
 * published lists (AWS, Google Cloud, Oracle, DigitalOcean, Linode, Vultr) —
 * nothing inferred, no third-party service, refreshed by running the script
 * and committing. A provider not on it (a small VPS host, a VPN "airport")
 * is simply not seen; the list says who IS a known hosting provider, never
 * who is not.
 *
 * Compiled once per process. The matcher is a linear scan over ~10k ranges —
 * microseconds — and it runs once per signup claim, not per request.
 */
import { createRequire } from "node:module"
import { compileCidrList, type CidrMatcher } from "./ip-address.js"
import { isPrivateOrReservedIP } from "./safe-fetch.js"

interface HostingRangesFile {
  generatedAt: string
  sources: Array<{ name: string; url: string; v4: number; v6: number }>
  v4: string[]
  v6: string[]
}

const require = createRequire(import.meta.url)
let compiled: { matcher: CidrMatcher; generatedAt: string; providers: string[] } | null = null

function load(): NonNullable<typeof compiled> {
  if (compiled) return compiled
  const file = require("./hosting-ranges.generated.json") as HostingRangesFile
  compiled = {
    matcher: compileCidrList([...file.v4, ...file.v6]),
    generatedAt: file.generatedAt,
    providers: file.sources.map((s) => s.name),
  }
  return compiled
}

/**
 * True when the address is inside a published hosting range. False for null,
 * unparseable, unlisted — and for private, documentation and reserved space,
 * whatever a regenerated list says (a geofeed once carried TEST-NET entries).
 */
export function isHostingAddress(address: string | null | undefined): boolean {
  if (!address || isPrivateOrReservedIP(address)) return false
  return load().matcher.matches(address)
}

/** For a boot line and the admin page: when the list was generated and from whom. */
export function hostingRangesInfo(): { generatedAt: string; providers: string[]; ranges: number } {
  const c = load()
  return { generatedAt: c.generatedAt, providers: c.providers, ranges: c.matcher.size }
}
