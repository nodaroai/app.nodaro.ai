/**
 * Video-analysis window plan + ownership merge (pure logic).
 *
 * `computeWindowPlan` emits nominal window targets (k×STRIDE) — single window
 * for videos ≤ SINGLE_MAX, and no degenerate tail window (stop once the target
 * reaches durationSec − OVERLAP).
 *
 * `mergeWindowResults` folds per-window LLM analyses into one timeline:
 *   - ownership on ACTUAL boundaries — window k owns scenes whose absolute
 *     start ∈ [S_k, S_{k+1}); the LAST window owns through durationSec
 *     (inclusive). The overlap band belongs to the LATER window: it saw the
 *     boundary scene whole.
 *   - two symmetric boundary-duplicate guards: (a) drop a later window's
 *     start-clipped duplicate; (b) drop an earlier window's tail-truncated
 *     copy that the later window saw whole.
 *   - post-merge: clamp starts to the previous end, drop fully-swallowed
 *     scenes, renumber from 1.
 *   - slot unification: same source + case-insensitive trimmed label → one
 *     survivor (richest description wins); loser `{slot:old}` tokens are
 *     rewritten; id collisions across DIFFERENT subjects get `-2` suffixes;
 *     unresolved tokens then UNWRAP to literal text (warning per id);
 *     `slotRefs`/`oversized`/`visualResolved` are computed on final values.
 *   - zero-scene windows are valid; `language` is picked by speech-seconds.
 */
import { type WindowAnalysis, type EntitySlot, type AnalyzedScene, deriveSlotRefs, rewriteSlotTokens, unwrapUnresolvedTokens, renderAnalyzedScene, isOversizedScene, VIDEO_ANALYSIS_WINDOW } from "@nodaro/shared"

const HEAD_EPS = 1, TAIL_EPS = 1, COVER_FRACTION = 0.8
const { STRIDE, OVERLAP, SINGLE_MAX } = VIDEO_ANALYSIS_WINDOW

export function computeWindowPlan(durationSec: number): Array<{ k: number; targetStartSec: number }> {
  if (durationSec <= SINGLE_MAX) return [{ k: 0, targetStartSec: 0 }]
  const plan: Array<{ k: number; targetStartSec: number }> = []
  for (let k = 0, t = 0; t < durationSec - OVERLAP; k++, t = k * STRIDE) plan.push({ k, targetStartSec: t })
  return plan
}

interface WindowBounds { k: number; startSec: number; endSec: number }
export interface MergedScene extends AnalyzedScene {}
type Owned = { win: WindowBounds; abs: { startSec: number; endSec: number }; scene: WindowAnalysis["scenes"][number] }

