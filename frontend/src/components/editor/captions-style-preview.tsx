import { useMemo } from "react"
import { Player } from "@remotion/player"
import { AbsoluteFill } from "remotion"
import { CaptionOverlay, type CaptionStyle } from "@remotion-pkg/lib/caption-overlay"
import type { Caption } from "@remotion/captions"
import {
  type CaptionLookId,
  type CaptionLookLevers,
  type SupportedFontName,
} from "@nodaro/shared/captions"
import { resolveCaptionPanelLevers } from "./caption-panel-levers"

const PREVIEW_TEXT = "Lorem ipsum dolor sit amet consectetur adipiscing elit"

function buildSyntheticCaptions(): Caption[] {
  const words = PREVIEW_TEXT.split(/\s+/).filter(Boolean).map((w, i) => i === 0 ? w : ` ${w}`)
  const slice = 350 // ms per word
  return words.map((text, i): Caption => ({
    text,
    startMs: i * slice,
    endMs: (i + 1) * slice,
    timestampMs: i * slice,
    confidence: null,
  }))
}

interface PreviewProps extends Record<string, unknown> {
  style: CaptionStyle
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
  levers: CaptionLookLevers & { positionY?: number; animate?: boolean; maxWordsPerLine?: number }
  captions: Caption[]
}

const PreviewComp: React.FC<PreviewProps> = ({ style, position, fontSize, color, backgroundColor, levers, captions }) => (
  <AbsoluteFill style={{ background: "linear-gradient(135deg,#444,#222)" }}>
    <CaptionOverlay
      captions={captions}
      style={style}
      position={position}
      fontSize={fontSize}
      color={color}
      backgroundColor={backgroundColor}
      fontFamily={levers.fontFamily}
      fontWeight={levers.fontWeight}
      strokeColor={levers.strokeColor}
      strokeWidth={levers.strokeWidth}
      highlightColor={levers.highlightColor}
      uppercase={levers.uppercase}
      positionY={levers.positionY}
      // Per-word motion switch — freezes the kinetic animation; inert on subtitle.
      animate={levers.animate}
      // Line-grouping cap — applies to every line/page-grouped overlay; inert on
      // word-pop (always one word).
      maxWordsPerLine={levers.maxWordsPerLine}
    />
  </AbsoluteFill>
)

interface Props {
  style: CaptionStyle
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
  // Look preset + explicit lever overrides. The styling levers apply to every
  // style — a `subtitle` carrying one renders through the same SubtitleOverlay;
  // a bare subtitle (no look) stays plain. `highlightColor` + `animate` are inert
  // on subtitle. `animate: false` freezes the per-word motion on kinetic styles.
  look?: CaptionLookId
  fontFamily?: SupportedFontName
  fontWeight?: number
  strokeColor?: string
  strokeWidth?: number
  highlightColor?: string
  uppercase?: boolean
  positionY?: number
  animate?: boolean
  maxWordsPerLine?: number
}

export function CaptionsStylePreview({
  style, position, fontSize, color, backgroundColor,
  look, fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY, animate, maxWordsPerLine,
}: Props) {
  const captions = useMemo(buildSyntheticCaptions, [])
  // Resolve the look → concrete levers exactly as the worker does (via the shared
  // render-mirror), so the preview is faithful for both kinetic AND subtitle: a
  // bare subtitle shows plain, a subtitle with a look/levers shows them, and
  // `animate` freezes kinetic motion.
  const levers = useMemo<CaptionLookLevers & { positionY?: number; animate?: boolean; maxWordsPerLine?: number }>(() => {
    const explicit: CaptionLookLevers = {}
    if (fontFamily !== undefined) explicit.fontFamily = fontFamily
    if (fontWeight !== undefined) explicit.fontWeight = fontWeight
    if (strokeColor !== undefined) explicit.strokeColor = strokeColor
    if (strokeWidth !== undefined) explicit.strokeWidth = strokeWidth
    if (highlightColor !== undefined) explicit.highlightColor = highlightColor
    if (uppercase !== undefined) explicit.uppercase = uppercase
    return { ...resolveCaptionPanelLevers(style, look, explicit, fontSize), positionY, animate, maxWordsPerLine }
  }, [style, look, fontFamily, fontWeight, strokeColor, strokeWidth, highlightColor, uppercase, positionY, fontSize, animate, maxWordsPerLine])
  const inputProps = useMemo<PreviewProps>(
    () => ({ style, position, fontSize, color, backgroundColor, levers, captions }),
    [style, position, fontSize, color, backgroundColor, levers, captions],
  )
  const lastEndMs = captions[captions.length - 1]?.endMs ?? 1000
  const durationInFrames = Math.max(60, Math.ceil((lastEndMs / 1000) * 30))
  return (
    <div className="rounded-md overflow-hidden border border-[var(--border-primary)]" style={{ aspectRatio: "16/9" }}>
      <Player
        component={PreviewComp as React.ComponentType<Record<string, unknown>>}
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={30}
        style={{ width: "100%", height: "100%" }}
        controls
        loop
        autoPlay
        acknowledgeRemotionLicense
      />
    </div>
  )
}
