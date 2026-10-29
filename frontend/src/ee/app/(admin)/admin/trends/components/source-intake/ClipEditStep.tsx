// The new source clip before it is stored: its range (the shared range strip,
// 4–30 s held while dragging; a longer clip opens on its first 30 s) and its
// shape (Original, 9:16, 16:9, 1:1, 4:3, 3:4), the crop box over the playing
// video once a shape is chosen. "Use this clip" hands the edit to the intake,
// which cuts (when anything changed) and stores. A clip the browser cannot
// play can still be stored as it is: the server checks its length.

import { useMemo, useState } from "react"
import { Check, Loader2, X } from "lucide-react"
import type { MediaEditorParts, RatioId, Size } from "virtual:media-editor"
import { Button } from "@/components/ui/button"
import { SOURCE_RATIOS, SOURCE_SECONDS, cropFor, evenCrop, initialEdit, isNoEdit, isSourceRatio, rangeFits, tenth, type SourceEdit } from "./edit"

/** What the intake is doing with the confirmed clip. */
export type IntakeWork = "cutting" | "storing" | null

/** The admin's choice: the clip's length and its edit, or `null` to store it as it is (the browser could not read it). */
export type EditChoice = { readonly sec: number; readonly edit: SourceEdit } | null

interface Props {
  readonly parts: MediaEditorParts
  readonly url: string
  /** What the clip is (a file name, a video's title, an address). */
  readonly label: string
  readonly work: IntakeWork
  readonly onConfirm: (choice: EditChoice) => void
  readonly onCancel: () => void
}

export function ClipEditStep({ parts, url, label, work, onConfirm, onCancel }: Props) {
  const { TrimPanel, CropPanel, RatioPicker, htmlMediaAdapter, fullRect } = parts
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [sec, setSec] = useState<number | null>(null)
  const [edit, setEdit] = useState<SourceEdit | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const player = useMemo(() => (video ? htmlMediaAdapter(video) : null), [video, htmlMediaAdapter])
  const busy = work !== null

  const tooShort = sec !== null && sec < SOURCE_SECONDS.min - 0.05
  const long = sec !== null && sec > SOURCE_SECONDS.max
  const ready = sec !== null && edit !== null && !tooShort && rangeFits(edit)
  const changed = sec !== null && edit !== null && (!isNoEdit(edit, sec) || sec > SOURCE_SECONDS.max)

  const chooseRatio = (id: RatioId) => {
    if (!edit || !natural || !isSourceRatio(id)) return
    setEdit({ ...edit, ratio: id, crop: cropFor(id, natural, fullRect) })
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" role="group" aria-label="New source clip">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">New source clip</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={label}>
          {label}
        </span>
      </div>

      {unreadable ? (
        <p role="alert" className="text-xs text-muted-foreground">
          This clip cannot be played in this browser, so its range and shape cannot be picked here. Store it as it is (it must be 4–30 s), or cancel and use
          another file.
        </p>
      ) : (
        <div className="relative w-full overflow-hidden rounded-md bg-black">
          <video
            ref={setVideo}
            src={url}
            muted
            playsInline
            preload="metadata"
            aria-label="The new source clip"
            className="block max-h-80 w-full object-contain"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget
              if (el.videoWidth > 0 && el.videoHeight > 0) setNatural({ width: el.videoWidth, height: el.videoHeight })
              if (Number.isFinite(el.duration) && el.duration > 0) {
                setSec(el.duration)
                setEdit((prev) => prev ?? initialEdit(el.duration))
              }
            }}
            onError={() => setUnreadable(true)}
          />
          {video && natural && edit && edit.ratio !== "original" && (
            <CropPanel
              source={{ kind: "video", element: video }}
              natural={natural}
              ratio={edit.ratio}
              rect={edit.crop ?? fullRect(natural, edit.ratio)}
              onRectChange={(rect) => setEdit({ ...edit, crop: evenCrop(rect, natural) })}
            />
          )}
        </div>
      )}

      {!unreadable && player && edit && sec !== null && !tooShort && (
        <>
          <TrimPanel
            player={player}
            range={{ start: edit.startSec, end: edit.endSec }}
            onRangeChange={(range) => setEdit({ ...edit, startSec: tenth(range.start), endSec: tenth(range.end) })}
            minSec={SOURCE_SECONDS.min}
            maxSec={SOURCE_SECONDS.max}
          />
          <p className="text-xs tabular-nums text-muted-foreground">
            {(edit.endSec - edit.startSec).toFixed(1)} s of {sec.toFixed(1)} s
          </p>
        </>
      )}

      {!unreadable && edit && !tooShort && (
        <div className="flex flex-col gap-1.5" role="group" aria-label="Shape">
          <span className="text-xs font-medium text-muted-foreground" aria-hidden>
            Shape
          </span>
          <RatioPicker ratios={SOURCE_RATIOS} value={edit.ratio} onChange={chooseRatio} wrap disabled={!natural || busy} />
        </div>
      )}

      {tooShort && sec !== null && (
        <p role="alert" className="text-xs text-destructive">
          This clip is {sec.toFixed(1)} s. A source clip must be at least {SOURCE_SECONDS.min} s: use a longer one.
        </p>
      )}
      {long && !tooShort && (
        <p className="text-xs text-muted-foreground">
          The clip is longer than {SOURCE_SECONDS.max} s: pick the part to use (it opens on the first {SOURCE_SECONDS.max} s).
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          disabled={busy || (!unreadable && !ready)}
          onClick={() => onConfirm(unreadable || sec === null || edit === null ? null : { sec, edit })}
        >
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
          {work === "cutting" ? "Cutting…" : work === "storing" ? "Storing…" : unreadable ? "Store it as it is" : changed ? "Cut and use this clip" : "Use this clip"}
        </Button>
      </div>
    </div>
  )
}
