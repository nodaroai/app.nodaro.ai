/**
 * The re-host size refusal (SV12, decided 2026-10-06).
 *
 * A self-host runs Speaker View on nodaro.ai: the relay re-hosts every private
 * source of the edit first, buffering each one up to `MAX_REHOST_BYTES`
 * (`providers/nodaro/client.ts`). An hour of camera footage is far over that.
 * So an over-cap source is refused BEFORE anything is charged, naming the
 * source and its size — by ONE helper, asked in every place a run can start:
 *  - the near-end route (`routes/nodaro-exclusive.ts`), before the job exists;
 *  - the orchestrator's up-front scan of a canvas / template run
 *    (`services/workflow-engine/relay-rehost-preflight.ts`), before ANY relayed
 *    node dispatches — otherwise a relayed node upstream (billed on the cloud)
 *    charges first and Speaker View then fails inside the re-host;
 *  - the relay worker itself, right before it re-hosts (an edit made during the
 *    run is first readable there).
 * A source whose size cannot be learned passes: the in-rehost cap is the
 * backstop, and its error names the source the same way (`rehostSizeMessage`).
 */
import { rehostByteSize } from "../providers/nodaro/client.js"
import { MAX_REHOST_BYTES } from "../providers/nodaro/rehost-limit.js"

export interface RehostSizeHit {
  /** The EDL source's id — the name the edit gives that camera or mic. */
  readonly sourceId: string
  readonly bytes: number
}

/** The size of a URL the relay would re-host; `undefined` when it would not
 *  re-host it, or the size is unknown. */
export type RehostByteSizeProbe = (url: string) => Promise<number | undefined>

const parse = (raw: unknown): unknown => {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/** Every source of `edl` (an EDL object or its JSON string) over the re-host
 *  cap, in source order. Empty for anything that is not one edit with
 *  sources, and never throws: a size the probe cannot tell is no hit. */
export async function checkRehostSizes(edl: unknown, opts: { probe?: RehostByteSizeProbe } = {}): Promise<RehostSizeHit[]> {
  const value = parse(edl) as { sources?: unknown } | null | undefined
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.sources)) return []
  const sources = (value.sources as unknown[]).filter(
    (s): s is { id: string; url: string } =>
      !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string" && typeof (s as { url?: unknown }).url === "string",
  )
  const probe = opts.probe ?? rehostByteSize
  const sizes = new Map<string, Promise<number | undefined>>()
  for (const { url } of sources) {
    if (!sizes.has(url)) sizes.set(url, probe(url).catch(() => undefined))
  }
  const hits: RehostSizeHit[] = []
  for (const { id, url } of sources) {
    const bytes = await sizes.get(url)
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > MAX_REHOST_BYTES) hits.push({ sourceId: id, bytes })
  }
  return hits
}

/** Bytes in decimal units, as the cap is written: "812 MB", "3.1 GB". */
export function formatMediaBytes(bytes: number): string {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`
}

/** The refusal: which node, which sources and how big, and what to do. */
export function rehostSizeMessage(nodeLabel: string, hits: readonly RehostSizeHit[]): string {
  const named = hits.map((h) => `"${h.sourceId}" is ${formatMediaBytes(h.bytes)}`)
  const list = named.length <= 1 ? named.join("") : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`
  return (
    `${nodeLabel} sends each source of the edit to nodaro.ai; ${list}, over the ${formatMediaBytes(MAX_REHOST_BYTES)} limit. ` +
    "Use a public URL or a smaller file."
  )
}
