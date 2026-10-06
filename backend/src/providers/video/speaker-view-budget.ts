/**
 * Speaker View's job budget — a PURE leaf, like `apply-edl-budget.ts` (whose
 * timeline formula it runs): the video worker's dispatch site reads it through
 * `declaredJobBudgetMs("speaker-view", job.data)` (`lib/job-budget.ts`), and so
 * will the orchestrator's node ceilings and the relay's poll budget once the
 * node exists (C3.1).
 *
 * WHY THE APP HOLDS IT. Speaker View's handler lives in the private plugin and
 * a plugin handler cannot declare `livenessBudgetMs` (core-only). Without a
 * registered budget its pre-task heartbeat stopped at the 90-minute default,
 * and a 3-hour final was swept while still rendering (C2.0, decided
 * 2026-10-06).
 *
 * THE WORST CASE. The handler assigns layouts AFTER dispatch — after it splits
 * turns and reads Camera Switch's hints — so how many slots each segment
 * composites is not in the payload. The budget assumes the most the payload
 * allows: one slot per distinct speaker the edit names (its segments'
 * `speaker` and every layout slot's), at most `SPEAKER_VIEW_MAX_SLOTS`, and
 * that maximum when it names none. Every segment is charged that many slots
 * (`edlTimelineRenderBudgetMs`'s `assumeSlots`): each slot's decode, its
 * branch of the picture, the smaller graphs it forces (`videoSegmentCap`), and
 * the fetch of every picture source of the edit.
 *
 * THE PAYLOAD it reads: `{ edl, quality? }` — the EDL the handler will render
 * (sources, segments on the master clock). A payload it cannot read declares
 * no budget (`undefined`, the readers' default); so does an edit over the
 * 180-minute output cap (F4), which no ingress lets through.
 */
import type { Edl, EdlSegment } from "@nodaro/shared"
import { edlDurationMs } from "@nodaro/shared"
import { APPLY_EDL_MAX_OUTPUT_MS, edlTimelineRenderBudgetMs } from "./apply-edl-budget.js"

/** The most slots a Speaker View layout composites (`grid`, `SPEAKER_LAYOUTS`). */
export const SPEAKER_VIEW_MAX_SLOTS = 6

/** The slots the budget assumes per segment: one per distinct speaker the
 *  edit names, capped at `SPEAKER_VIEW_MAX_SLOTS`; the cap when it names none. */
export function speakerViewWorstCaseSlots(edl: Edl): number {
  const speakers = new Set<string>()
  for (const seg of edl.segments as readonly (EdlSegment | null | undefined)[]) {
    if (!seg || typeof seg !== "object") continue
    if (typeof seg.speaker === "string" && seg.speaker) speakers.add(seg.speaker)
    const slots = Array.isArray(seg.layout?.slots) ? seg.layout!.slots! : []
    for (const slot of slots) if (slot && typeof slot.speaker === "string" && slot.speaker) speakers.add(slot.speaker)
  }
  return speakers.size === 0 ? SPEAKER_VIEW_MAX_SLOTS : Math.min(SPEAKER_VIEW_MAX_SLOTS, speakers.size)
}

/** The budget (ms) of ONE speaker-view job, read off its queue payload. */
export function speakerViewJobBudgetMs(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined
  const { edl } = data as { edl?: Edl }
  if (!edl || typeof edl !== "object" || !Array.isArray(edl.segments) || !Array.isArray(edl.sources)) return undefined
  if (edl.segments.length === 0) return undefined
  if (edlDurationMs(edl) > APPLY_EDL_MAX_OUTPUT_MS) return undefined
  return edlTimelineRenderBudgetMs(edl, { output: "video", assumeSlots: speakerViewWorstCaseSlots(edl) })
}
