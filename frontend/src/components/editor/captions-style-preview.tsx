import { useMemo } from "react"
import { Player } from "@remotion/player"
import { AbsoluteFill } from "remotion"
import { CaptionOverlay, type CaptionStyle } from "@remotion-pkg/lib/caption-overlay"
import type { Caption } from "@remotion/captions"

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
  captions: Caption[]
}

const PreviewComp: React.FC<PreviewProps> = ({ style, position, fontSize, color, backgroundColor, captions }) => (
  <AbsoluteFill style={{ background: "linear-gradient(135deg,#444,#222)" }}>
    <CaptionOverlay
      captions={captions}
      style={style}
      position={position}
      fontSize={fontSize}
      color={color}
      backgroundColor={backgroundColor}
    />
  </AbsoluteFill>
)

interface Props {
  style: CaptionStyle
  position: "top" | "center" | "bottom"
  fontSize: number
  color: string
  backgroundColor?: string
}

export function CaptionsStylePreview({ style, position, fontSize, color, backgroundColor }: Props) {
  const captions = useMemo(buildSyntheticCaptions, [])
  const inputProps = useMemo<PreviewProps>(
    () => ({ style, position, fontSize, color, backgroundColor, captions }),
    [style, position, fontSize, color, backgroundColor, captions],
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
