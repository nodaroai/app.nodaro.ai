// An optional slot's default pictures (Full depth only): what a run sends for
// the slot when the person leaves it empty. Without one the slot is sent with
// no pictures and stays as in the original (Full depth never borrows an
// example's pictures: an example can look nothing like the original).
//
// Three ways in, each stored in the trend's own storage:
//   - Upload: a local file or a pasted address, copied in (`/media` kind
//     `default`), as the hint picture is;
//   - Take from the original: a frame of the saved original, cropped to a box
//     (FrameCropDialog, `POST /v1/admin/trends/:id/frame-crop`);
//   - Upscale with Topaz (2x / 4x) on a picture already there: the platform's
//     own image upscale (`topaz-image-upscale`, the admin's own job, billed as
//     any upscale), followed until it ends, then copied in and put in that
//     picture's place. A factor whose result could pass the trend picture
//     cap (`trendPictureUpscaleFits`, judged on the picture's own size) is
//     not offered: the upscale is paid before its result is stored.
// Every change lands on the slot as it is then (another may have landed
// first). The pictures are saved with the draft.

import { useEffect, useRef, useState } from "react"
import { Crop, Loader2, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { trendPictureUpscaleFits, TREND_PICTURE_MAX_BYTES } from "@nodaro/render-rules"
import { Button } from "@/components/ui/button"
import { startAdminTrendImageUpscale } from "@/lib/api"
import { useTrendMedia, useTrendUpscaleJob } from "@/ee/hooks/queries/use-admin-queries"
import { MAX_IMAGES_PER_SLOT } from "../model"
import { FrameCropDialog, type CropOriginal } from "./FrameCropDialog"
import { MediaPicker } from "./MediaPicker"
import { uploadLocalFile } from "./uploads"

/** The Topaz factors offered. */
export const DEFAULT_IMAGE_UPSCALE_FACTORS = ["2", "4"] as const
type Factor = (typeof DEFAULT_IMAGE_UPSCALE_FACTORS)[number]

interface Props {
  readonly trendId: string
  /** The slot's number (1-based), for labels. */
  readonly n: number
  readonly images: readonly string[]
  /** A required slot cannot have any: only removing is offered (the save is refused until they are gone). */
  readonly required: boolean
  /** The saved original, for "Take from the original"; null while there is none. */
  readonly original: CropOriginal | null
  /** Why "Take from the original" waits (e.g. the source clip is not saved yet). */
  readonly originalWaitFor?: string
  /** Applied to the slot's pictures as they are when the change lands. */
  readonly onChange: (fn: (images: readonly string[]) => readonly string[]) => void
}

export function SlotDefaultImages({ trendId, n, images, required, original, originalWaitFor, onChange }: Props) {
  const media = useTrendMedia(trendId)
  const [uploading, setUploading] = useState(false)
  const [cropping, setCropping] = useState(false)
  const full = images.length >= MAX_IMAGES_PER_SLOT

  const add = (url: string) => onChange((imgs) => (imgs.includes(url) ? imgs : [...imgs, url].slice(0, MAX_IMAGES_PER_SLOT)))
  const store = async (from: string) => {
    try {
      add((await media.mutateAsync({ url: from, kind: "default" })).url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not store the picture")
    }
  }
  const fromFiles = async (files: File[]) => {
    setUploading(true)
    try {
      for (const file of files.slice(0, MAX_IMAGES_PER_SLOT - images.length)) await store(await uploadLocalFile(file))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
    }
  }
  const remove = (url: string) => onChange((imgs) => imgs.filter((u) => u !== url))
  const replace = (from: string, to: string) => onChange((imgs) => imgs.map((u) => (u === from ? to : u)))

  return (
    <div role="group" aria-label={`Slot ${n} default image`} className="flex flex-col gap-2 rounded-md border border-dashed p-2 text-sm">
      <span className="font-medium">
        Default image (Full depth) <span className="font-normal text-muted-foreground">(optional)</span>
      </span>
      {required ? (
        <span className="text-xs text-destructive">A required slot cannot have a default image: remove these, or make the slot optional.</span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Sent when a person leaves this slot empty. Without one, the slot stays as in the original (Full depth never uses an example's pictures).
        </span>
      )}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((url, i) => (
            <DefaultImageThumb
              key={url}
              trendId={trendId}
              n={n}
              index={i}
              url={url}
              canUpscale={!required}
              onRemove={() => remove(url)}
              onReplace={(next) => replace(url, next)}
            />
          ))}
        </div>
      )}
      {!required && !full && (
        <div className="flex flex-col gap-2">
          <MediaPicker
            accept="image/*"
            multiple
            uploadLabel="Upload default image"
            busy={uploading || media.isPending}
            onFiles={(files) => void fromFiles(files)}
            onUrl={(u) => void store(u)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9"
              disabled={!original || !!originalWaitFor}
              onClick={() => setCropping(true)}
            >
              <Crop className="mr-1 h-4 w-4" /> Take from the original
            </Button>
            {(originalWaitFor || !original) && (
              <span className="text-xs text-muted-foreground">{originalWaitFor ?? "Add a source clip and save the draft first."}</span>
            )}
          </div>
        </div>
      )}
      {original && (
        <FrameCropDialog
          open={cropping}
          onOpenChange={setCropping}
          trendId={trendId}
          original={original}
          slotName={`Slot ${n}`}
          onCropped={add}
        />
      )}
    </div>
  )
}

/** Why a factor is not offered: its result could pass the trend picture cap. */
export function tooLargeReason(size: { width: number; height: number }, factor: number): string {
  const w = size.width * factor
  const h = size.height * factor
  return `${factor}x would make a ${w}×${h} picture, which can pass the ${Math.round(TREND_PICTURE_MAX_BYTES / (1024 * 1024))} MB a trend picture may weigh. Use a smaller factor or a smaller crop.`
}

interface ThumbProps {
  readonly trendId: string
  readonly n: number
  readonly index: number
  readonly url: string
  readonly canUpscale: boolean
  readonly onRemove: () => void
  /** The upscaled picture, stored: it takes this one's place. */
  readonly onReplace: (url: string) => void
}

/** One default picture: shown, removable, and upscaled with Topaz in place. */
function DefaultImageThumb({ trendId, n, index, url, canUpscale, onRemove, onReplace }: ThumbProps) {
  const media = useTrendMedia(trendId)
  const [job, setJob] = useState<{ id: string; factor: Factor } | null>(null)
  const [starting, setStarting] = useState<Factor | null>(null)
  const [storing, setStoring] = useState(false)
  // The picture's own size, once it has loaded: what each factor's result is judged by.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const followed = useTrendUpscaleJob(job?.id ?? null)
  // The job whose end was acted on, so a re-render never stores (or reports) it twice.
  const handled = useRef<string | null>(null)
  const label = `Slot ${n} default image ${index + 1}`

  const start = async (factor: Factor) => {
    setStarting(factor)
    try {
      const { jobId } = await startAdminTrendImageUpscale(url, factor)
      setJob({ id: jobId, factor })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the upscale")
    } finally {
      setStarting(null)
    }
  }

  const status = followed.data?.status
  useEffect(() => {
    const j = followed.data
    if (!job || !j || j.id !== job.id || handled.current === job.id) return
    if (j.status === "completed") {
      handled.current = job.id
      const out = j.output_data?.imageUrl
      if (typeof out !== "string" || !out) {
        toast.error("The upscale finished without a picture.")
        setJob(null)
        return
      }
      setStoring(true)
      media
        .mutateAsync({ url: out, kind: "default" })
        .then((stored) => onReplace(stored.url))
        .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Could not store the upscaled picture"))
        .finally(() => {
          setStoring(false)
          setJob(null)
        })
    } else if (j.status === "failed" || j.status === "cancelled") {
      handled.current = job.id
      toast.error(j.error_message || "The upscale failed.")
      setJob(null)
    }
  }, [followed.data, job, media, onReplace])

  const running = !!job || storing
  const progress = typeof followed.data?.progress === "number" ? Math.round(followed.data.progress) : null
  return (
    <div className="flex w-24 flex-col gap-1" data-testid="slot-default-image">
      <div className="relative">
        <img
          src={url}
          alt={label}
          className="h-24 w-24 rounded object-cover"
          onLoad={(e) => {
            const { naturalWidth: width, naturalHeight: height } = e.currentTarget
            if (width > 0 && height > 0) setSize({ width, height })
          }}
        />
        {running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded bg-black/55 text-[11px] text-white" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            {storing ? "Storing…" : `Upscaling ${job!.factor}x${status === "processing" && progress !== null ? ` ${progress}%` : "…"}`}
          </div>
        )}
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          disabled={running}
          className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow disabled:opacity-50"
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {canUpscale && (
        <div className="flex gap-1">
          {DEFAULT_IMAGE_UPSCALE_FACTORS.map((f) => {
            const fits = trendPictureUpscaleFits(size?.width, size?.height, Number(f))
            const why = fits || !size ? undefined : tooLargeReason(size, Number(f))
            return (
              // A disabled button gets no hover: the reason sits on its wrapper.
              <span key={f} className="flex flex-1" title={why} data-testid={`upscale-${f}x-wrapper`}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1 px-1 text-xs"
                  aria-label={`Upscale ${label.toLowerCase()} ${f}x with Topaz`}
                  aria-description={why}
                  disabled={running || starting !== null || !fits}
                  onClick={() => void start(f)}
                >
                  {starting === f ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="mr-0.5 h-3 w-3" />}
                  {f}x
                </Button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
