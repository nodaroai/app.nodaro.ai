/**
 * Under the picture row, before anything is paid: which seconds the change is
 * made on (a video model edits one shot of up to ten seconds, where the
 * playhead is), and, on a short video, the choice to change every shot from
 * there to the end. Read from the editor as the playhead moves.
 */
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { readTimelineView, type SecondsRange } from "@/ee/lib/freecut-ai/edit-plan"
import { PICTURE_MAX_SHOTS, pictureShotsNow, spanLabel } from "@/ee/lib/freecut-ai/run/picture"

const REFRESH_MS = 2000

/** The shots from the playhead on, up to one more than a request may change (so "to the end" is known to fit or not). */
function useShotsNow(link: () => EditorLink | null): readonly SecondsRange[] {
  const [shots, setShots] = useState<readonly SecondsRange[]>([])
  useEffect(() => {
    let live = true
    const read = async () => {
      try {
        const view = readTimelineView(await link()?.getTimeline())
        if (live && view) setShots(pictureShotsNow(view, PICTURE_MAX_SHOTS + 1))
      } catch {
        // The editor is closed or still opening.
      }
    }
    void read()
    const id = setInterval(() => void read(), REFRESH_MS)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [link])
  return shots
}

export interface PictureWhereProps {
  readonly link: () => EditorLink | null
  readonly shots: number
  readonly locked: boolean
  readonly onShots: (shots: number) => void
}

export function PictureWhere({ link, shots, locked, onShots }: PictureWhereProps) {
  const t = useT()
  const now = useShotsNow(link)
  const first = now[0]
  // "To the end" is offered when the rest of the video is few enough shots.
  const toEnd = now.length > 1 && now.length <= PICTURE_MAX_SHOTS ? now.length : 0
  const all = toEnd > 0 && shots > 1
  useEffect(() => {
    if (shots > 1 && toEnd === 0) onShots(1)
    else if (shots > 1 && shots !== toEnd) onShots(toEnd)
  }, [shots, toEnd, onShots])
  if (!first) return null
  const label = spanLabel(all ? { start: first.start, end: now[now.length - 1]!.end } : first)
  return (
    <div className="ms-9 flex flex-col gap-1.5">
      <p className="text-[11px] leading-snug text-white/70" role="status">
        {t(all ? "freecutAi.pictureWhereAll" : "freecutAi.pictureWhere", { ...label, n: toEnd })}
      </p>
      {toEnd > 0 ? (
        <div role="radiogroup" aria-label={t("freecutAi.pictureHowMuch")} className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5">
          {([1, toEnd] as const).map((option, i) => (
            <button
              key={i === 0 ? "one" : "all"}
              type="button"
              role="radio"
              aria-checked={(shots > 1) === (i === 1)}
              disabled={locked}
              onClick={() => onShots(option)}
              className={cn("min-h-9 flex-1 rounded-md px-2 text-[11px] font-medium transition-colors disabled:cursor-default", (shots > 1) === (i === 1) ? "bg-white/[0.14] text-white" : "text-white/60 hover:text-white")}
            >
              {i === 0 ? t("freecutAi.pictureOneShot") : t("freecutAi.pictureToEnd", { n: toEnd })}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
