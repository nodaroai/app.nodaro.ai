"use client"

/**
 * CAMERAS (U4): each camera of the edit and, under it, the speakers it shows.
 * The time beside a speaker is master time — where "Jump to" lands. A camera
 * showing one speaker (a close-up) reads "full frame" until a box is drawn.
 */
import { ChevronDown, ChevronRight } from "lucide-react"
import { useT } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import type { FramingCamera } from "./region-model"

export interface RegionListRow {
  readonly key: string
  readonly speaker: string
  readonly color: string
  /** Master ms shown beside the name. */
  readonly atMs: number
  readonly hasBox: boolean
}

interface RegionListProps {
  readonly cameras: readonly FramingCamera[]
  readonly rowsOf: (camera: FramingCamera) => readonly RegionListRow[]
  readonly cameraId: string
  readonly selectedKey: string | null
  readonly onSelect: (cameraId: string, key: string) => void
  readonly quote?: { readonly text: string; readonly who: string }
}

export function formatMasterMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`
}

export function RegionList({ cameras, rowsOf, cameraId, selectedKey, onSelect, quote }: RegionListProps) {
  const t = useT()
  const flip = useAppDir() === "rtl" ? "-scale-x-100" : ""
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="region-list">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("speakerView.framing.cameras")}</span>
      <ul className="flex flex-col gap-1">
        {cameras.map((camera) => {
          const rows = rowsOf(camera)
          const open = camera.id === cameraId
          const boxed = rows.some((r) => r.hasBox)
          return (
            <li key={camera.id}>
              <button
                type="button"
                className={cn("flex w-full items-center gap-1 rounded px-1 py-0.5 text-start hover:bg-muted", open && "font-medium")}
                aria-expanded={open}
                onClick={() => rows[0] && onSelect(camera.id, rows[0].key)}
              >
                {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className={cn("w-3 h-3 shrink-0", flip)} />}
                <span className="truncate">{camera.id}</span>
                {!boxed && <span className="ms-auto text-[10px] text-muted-foreground">{t("speakerView.framing.fullFrame")}</span>}
              </button>
              {open && (
                <ul className="mt-0.5 flex flex-col gap-0.5 ps-4">
                  {rows.map((row) => (
                    <li key={row.key}>
                      <button
                        type="button"
                        aria-pressed={row.key === selectedKey}
                        className={cn("flex w-full items-center gap-2 rounded px-1 py-0.5 text-start hover:bg-muted", row.key === selectedKey && "bg-muted")}
                        onClick={() => onSelect(camera.id, row.key)}
                      >
                        <span className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
                        <span className="truncate">{row.speaker}</span>
                        <span className="ms-auto tabular-nums text-muted-foreground" dir="ltr">{formatMasterMs(row.atMs)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {quote && (
        <blockquote className="border-s-2 border-border ps-2 text-[11px] text-muted-foreground" data-testid="region-quote">
          <p className="italic">“{quote.text}”</p>
          <p className="mt-0.5">— {quote.who}</p>
        </blockquote>
      )}
    </div>
  )
}
