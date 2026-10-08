"use client"

/**
 * Under the frame (U4): the scrubber in MASTER time (the camera plays at
 * master − offsetMs, SV9 a), "Jump to <speaker>" for each speaker on this
 * camera, Swap, Full, and — for a close-up with no box yet — Draw a box. And
 * the "Discard framing changes?" confirm (U4b), which stacks above the
 * inspector.
 */
import { Maximize, Repeat, SquareDashed } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { INSPECTOR_CHILD_DIALOG_Z } from "@/components/inspector/inspector-shell"
import { useT } from "@/lib/i18n"
import { formatMasterMs } from "./region-list"
import { jumpSeekMs, type Turn } from "./region-geometry"
import type { FramingCamera } from "./region-model"

interface RegionTransportProps {
  readonly camera: FramingCamera
  /** The playhead, master ms. */
  readonly timeMs: number
  readonly durationMs?: number
  readonly playable: boolean
  readonly turns: readonly Turn[]
  readonly onSeekMaster: (masterMs: number) => void
  readonly onSeekSource: (sourceMs: number) => void
  readonly canSwap: boolean
  readonly onSwap: () => void
  readonly onFull: () => void
  readonly hasBox: boolean
  readonly onDraw: () => void
}

export function RegionTransport(p: RegionTransportProps) {
  const t = useT()
  const offset = p.camera.offsetMs ?? 0
  const end = p.durationMs !== undefined ? p.durationMs + offset : undefined
  return (
    <div className="flex flex-col gap-2">
      {p.playable && end !== undefined && (
        <div className="flex items-center gap-2 text-[11px] tabular-nums" dir="ltr">
          <span>{formatMasterMs(Math.max(0, offset))}</span>
          <input
            type="range"
            aria-label={t("speakerView.framing.scrub")}
            className="flex-1 accent-primary"
            min={Math.max(0, offset)}
            max={end}
            step={100}
            value={Math.min(end, Math.max(offset, p.timeMs))}
            onChange={(e) => p.onSeekMaster(Number(e.target.value))}
          />
          <span>{formatMasterMs(end)}</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {p.camera.pairs.map((pair) => {
          const at = jumpSeekMs(p.turns, pair.speaker, { offsetMs: p.camera.offsetMs, durationMs: p.durationMs })
          return (
            <Button
              key={pair.speaker}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!p.playable || at === undefined}
              title={at === undefined ? t("speakerView.framing.jumpNone", { speaker: pair.speaker }) : undefined}
              onClick={() => at !== undefined && p.onSeekSource(at)}
            >
              {t("speakerView.framing.jump", { speaker: pair.speaker })}
            </Button>
          )
        })}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!p.canSwap} onClick={p.onSwap}>
          <Repeat className="w-3.5 h-3.5 me-1" />
          {t("speakerView.framing.swap")}
        </Button>
        {p.hasBox ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={p.onFull}>
            <Maximize className="w-3.5 h-3.5 me-1" />
            {t("speakerView.framing.fullButton")}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={p.onDraw}>
            <SquareDashed className="w-3.5 h-3.5 me-1" />
            {t("speakerView.framing.draw")}
          </Button>
        )}
      </div>
    </div>
  )
}

export function DiscardFramingDialog({ open, onKeep, onDiscard }: { readonly open: boolean; readonly onKeep: () => void; readonly onDiscard: () => void }) {
  const t = useT()
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onKeep() }}>
      <AlertDialogContent className={INSPECTOR_CHILD_DIALOG_Z} overlayClassName={INSPECTOR_CHILD_DIALOG_Z}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("speakerView.framing.discardTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("speakerView.framing.discardBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus onClick={onKeep}>{t("speakerView.framing.keepEditing")}</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>{t("speakerView.framing.discard")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
