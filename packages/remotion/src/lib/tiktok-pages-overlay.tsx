import React, { useMemo } from "react"
import { useCurrentFrame, useVideoConfig, spring } from "remotion"
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions"
import { trimEdgeDashTokens } from "@nodaro/shared/captions"
import type { OverlayCommonProps } from "./subtitle-overlay"
import { captionAnchor, captionLookStyle, captionWord } from "./caption-look"
import { activeHeldIndex, captionEnterFrame, splitCaptionRuns, type CaptionSpan } from "./caption-lines"
import { directionStyle, rowDirectionFromCaptions } from "./text-direction"

export interface TikTokPagesOverlayProps extends OverlayCommonProps {
  combineTokensWithinMilliseconds?: number
}

/** A page plus the window it is SPOKEN over — `page.durationMs` already stretches
 *  to the next page inside one `createTikTokStyleCaptions` call, which is exactly
 *  the bridging we must NOT inherit across a run boundary (that is the pause).
 *  `endMs` is the last token's end, and the hold past it is `activeHeldIndex`'s. */
interface TikTokPageSpan extends CaptionSpan {
  readonly page: TikTokPage
}

/**
 * Pages built run by run: the captions are split at sentence ends, pauses and the
 * word cap FIRST (`splitCaptionRuns`), then each run is paged on its own. Paging
 * the whole list in one call let a page swallow a full stop and a 700 ms pause,
 * and dropped the caption entirely between pages; a run can contain neither.
 */
const buildPageSpans = (
  captions: readonly Caption[],
  maxWords: number | undefined,
  combineTokensWithinMilliseconds: number,
): TikTokPageSpan[] =>
  splitCaptionRuns(captions, { maxWords }).flatMap((run) =>
    createTikTokStyleCaptions({
      // createTikTokStyleCaptions only starts a NEW PAGE at a token that begins
      // with a space (the @remotion/captions word delimiter). Caller-supplied
      // word-level captions[] arrive as BARE words, so without this every word of
      // a 25 s clip collapsed into ONE page. Canonicalise the delimiter per RUN —
      // the same normalisation the row overlays get from captionWord at render,
      // and the run's own first word must not carry one.
      captions: run.map((c, i) => ({ ...c, text: captionWord(c.text, i) })),
      combineTokensWithinMilliseconds,
    }).pages.flatMap((raw) => {
      const page = withoutEdgeDashes(raw)
      return page
        ? [{
          page,
          startMs: page.startMs,
          // Floored at the page's start, so one bad upstream `toMs` cannot put the
          // hold window in the past and blank the page.
          endMs: page.tokens.reduce((end, t) => Math.max(end, t.toMs), page.startMs),
        }]
        : []
    }),
  )

/**
 * A page never starts or ends on a lone dash token (`trimEdgeDashTokens`, the
 * rule every line overlay applies): the page is cut inside a run, so a run that
 * is clean at its own edges can still put a dash on a page's edge. The page is
 * its shown tokens; one of dashes alone is dropped (the page before it holds).
 */
function withoutEdgeDashes(page: TikTokPage): TikTokPage | null {
  const tokens = trimEdgeDashTokens(page.tokens, (t) => t.text)
  if (tokens.length === 0) return null
  if (tokens.length === page.tokens.length) return page
  const startMs = tokens[0]!.fromMs
  return {
    ...page,
    tokens,
    text: tokens.map((t, i) => captionWord(t.text, i)).join(""),
    startMs,
    durationMs: Math.max(0, page.startMs + page.durationMs - startMs),
  }
}

/** TikTok-style 1-4 word pages via @remotion/captions::createTikTokStyleCaptions,
 *  capped at `maxWordsPerLine` and never spanning a sentence end or a pause. A
 *  page is HELD until the next one starts (capped at CAPTION_LINE_MAX_HOLD_MS
 *  past its last token) so the caption does not blank between pages. */
export const TikTokPagesOverlay: React.FC<TikTokPagesOverlayProps> = ({
  captions, position, fontSize, color, backgroundColor,
  fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY, animate,
  maxWordsPerLine,
  combineTokensWithinMilliseconds = 1200,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const spans = useMemo(
    () => buildPageSpans(captions, maxWordsPerLine, combineTokensWithinMilliseconds),
    [captions, maxWordsPerLine, combineTokensWithinMilliseconds],
  )
  const index = activeHeldIndex(spans, ms)
  if (index < 0) return null
  const active = spans[index]!.page
  const pageFrame = captionEnterFrame(active.startMs, frame, fps)
  // animate:false drops the per-page enter-zoom (pages still switch). So does a
  // page whose startMs is not a usable number (spring throws on a NaN frame) —
  // the page is drawn at its final scale rather than failing the render.
  const enterScale = animate === false || pageFrame === null
    ? 1
    : spring({ frame: pageFrame, fps, config: { damping: 12, stiffness: 200 } })
  // With a highlightColor the page is rendered token by token and only the word
  // being spoken changes colour — the CapCut/TikTok read. Without one the page
  // stays a single pre-joined string, exactly as before.
  const spokenIdx = highlightColor
    ? active.tokens.reduce((hit, t, i) => (ms >= t.fromMs ? i : hit), -1)
    : -1
  const anchor = captionAnchor(position, positionY)
  return (
    <div style={{
      position: "absolute", left: "5%", right: "5%",
      ...(anchor.top !== undefined ? { top: anchor.top } : {}),
      ...(anchor.bottom !== undefined ? { bottom: anchor.bottom } : {}),
      transform: `${anchor.translate} scale(${0.9 + enterScale * 0.1})`.trim(),
      textAlign: "center", fontSize, color, fontWeight: 800, lineHeight: 1.1,
      whiteSpace: "pre",
      ...captionLookStyle({ fontFamily, fontWeight, strokeColor, strokeWidth, uppercase }),
      ...(backgroundColor ? { background: backgroundColor, padding: "0.3em 0.7em", borderRadius: "0.4em", display: "inline-block" } : {}),
      // The WHOLE caption list (not the active page) drives the row's base
      // direction, so word order follows the LANGUAGE of the piece — the same
      // rule karaoke, bouncy, word-highlight and subtitle use. Detecting per
      // PAGE flipped a Hebrew/Arabic page that happens to open with a Latin
      // token (a brand name — which per-run paging and maxWordsPerLine produce
      // more often) to ltr, and its inline-block tokens then read in reversed
      // order. The per-token directionStyle below still handles each token.
      direction: rowDirectionFromCaptions(captions),
    }}>
      {spokenIdx < 0 ? active.text : active.tokens.map((t, i) => (
        // The delimiter space sits OUTSIDE the word's box, as a text node of the row:
        // inside an inline-block that carries its own direction (a Hebrew word in a
        // Latin line, a brand name in a Hebrew one) the leading space lands on the
        // box's own start side — the wrong side in a mixed row, gluing the word to its
        // neighbour ("Nodaroזה"). In the row's bidi context a space between two atomic
        // boxes always falls between them, whichever way the row reads.
        <React.Fragment key={i}>
        {i > 0 ? " " : null}
        <span style={{
          display: "inline-block", whiteSpace: "pre",
          color: i === spokenIdx ? highlightColor : color,
          ...directionStyle(t.text),
        }}>
          {captionWord(t.text, 0)}
        </span>
        </React.Fragment>
      ))}
    </div>
  )
}
