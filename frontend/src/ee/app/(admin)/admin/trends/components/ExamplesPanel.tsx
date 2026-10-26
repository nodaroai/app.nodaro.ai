// The draft's examples: runs promoted with their own copies of the video and
// the pictures per slot. Example 1 is the cover; with none, the original's
// display copy is (a trend may publish with no example). Reorder (up / down)
// and remove; each write carries the draft's revision. Each example made
// below 1080p can be upscaled to it (`renderUpscale`, the UpscalePanel).

import { useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { AdminTrendExample, AdminTrendSlot } from "@/lib/api"

interface Props {
  readonly examples: AdminTrendExample[]
  readonly slots: AdminTrendSlot[]
  readonly busy: boolean
  /** `order` lists the current indexes in their new order. */
  readonly onReorder: (order: number[]) => void
  readonly onRemove: (index: number) => void
  /** What each example card shows to upscale its video (its index today). */
  readonly renderUpscale?: (example: AdminTrendExample, index: number) => ReactNode
  /** Shown under the list: the upscales whose example is gone. */
  readonly footer?: ReactNode
}

export function ExamplesPanel({ examples, slots, busy, onReorder, onRemove, renderUpscale, footer }: Props) {
  const [removing, setRemoving] = useState<number | null>(null)
  const labelOf = (key: string) => slots.find((s) => s.key === key)?.label.en || key

  const move = (i: number, by: -1 | 1) => {
    const j = i + by
    const order = examples.map((_, k) => k)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    onReorder(order)
  }

  if (examples.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground">
          No examples yet. Optional: with none, the trend shows only its original. To add one, run a full-length test below and choose "Use as example".
        </p>
        {footer}
      </>
    )
  }

  return (
    <>
      <ol className="flex flex-col gap-3">
        {examples.map((ex, i) => {
          const missing = slots.filter((s) => !(ex.slots[s.key]?.length ?? 0)).map((s) => s.key)
          return (
            <li key={`${ex.sourceJobId}-${i}`} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row">
              <video
                src={ex.videoUrl}
                poster={ex.posterUrl}
                controls
                playsInline
                preload="metadata"
                className="max-h-72 w-full shrink-0 rounded bg-black sm:w-40"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Example {i + 1}</span>
                  {i === 0 && <Badge variant="secondary">cover</Badge>}
                  <span className="text-muted-foreground">
                    {ex.width}×{ex.height} · {ex.durationSec.toFixed(1)} s
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(ex.slots).map(([key, urls]) => (
                    <div key={key} className="flex flex-col gap-1">
                      <span className="text-muted-foreground">{labelOf(key)}</span>
                      <div className="flex gap-1">
                        {urls.map((u, k) => (
                          <img key={u + k} src={u} alt={`${labelOf(key)} picture ${k + 1}`} className="h-10 w-10 rounded object-cover" />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {missing.length > 0 && (
                  <p className="text-destructive">No pictures for: {missing.join(", ")} (a new slot needs one in every example).</p>
                )}
                <p className="break-all text-muted-foreground">From run {ex.sourceJobId}</p>
                <div className="flex gap-1">
                  <Button type="button" variant="outline" size="sm" className="h-9 w-9 p-0" aria-label={`Move example ${i + 1} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0"
                    aria-label={`Move example ${i + 1} down`}
                    disabled={busy || i === examples.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-9 p-0 text-destructive"
                    aria-label={`Remove example ${i + 1}`}
                    disabled={busy}
                    onClick={() => setRemoving(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {renderUpscale?.(ex, i)}
              </div>
            </li>
          )
        })}
      </ol>
      {footer}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove example {removing !== null ? removing + 1 : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              It leaves the draft; users keep seeing it until the next publish. The run itself stays in the list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removing !== null) onRemove(removing)
                setRemoving(null)
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
