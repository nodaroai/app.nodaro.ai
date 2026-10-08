/**
 * What a render's live run looks like to the Clip Pack inspector (§4.1 of the
 * inspectors design, A4-2): the quality it renders at, which clips' takes have
 * landed, and how far along the run is (`ClipLiveRun`, the card model's input).
 * Pure: the caller hands in the render's data as the LIVE store holds it, and
 * whether a run is in flight.
 *
 *  - The quality is the run this inspector started; else what the batch's row
 *    stamps say it was sent for; else a Preview, which is what every run that
 *    is not a Render final makes (the toolbar Run always previews).
 *  - A clip has landed when a row of the batch holds its take: the take's own
 *    key, else its row's stamp. A run clears the old batch when it starts
 *    (`resetNodeAccumulation`), so what is there is this run's.
 *  - Progress is the render's own `__listCompleted` of `__listTotal` (what its
 *    node face counts), else the landed clips of the clips it was sent.
 */
import { savedRenderBatch, type RenderQuality } from "@nodaro/shared"
import type { ClipLiveRun } from "./build-clip-cards"

type Rec = Record<string, unknown>
const isRecord = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v)
const count = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined)

function stampQuality(renderData: Rec): RenderQuality | undefined {
  const stamps = renderData.__listResultStamps
  if (!Array.isArray(stamps)) return undefined
  for (const stamp of stamps) {
    const quality = isRecord(stamp) ? stamp.quality : undefined
    if (quality === "proxy" || quality === "final") return quality
  }
  return undefined
}

export interface ClipLiveInput {
  /** A run that includes the render is in flight. */
  readonly running: boolean
  /** The run this inspector started, if it did. */
  readonly started: RenderQuality | null
  /** The clips the run was sent when the render does not say. */
  readonly fallbackTotal: number
}

export function clipLiveRun(renderData: Readonly<Rec>, input: ClipLiveInput): ClipLiveRun | undefined {
  if (!input.running) return undefined
  const quality = input.started ?? stampQuality(renderData) ?? "proxy"
  const stamps = renderData.__listResultStamps
  const landed = new Set<string>()
  for (const [row, item] of (savedRenderBatch(renderData) ?? []).entries()) {
    if (!item) continue
    const stamped = Array.isArray(stamps) && isRecord(stamps[row]) ? stamps[row].clipKey : undefined
    const key = item.clipKey ?? (typeof stamped === "string" && stamped ? stamped : undefined)
    if (key) landed.add(key)
  }
  const total = count(renderData.__listTotal) ?? input.fallbackTotal
  return { quality, landed, done: Math.min(count(renderData.__listCompleted) ?? landed.size, total), total }
}
