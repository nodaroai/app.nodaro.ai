// A YouTube video, its part picked before anything downloads: the video plays
// in its embed, the shared range strip on its player (4–30 s, held while
// dragging), and "Download this part" fetches only that part, cut exactly.
// An embed that cannot play (its owner switched embedding off, a blocked
// frame) offers the whole video instead when it is short enough to fetch whole.

import { useEffect, useRef, useState } from "react"
import { Download, X } from "lucide-react"
import type { MediaEditorParts, TrimRange } from "virtual:media-editor"
import { Button } from "@/components/ui/button"
import { SOURCE_SECONDS, tenth } from "./edit"
import { WHOLE_DOWNLOAD_MAX_SEC, type LinkSection } from "./link"
import { useYouTubePlayer } from "./youtube-player"

interface Props {
  readonly parts: MediaEditorParts
  readonly youtubeId: string
  /** The video's length as the platform read it, when it could. */
  readonly durationSec: number | null
  /** Downloads `section`, or the whole video with none. */
  readonly onDownload: (section?: LinkSection) => void
  readonly onCancel: () => void
}

export function YouTubeRange({ parts, youtubeId, durationSec, onDownload, onCancel }: Props) {
  const { TrimPanel, defaultRange } = parts
  // The iframe API replaces this element with its iframe: one React renders nothing into.
  const holder = useRef<HTMLDivElement>(null)
  const { status, player } = useYouTubePlayer(youtubeId, holder)
  const [range, setRange] = useState<TrimRange | null>(null)

  // The range opens on the whole video, or its first 30 s, once the player knows its length.
  useEffect(() => {
    if (status !== "ready" || range !== null) return
    const length = player.duration() || durationSec || 0
    if (length > 0) setRange(defaultRange(length, SOURCE_SECONDS.max))
  }, [status, player, durationSec, range, defaultRange])

  if (status === "error") {
    const whole = durationSec !== null && durationSec <= WHOLE_DOWNLOAD_MAX_SEC
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="min-w-0 flex-[1_1_220px] text-xs text-destructive">
          {whole
            ? "This video cannot be played here. Download it whole, then pick the part."
            : "This video cannot be played here and is too long to download whole. Use another link."}
        </p>
        {whole && (
          <Button type="button" size="sm" className="min-h-11" onClick={() => onDownload()}>
            <Download className="mr-1 h-4 w-4" /> Download the whole video
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> Cancel
        </Button>
      </div>
    )
  }

  const length = range ? range.end - range.start : 0
  return (
    <div className="flex flex-col gap-3" role="group" aria-label="Pick the part to download">
      <p className="text-xs text-muted-foreground">Pick the part to use (4–30 s). Only that part is downloaded.</p>
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black sm:max-w-xl">
        <div className="absolute inset-0">
          <div ref={holder} />
        </div>
        {status === "loading" && (
          <span role="status" className="absolute inset-0 grid place-items-center text-xs text-white/70">
            Loading the video…
          </span>
        )}
      </div>
      {range && (
        <>
          <TrimPanel player={player} range={range} onRangeChange={setRange} minSec={SOURCE_SECONDS.min} maxSec={SOURCE_SECONDS.max} />
          <p className="text-xs tabular-nums text-muted-foreground">{length.toFixed(1)} s</p>
        </>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          disabled={range === null}
          onClick={() => range && onDownload({ startSec: tenth(range.start), endSec: tenth(range.end) })}
        >
          <Download className="mr-1 h-4 w-4" /> Download this part
        </Button>
      </div>
    </div>
  )
}
