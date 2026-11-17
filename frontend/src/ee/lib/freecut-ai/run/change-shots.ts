/**
 * Stretches of a speaker layout shown another way, sent to the editor: the
 * copies first (their ids are needed to place them), then the rest, every
 * request an undo entry under one label.
 */
import { planShotChange, type ShotChoice } from "../change-shot"
import { readTimelineView } from "../edit-plan"
import type { EditorLink } from "../editor-link"
import type { LayoutRow } from "../layout-rows"
import type { ShotFraming, ShotTrackSet } from "../shot-layout"
import type { SpeakerLayout } from "../speaker-layout"

/** The editor takes at most 500 edits in one request. */
const OPS_AT_ONCE = 480

export interface ShotChangeRequest {
  readonly label: string
  readonly rows: readonly LayoutRow[]
  readonly choice: ShotChoice
  readonly faces: { readonly set: ShotTrackSet; readonly layout: SpeakerLayout }
  /** What the timeline calls a clip framed this way. */
  readonly nameOf?: (framing: Pick<ShotFraming, "kind" | "slots">) => string
  /** One undo entry was made under the label. */
  readonly onRecorded: () => void
}

/** Applies the change; `ok: false` with the editor's own words when it refused. */
export async function applyShotChange(editor: EditorLink, request: ShotChangeRequest): Promise<{ readonly ok: boolean; readonly reason?: string }> {
  const apply = async (ops: ReadonlyArray<Record<string, unknown>>) => {
    const result = await editor.applyOps(request.label, ops)
    if (result.ok && result.recorded !== false) request.onRecorded()
    return result
  }
  for (const row of request.rows) {
    const timeline = readTimelineView(await editor.getTimeline())
    const plan = timeline ? planShotChange(timeline, row, request.choice, request.faces.set, request.faces.layout, request.nameOf) : null
    if (!plan) continue
    const copiesOf = new Map<string, string[]>()
    for (const ids of plan.copy) {
      const copied = await apply([{ op: "duplicateItems", ids }])
      if (!copied.ok) return { ok: false, reason: copied.error?.message }
      const made = copied.results?.find((r) => r && typeof r === "object" && Array.isArray((r as { copies?: unknown }).copies)) as { copies: Array<{ of: string; id: string }> } | undefined
      for (const copy of made?.copies ?? []) copiesOf.set(copy.of, [...(copiesOf.get(copy.of) ?? []), copy.id])
    }
    const ops = plan.place(copiesOf)
    for (let at = 0; at < ops.length; at += OPS_AT_ONCE) {
      const placed = await apply(ops.slice(at, at + OPS_AT_ONCE))
      if (!placed.ok) return { ok: false, reason: placed.error?.message }
    }
  }
  return { ok: true }
}
