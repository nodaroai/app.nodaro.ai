/**
 * The job gate of a content restriction (migration 581): a new job must not
 * use a restricted file as an input. The one check every job insert passes
 * (`gateJobInsert`, lib/insert-job.ts), the worker node's payload
 * (services/workflow-engine/node-executor.ts), the video routes' soundtrack
 * pre-check and the LLM chat route ask {@link restrictedInputKey} for the
 * request's input data; a restricted address names the request refused, in
 * the registry's shape, with the proxies' one sentence.
 *
 * A leaf module: the two modules it asks (the restricted set, the address
 * decoder) are light and loaded only when an input holds an address at all,
 * and the decoder only when a restriction exists. A route's test with the
 * barest config never reaches either.
 */

import { isEvidenceKey } from "./evidence-keys.js"

/** The policy id a refusal of this gate carries, beside the account block's. */
export const CONTENT_RESTRICTION_POLICY_ID = "platform:content-restriction"
/** The proxies' sentence; the request's refusal says the same and no more. */
export const CONTENT_RESTRICTED_MESSAGE = "This content is not available."

const ADDRESS_RE = /^https?:\/\//i
/** How deep an input is read for addresses; an input is a few levels of fields and lists. */
const MAX_DEPTH = 8

/** Every http(s) address in the input, in order, each once. */
export function inputAddresses(inputData: Record<string, unknown>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      if (ADDRESS_RE.test(value) && !seen.has(value)) {
        seen.add(value)
        out.push(value)
      }
      return
    }
    if (depth >= MAX_DEPTH || !value || typeof value !== "object") return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }
    for (const item of Object.values(value as Record<string, unknown>)) walk(item, depth + 1)
  }
  walk(inputData, 0)
  return out
}

/**
 * The first restricted storage key an input names, or null. Every http(s)
 * address in the input data is read; one of ours is decoded to its key and
 * asked against the active restrictions (read again once a minute on each
 * server, so a restriction placed a moment ago may be missed for up to a
 * minute elsewhere). A refusal is logged with the key and `who` (the job's
 * owner), server side only: that is evidence for the complaint case.
 *
 * The set is asked as this server knows it now, never waited on: when it
 * cannot be read and none was read before, the answer is "not restricted",
 * logged by the set — as the proxies answer: the bytes are on a public
 * network regardless, and a database hiccup must not refuse, or hold up,
 * every job that names one of our addresses.
 */
export async function restrictedInputKey(
  inputData: Record<string, unknown> | null | undefined,
  who?: { userId?: string | null },
): Promise<string | null> {
  if (!inputData) return null
  const addresses = inputAddresses(inputData)
  if (addresses.length === 0) return null
  // Only an address of ours can name a restricted key; the set is asked for
  // nothing else, and asked as this server knows it now, never waited on
  // (content-restriction-set.ts `restrictedKeysNow`). An address under the
  // evidence prefix (migration 583) is refused whatever the set says.
  const { restrictedKeyOfAddress } = await import("./content-restriction-address.js")
  const keys = addresses.map(restrictedKeyOfAddress).filter((k): k is string => typeof k === "string" && k.length > 0)
  if (keys.length === 0) return null
  const restricted = (await import("./content-restriction-set.js")).restrictedKeysNow()
  const hit = keys.find((key) => restricted.has(key) || isEvidenceKey(key)) ?? null
  if (hit) console.warn(`[content-restriction] refused a job input naming restricted key ${hit}${who?.userId ? ` (user ${who.userId})` : ""}`)
  return hit
}
