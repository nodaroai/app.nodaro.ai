/**
 * The Idempotency-Key of a UGC node's calls on the canvas, derived the way the
 * orchestrator derives its own (`ugcDepsFor`): the node's own call (UGC
 * Script's job, a clip, …) carries the run's key and the node; each child call
 * — UGC Creator's images, readings and builder re-call, UGC Cards' timing jobs
 * — the run's key, then the node, the call's step and a fingerprint of the
 * exact request (SHA-256 of the route and the body with its keys sorted, as the
 * credit guard fingerprints a request).
 *
 * A repeat of the SAME run (one click: a retry, a second fire of the handler)
 * sends the same key for the same request, so each route hands back the job it
 * already started instead of selling it again. A different request is a job of
 * its own, and two children of one node never share a key (each route answers a
 * key it has seen with that key's job). A run nobody clicked carries no run key,
 * and then nothing is keyed, as for every canvas call.
 */

/** Past this, or with anything but printable ASCII, the part after the run's key is hashed: the routes bound a key at 200 characters. */
const MAX_PLAIN_KEY_LENGTH = 180
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

/** JSON with every object's keys sorted, so two encodings of one request agree (the credit guard's rule). */
function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`
}

async function sha256Hex(text: string): Promise<string | undefined> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (!subtle) return undefined
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** `<run key>:<part>`, the part hashed when the key would not fit a header. No run key, or no hashing on this page → none. */
async function keyed(runKey: string | undefined, part: string): Promise<string | undefined> {
  if (!runKey) return undefined
  const plain = `${runKey}:${part}`
  if (plain.length <= MAX_PLAIN_KEY_LENGTH && PRINTABLE_ASCII.test(plain)) return plain
  const hashed = await sha256Hex(part)
  return hashed === undefined ? undefined : `${runKey}:${hashed.slice(0, 40)}`
}

/**
 * The key of a UGC node's OWN call (UGC Script's job, a clip, UGC Clips, the creator builder, the
 * cards): the run's key and the node — as the orchestrator's node key names its node — so two nodes
 * one click runs (a sub-workflow's copies on the canvas share the click's key) never share one.
 */
export function ugcNodeIdempotencyKey(runKey: string | undefined, nodeId: string): Promise<string | undefined> {
  return keyed(runKey, nodeId)
}

export async function ugcChildIdempotencyKey(input: {
  /** The run's key for this node (the click's key, with the fan-out iteration): none → no key. */
  readonly runKey: string | undefined
  readonly nodeId: string
  /** The call's step within the node's run (`r0-c1-image`, `photo-check`, `alignment`, …). */
  readonly step: string
  readonly path: string
  readonly body: Readonly<Record<string, unknown>>
}): Promise<string | undefined> {
  const { runKey, nodeId, step, path, body } = input
  if (!runKey) return undefined
  const fingerprint = await sha256Hex(`${path}:${stableStringify(body)}`)
  // No hashing here (an insecure page): no key, never a key that could hand back another request's job.
  if (fingerprint === undefined) return undefined
  return keyed(runKey, `${nodeId}:${step}:${fingerprint.slice(0, 16)}`)
}
