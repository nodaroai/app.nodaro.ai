/**
 * Captions: written along with the voice, a few words at a time, with the
 * spoken word lit up as it is said when the editor can draw that.
 *
 * They are laid in one edit, the way the editor's own "insert transcript as
 * captions" lays them (one caption block per clip): cut later, they are cut
 * with the speech and stay on their words. Asked for again, the new captions
 * take the place of the old ones.
 */
import { captionCues, isFillerWord, timelineFrameOf, type TimedWord, type TimelineView } from "../edit-plan"
import type { RunContext } from "./context"
import type { HeardVideo } from "./types"

/** The editor labels the caption blocks it makes for a transcript. */
export const CAPTIONS_LABEL = "Captions"
/** The color the spoken word lights up in. */
export const CAPTION_HIGHLIGHT = "#FFD400"

/** The shortest a lit word lasts: the editor refuses one that ends where it starts ("I", said fast). */
const MIN_WORD_SECONDS = 0.04

/** A caption's words for the word-by-word highlight, each lasting at least a moment. */
export const highlightWords = (words: readonly TimedWord[]) => words.map((w) => ({ text: w.text, start: w.start, end: Math.max(w.end, w.start + MIN_WORD_SECONDS) }))

export interface CaptionsOutcome {
  readonly captions: number
  readonly refused?: string
}

/**
 * The edits that lay the captions for a video (and take away the ones this
 * panel laid before): one block per clip, the spoken word lit when the editor
 * can draw it. Also what Wide | Phone sends to lay them again in a new frame.
 */
export function captionOps(timeline: TimelineView, mediaId: string, heard: HeardVideo, opts: { readonly fillersGone: boolean; readonly highlight: boolean }): { readonly ops: Array<Record<string, unknown>>; readonly cues: number; readonly replaced: boolean } {
  const spoken = opts.fillersGone ? heard.words.filter((w) => !isFillerWord(w, heard.language)) : heard.words
  const cues = captionCues(spoken)
  const earlier = timeline.items.filter((i) => i.type === "subtitle" && i.label === CAPTIONS_LABEL).map((i) => i.id)
  if (cues.length === 0) return { ops: [], cues: 0, replaced: false }
  return {
    cues: cues.length,
    replaced: earlier.length > 0,
    ops: [
      ...(earlier.length > 0 ? [{ op: "removeItems", ids: earlier }] : []),
      {
        op: "addTranscriptCaptions",
        mediaId,
        cues: cues.map((c) => ({ text: c.text, start: c.start, end: c.end, ...(opts.highlight && c.words ? { words: highlightWords(c.words) } : {}) })),
        ...(opts.highlight ? { highlight: { color: CAPTION_HIGHLIGHT } } : {}),
      },
    ],
  }
}

/**
 * The Captions agent's turn. `quiet` lays the captions again with no show and
 * no word on its card (another agent's step needed them laid again: a new
 * frame, a cut through captions made in parts), so the card keeps what it said.
 */
export async function runCaptions(ctx: RunContext, heard: HeardVideo, opts: { readonly fillersGone: boolean; readonly quiet?: boolean }): Promise<CaptionsOutcome> {
  const spoken = opts.fillersGone ? heard.words.filter((w) => !isFillerWord(w, heard.language)) : heard.words
  const cues = captionCues(spoken)
  if (cues.length === 0) return { captions: 0 }
  const highlight = ctx.has("captions-word-highlight")
  if (opts.quiet) {
    const again = await ctx.apply("captions", captionOps(ctx.timeline, ctx.mediaId, heard, { fillersGone: opts.fillersGone, highlight }).ops)
    return again.ok ? { captions: cues.length } : { captions: 0, refused: again.reason }
  }
  ctx.working("captions", true)
  ctx.step("captions", "working", "freecutAi.captioning", { done: 0, total: cues.length }, 0.05)

  // The Text tool, then the first caption typed where it will show.
  await ctx.show.click("captions", "rail.text", 380)
  const first = cues[0]!
  const at = timelineFrameOf(ctx.timeline, ctx.mediaId, first.start)
  if (at) ctx.link.playback("seek", at.frame)
  await ctx.show.drag("captions", { target: "rail.text" }, "preview", first.text.slice(0, 24), 800)
  await ctx.show.type("captions", { preview: { x: 0.5, y: 0.82 } }, first.text)

  const built = captionOps(ctx.timeline, ctx.mediaId, heard, { fillersGone: opts.fillersGone, highlight })
  const applied = await ctx.apply("captions", built.ops)
  if (!applied.ok) {
    ctx.working("captions", false)
    return { captions: 0, refused: applied.reason }
  }

  // The cursor runs along the captions as they land on their track.
  const blocks = ctx.timeline.items.filter((i) => i.type === "subtitle" && i.label === CAPTIONS_LABEL).sort((a, b) => a.from - b.from)
  const shown = Math.min(cues.length, 6)
  for (let i = 0; i < shown; i++) {
    const cue = cues[Math.floor((i * cues.length) / shown)]!
    const place = timelineFrameOf(ctx.timeline, ctx.mediaId, cue.start)
    const block = blocks.find((b) => place && b.from <= place.frame && place.frame < b.from + b.durationInFrames) ?? blocks[0]
    if (place && block) {
      ctx.show.mark("caption", { color: "#f2d64b", item: block.id })
      await ctx.show.move("captions", { frame: place.frame, trackId: block.trackId }, 260, cue.text)
    }
    ctx.step("captions", "working", "freecutAi.captioning", { done: Math.round(((i + 1) * cues.length) / shown), total: cues.length }, (i + 1) / shown)
  }
  ctx.show.unmark("caption")
  if (highlight) await ctx.show.click("captions", "panel.properties", 420, ctx.say("freecutAi.note.highlight"))
  ctx.feed("captions", built.replaced ? "freecutAi.captionsReplaced" : cues.length === 1 ? "freecutAi.captionsLaidOne" : "freecutAi.captionsLaid", { n: cues.length })
  ctx.working("captions", false)
  return { captions: cues.length }
}
