/**
 * The template the sync writes, given the preview stop rule (decided
 * 2026-10-08: gate the podcast templates' Preview in code).
 *
 * A template authored with a render set to Preview (`quality: "proxy"`) is
 * written that way only where the rule (`PREVIEW_STOP_RULE_ENABLED`) is on.
 * Where it is off there is no stop at a preview, so the sync writes each such
 * render at Final, as the templates were before they rendered a Preview first,
 * with the listing of that Final graph. Turning the flag on (then a restart)
 * flips the row: the seeder fingerprints the doc this returns, so a change of
 * state reads as new content.
 *
 * Two wordings (decided 2026-10-08, round 3): the authored doc's description
 * and canvas notes say what a run does with the rule on (a Preview first, a
 * review, then Render final). `withoutPreviewStopRule` carries the rule-off
 * wording (renders at Final, no review step): its description, markdown
 * description and note texts (keyed by sticky-note id, with the height that
 * text needs and the note's y, so a rule-off template is its pre-Preview graph
 * byte for byte — decided 2026-10-08, round 4). This one gate picks the texts with the quality, so a template
 * never says "review the Preview" where no run stops at one.
 *
 * Which nodes flip is read off the template (`rendersAsPreview`: every render
 * node set to Preview), never a list of node ids. A doc opts in by carrying
 * `withoutPreviewStopRule`, the listing of its Final graph: the seeder is core
 * and cannot price a graph (the credit engine is EE), so the figure is
 * authored and a guard test pins it to the estimator for every built-in. A doc
 * without it (an operator pack that did not opt in) is written as authored;
 * one that carries the listing but no texts keeps its authored texts.
 *
 * Pure: never mutates the doc, and returns it as is when nothing changes.
 */
import { rendersAsPreview, type PreviewGateNode } from "@nodaro/shared"
import type { TutorialTemplateDoc } from "./types.js"

type GateNode = PreviewGateNode & { type?: unknown; data?: Record<string, unknown>; measured?: unknown }

const isNode = (n: unknown): n is GateNode =>
  typeof n === "object" && n !== null && typeof (n as { id?: unknown }).id === "string"

const isStickyNote = (n: unknown): n is GateNode => isNode(n) && n.type === "sticky-note"

/** Rule-off note ids that name no sticky note of the doc: a typo there would
 *  silently leave the rule-on text in place. Empty when every id resolves. */
export function unknownStopRuleNoteIds(doc: TutorialTemplateDoc): string[] {
  const stickies = new Set(doc.nodes.filter(isStickyNote).map((n) => n.id))
  return Object.keys(doc.withoutPreviewStopRule?.notes ?? {}).filter((id) => !stickies.has(id))
}

type RuleOffNote = { text: string; height?: number; y?: number }

/** A note with its rule-off text, and its height and y where the override
 *  names them (key order kept, so the result is the pre-Preview graph byte
 *  for byte). */
function withNote(n: GateNode, note: RuleOffNote): GateNode {
  const position = (n as { position?: unknown }).position
  const moved =
    note.y !== undefined && typeof position === "object" && position !== null
      ? { position: { ...(position as Record<string, unknown>), y: note.y } }
      : {}
  if (note.height === undefined) return { ...n, ...moved, data: { ...n.data, text: note.text } }
  const measured = n.measured
  return {
    ...n,
    ...moved,
    data: { ...n.data, text: note.text, height: note.height },
    ...(typeof measured === "object" && measured !== null
      ? { measured: { ...(measured as Record<string, unknown>), height: note.height } }
      : {}),
  }
}

export function templateForPreviewStopRule(doc: TutorialTemplateDoc, stopRuleOn: boolean): TutorialTemplateDoc {
  const finalGraph = doc.withoutPreviewStopRule
  if (stopRuleOn || !finalGraph) return doc
  if (!doc.nodes.some((n) => isNode(n) && rendersAsPreview(n))) return doc
  const notes = finalGraph.notes ?? {}
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (!isNode(n)) return n
      if (rendersAsPreview(n)) return { ...n, data: { ...n.data, quality: "final" } }
      const note = isStickyNote(n) ? notes[n.id] : undefined
      return note ? withNote(n, note) : n
    }),
    description: finalGraph.description ?? doc.description,
    markdownDescription:
      finalGraph.markdownDescription !== undefined ? finalGraph.markdownDescription : doc.markdownDescription,
    estimatedCredits: finalGraph.estimatedCredits,
    estimatedPerMinuteCredits: finalGraph.estimatedPerMinuteCredits,
  }
}
