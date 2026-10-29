// The trend's source clip (4–30 s) and where its 4 s preview starts: scrub the
// clip, mark the window, play it back. Runs edit the uploaded clip; users see
// its display copy (a browser-safe MP4 and poster the platform makes when the
// clip is stored), shown on the trend's page beside the examples.
//
// A new clip comes in by Upload or a library video's address; on a build with
// the shared media editor also by a link (YouTube, TikTok, Instagram, X,
// Facebook), and every new clip then shows its range (4–30 s) and shape before
// it is stored (`source-intake/`). Without the editor this is the editor it
// always was: the clip is stored as it comes.
//
// The preview's INPUT clip (the window cut from the source, made by the server
// when the draft is saved) is shown under the window: its length, frames and
// hash, when it was made, and a Play of the stored file itself. The slider
// stays the advanced override of where the window starts (0 by default).

import { useEffect, useRef, useState } from "react"
import { Crosshair, Play } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { formatRelative } from "@/lib/i18n"
import type { AdminTrendPreviewClip, AdminTrendSource } from "@/lib/api"
import { useTrendMedia } from "@/ee/hooks/queries/use-admin-queries"
import { PREVIEW_SECONDS, clampPreview, formatSeconds, previewClipStatus } from "../model"
import { MediaPicker } from "./MediaPicker"
import { uploadLocalFile } from "./uploads"
import { mediaEditorParts } from "./source-intake/parts"
import { SourceIntake } from "./source-intake/SourceIntake"

/** The shared media editor's parts, when this build has them (read once: a build decides it). */
const EDITOR = mediaEditorParts()

interface Props {
  readonly trendId: string
  readonly source: AdminTrendSource | null
  readonly previewStart: number | null
  /** The 4 s preview's input clip as the server last read it (made on save; never edited here). */
  readonly previewClip?: AdminTrendPreviewClip
  readonly onChange: (next: { source: AdminTrendSource | null; previewStart: number | null }) => void
}