export function mergeWindowResults(input: {
  durationSec: number
  windows: WindowBounds[]
  results: Record<number, WindowAnalysis>
}): { slots: EntitySlot[]; scenes: MergedScene[]; language?: string; warnings: string[] } {
  const warnings: string[] = []
  const wins = [...input.windows].sort((a, b) => a.k - b.k)

  // 1. slot unification: same source + normalized label; richest description wins.
  const survivors = new Map<string, EntitySlot>()          // unifyKey -> survivor
  const renamesPerWindow = new Map<number, Record<string, string>>()
  const usedIds = new Set<string>()
  for (const w of wins) {
    const res = input.results[w.k]; if (!res) continue
    const renames: Record<string, string> = {}
    for (const slot of res.slots) {
      const key = `${slot.source}::${slot.label.trim().toLowerCase()}`
      const existing = survivors.get(key)
      if (!existing) {
        let id = slot.slotId; let n = 2
        while (usedIds.has(id)) id = `${slot.slotId}-${n++}`   // id collision across DIFFERENT subjects
        usedIds.add(id)
        survivors.set(key, { ...slot, slotId: id })
        if (id !== slot.slotId) renames[slot.slotId] = id
      } else {
        if (slot.description.length > existing.description.length) existing.description = slot.description
        if (slot.slotId !== existing.slotId) renames[slot.slotId] = existing.slotId
      }
    }
    renamesPerWindow.set(w.k, renames)
  }
  const slots = [...survivors.values()]
  const validIds = new Set(slots.map((s) => s.slotId))

  // 2. ownership on ACTUAL boundaries: window k owns abs start ∈ [S_k, S_{k+1}); last → [S_last, durationSec]
  const owned: Owned[] = []
  wins.forEach((w, i) => {
    const res = input.results[w.k]; if (!res) return
    const lo = w.startSec
    const hi = i + 1 < wins.length ? wins[i + 1].startSec : input.durationSec + 0.001
    for (const scene of res.scenes) {
      const abs = { startSec: w.startSec + scene.startSec, endSec: Math.min(w.startSec + scene.endSec, input.durationSec) }
      if (abs.startSec >= lo && abs.startSec < hi) owned.push({ win: w, abs, scene })
    }
  })
  owned.sort((a, b) => a.abs.startSec - b.abs.startSec)

  // 3. boundary-duplicate guards (both directions)
  const covered = (inner: Owned, outer: Owned) => {
    const overlap = Math.min(inner.abs.endSec, outer.abs.endSec) - Math.max(inner.abs.startSec, outer.abs.startSec)
    return overlap / (inner.abs.endSec - inner.abs.startSec) >= COVER_FRACTION
  }
  const drop = new Set<Owned>()
  for (let i = 0; i < owned.length; i++) {
    const cur = owned[i]
    const prev = owned.slice(0, i).reverse().find((o) => o.win.k === cur.win.k - 1)
    // (a) later copy start-clipped at its window head, mostly inside prev's scene → drop later.
    //     Skip when prev itself was already dropped as a tail-truncated copy of cur (guard b ran
    //     at prev's earlier index): when both copies nearly coincide, BOTH guards would fire and
    //     the beat would vanish — the LATER window saw the boundary scene whole, so it survives.
    if (prev && !drop.has(prev) && cur.scene.startSec < HEAD_EPS && covered(cur, prev)) { drop.add(cur); continue }
    // (b) earlier copy truncated at its window tail, mostly inside next window's first scene → drop earlier
    const next = owned.slice(i + 1).find((o) => o.win.k === cur.win.k + 1)
    if (next && cur.win.endSec - cur.abs.endSec < TAIL_EPS && covered(cur, next)) drop.add(cur)
  }
  const kept = owned.filter((o) => !drop.has(o))

  // 4. clamp, renumber, compute derived fields
  const scenes: MergedScene[] = []
  let prevEnd = 0
  for (const o of kept) {
    const startSec = Math.max(o.abs.startSec, prevEnd)
    const endSec = o.abs.endSec
    if (endSec - startSec <= 0.05) continue                  // fully swallowed
    prevEnd = endSec
    const renames = renamesPerWindow.get(o.win.k) ?? {}
    let visual = rewriteSlotTokens(o.scene.visual, renames)
    const unwrapped = unwrapUnresolvedTokens(visual, validIds)
    visual = unwrapped.text
    for (const id of unwrapped.unresolved) warnings.push(`unresolved slot token unwrapped: ${id}`)
    scenes.push({
      ...o.scene, startSec, endSec, visual,
      sceneNumber: scenes.length + 1,
      slotRefs: deriveSlotRefs(visual),
      oversized: isOversizedScene(startSec, endSec) || undefined,
      visualResolved: renderAnalyzedScene({ visual }, slots),
    })
  }

  // 5. language by speech-seconds
  let language: string | undefined
  let best = -1
  for (const w of wins) {
    const res = input.results[w.k]; if (!res?.language) continue
    const speech = res.scenes.filter((s) => s.audio.mode === "speech").reduce((a, s) => a + (s.endSec - s.startSec), 0)
    if (speech > best) { best = speech; language = res.language }
  }
  return { slots, scenes, language, warnings }
}