export function SourceClipEditor({ trendId, source, previewStart, previewClip, onChange }: Props) {
  const media = useTrendMedia(trendId)
  const [uploading, setUploading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopAt = useRef<number | null>(null)

  const busy = uploading || media.isPending
  const duration = source?.durationSec ?? 0
  const maxStart = Math.max(0, duration - PREVIEW_SECONDS)
  const clipStatus = previewClipStatus({ source, previewStart, previewClip })

  /** Stores `url` as the trend's source; true once it is (a failure is toasted here). */
  const store = async (url: string): Promise<boolean> => {
    try {
      const stored = await media.mutateAsync({ url, kind: "source" })
      if (stored.durationSec === undefined) throw new Error("The clip's length could not be read.")
      const next: AdminTrendSource = {
        videoUrl: stored.url,
        durationSec: stored.durationSec,
        ...(stored.width !== undefined ? { width: stored.width } : {}),
        ...(stored.height !== undefined ? { height: stored.height } : {}),
        ...(stored.sha256 !== undefined ? { sha256: stored.sha256 } : {}),
        // A new clip never keeps the old clip's copy: only the one made for it.
        ...(stored.display ? { display: stored.display } : {}),
      }
      onChange({ source: next, previewStart: clampPreview(previewStart, next.durationSec) })
      toast.success(`Source clip set (${formatSeconds(next.durationSec)}). Save the draft to keep it.`)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not store the clip")
      return false
    }
  }

  const fromFile = async (file: File) => {
    setUploading(true)
    try {
      await store(await uploadLocalFile(file))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }

  // Down to a tenth: rounding up could push the window past the clip's end (7.86 s clip → 3.9).
  const setStart = (s: number) => onChange({ source, previewStart: Math.floor(Math.min(Math.max(0, s), maxStart) * 10) / 10 })

  const playWindow = () => {
    const v = videoRef.current
    if (!v || previewStart === null) return
    v.currentTime = previewStart
    stopAt.current = previewStart + PREVIEW_SECONDS
    void v.play().catch(() => {})
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onTime = () => {
      if (stopAt.current !== null && v.currentTime >= stopAt.current) {
        v.pause()
        stopAt.current = null
      }
    }
    v.addEventListener("timeupdate", onTime)
    return () => v.removeEventListener("timeupdate", onTime)
  }, [source?.videoUrl])

  return (
    <div className="flex flex-col gap-3">
      {source ? (
        <>
          <div className="flex flex-col gap-3 sm:flex-row">
            <video
              ref={videoRef}
              key={source.videoUrl}
              src={source.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="max-h-80 w-full rounded-md bg-black sm:w-auto sm:max-w-[50%]"
            />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Length</dt>
              <dd>{formatSeconds(source.durationSec)}</dd>
              {source.width && source.height ? (
                <>
                  <dt className="text-muted-foreground">Size</dt>
                  <dd>
                    {source.width}×{source.height}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">File</dt>
              <dd className="min-w-0 break-all">
                <a href={source.videoUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  open
                </a>
              </dd>
            </dl>
          </div>

          {source.display ? (
            <div className="flex items-start gap-3 rounded-md border p-3">
              <img
                src={source.display.posterUrl}
                alt="The original as users see it"
                className="h-24 w-auto max-w-[40%] shrink-0 rounded object-contain bg-black"
              />
              <div className="flex min-w-0 flex-col gap-1 text-xs">
                <span className="font-medium text-sm">Display copy</span>
                <span className="text-muted-foreground">
                  This copy is what users see on the trend's page ({source.display.width}×{source.display.height},{" "}
                  {formatSeconds(source.display.durationSec)}). Runs use the uploaded clip.
                </span>
                <a href={source.display.videoUrl} target="_blank" rel="noopener noreferrer" className="self-start underline">
                  open the copy
                </a>
              </div>
            </div>
          ) : (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
              No display copy yet (the copy users see). Upload the clip again to make one: the trend cannot be published without it.
            </p>
          )}

          <div className="flex flex-col gap-2 rounded-md border p-3">
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <Switch
                aria-label="Offer a 4 s preview"
                checked={previewStart !== null}
                onCheckedChange={(on) => onChange({ source, previewStart: on ? 0 : null })}
              />
              Offer a {PREVIEW_SECONDS} s preview
            </label>
            {previewStart !== null && (
              <>
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className="absolute inset-y-0 rounded-full bg-primary/70"
                    style={{
                      left: `${duration ? (previewStart / duration) * 100 : 0}%`,
                      width: `${duration ? Math.min(100, (PREVIEW_SECONDS / duration) * 100) : 0}%`,
                    }}
                  />
                </div>
                <input
                  type="range"
                  aria-label="Preview start"
                  min={0}
                  max={maxStart}
                  step={0.1}
                  value={previewStart}
                  onChange={(e) => setStart(Number(e.target.value))}
                  className="h-9 w-full"
                />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="tabular-nums">
                    Preview: {formatSeconds(previewStart)} – {formatSeconds(previewStart + PREVIEW_SECONDS)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-9"
                    onClick={() => setStart(videoRef.current?.currentTime ?? 0)}
                  >
                    <Crosshair className="mr-1 h-4 w-4" /> Start at the playhead
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={playWindow}>
                    <Play className="mr-1 h-4 w-4" /> Play the window
                  </Button>
                </div>
                {clipStatus === "current" && previewClip ? (
                  <PreviewInputRow clip={previewClip} />
                ) : (
                  <p className="text-xs text-muted-foreground" data-preview-input={clipStatus}>
                    <span className="font-medium text-foreground">Preview input:</span>{" "}
                    {clipStatus === "stale"
                      ? "the prepared clip was cut from another source clip or start. Prepared again on save: every preview run then edits that file."
                      : "prepared on save. The preview window is cut from the source into its own file, and every preview run edits that file."}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {EDITOR
            ? "No source clip yet. Upload one, paste a library video's URL or a video's link, then pick its 4–30 s and its shape."
            : "No source clip yet. Upload one (4–30 s) or paste a library video's URL."}
        </p>
      )}
      {EDITOR ? (
        <SourceIntake parts={EDITOR} hasSource={source !== null} busy={busy} store={store} />
      ) : (
        <MediaPicker
          accept="video/*"
          uploadLabel={source ? "Replace clip" : "Upload clip"}
          busy={busy}
          onFiles={(files) => void fromFile(files[0]!)}
          onUrl={(url) => void store(url)}
        />
      )}
    </div>
  )
}

/**
 * The stored preview input clip, current for this source and start: what a
 * preview run edits. Play plays the stored file itself (not the source
 * seeked to the window), so what is heard and seen is what the engine gets.
 */
function PreviewInputRow({ clip }: { readonly clip: AdminTrendPreviewClip }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const play = () => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    void v.play()?.catch(() => {})
  }
  return (
    <div className="flex flex-col gap-2 border-t pt-2 text-xs" data-preview-input="current">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-sm">Preview input</span>
        <span className="tabular-nums">{formatSeconds(clip.durationSec)}</span>
        <span className="tabular-nums">{clip.frames} frames</span>
        <span className="tabular-nums">
          {clip.width}×{clip.height}
        </span>
        <code title={clip.sha256} className="rounded bg-muted px-1">
          {clip.sha256.slice(0, 12)}
        </code>
        <span className="text-muted-foreground" title={new Date(clip.madeAt).toLocaleString()}>
          made {formatRelative(clip.madeAt)}
        </span>
        {clip.faceMask && <span className="text-muted-foreground">with its face mask ({clip.faceMask.frames} frames)</span>}
        <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={play}>
          <Play className="mr-1 h-4 w-4" /> Play the prepared clip
        </Button>
        <a href={clip.videoUrl} target="_blank" rel="noopener noreferrer" className="underline">
          open
        </a>
      </div>
      <span className="text-muted-foreground">
        Cut from the source at the preview start when the draft was saved: every preview run edits this file as it is.
      </span>
      <video
        ref={videoRef}
        key={clip.videoUrl}
        src={clip.videoUrl}
        controls
        playsInline
        preload="none"
        aria-label="Prepared preview clip"
        className="max-h-48 w-full rounded-md bg-black sm:w-auto sm:max-w-[50%]"
      />
    </div>
  )
}
