"use client"

/**
 * The faces on the frame on screen (P3.9, U4): who Speaker Frames' track is,
 * and "assign to speaker". Each face picks one of the edit's speakers,
 * Nobody, or As detected (no correction); the choice is staged and written on
 * Save as `trackAssignments` on the upstream Speaker Frames node.
 */
import { useT, type MessageKey } from "@/lib/i18n"
import type { TrackEdit, TrackedFace } from "./use-region-tracks"

/** Why the track file could not be loaded, in the interface language. */
const FAILURE_KEYS: Readonly<Record<string, MessageKey>> = {
  fetch: "speakerView.framing.tracksFailedFetch",
  mismatch: "speakerView.framing.tracksFailedMismatch",
  unreadable: "speakerView.framing.tracksFailedUnreadable",
}

const NOBODY = "__nobody__"
const DETECTED = ""

interface RegionFacesProps {
  readonly faces: readonly TrackedFace[]
  readonly speakers: readonly string[]
  readonly loading: boolean
  /** Why the track file could not be loaded (`SpeakerTrackBodyFailure`, or "other"). */
  readonly error?: string
  readonly readOnly?: boolean
  readonly assignmentOf: (trackId: string) => TrackEdit
  readonly onAssign: (trackId: string, value: TrackEdit) => void
}

export function RegionFaces({ faces, speakers, loading, error, readOnly, assignmentOf, onAssign }: RegionFacesProps) {
  const t = useT()
  return (
    <section className="flex flex-col gap-1 text-xs" data-testid="region-faces" aria-label={t("speakerFrames.tracksOut")}>
      <p className="text-[11px] text-muted-foreground">{t("speakerView.framing.tracksHint")}</p>
      {loading && <p role="status" className="text-[11px] text-muted-foreground">{t("speakerView.framing.tracksLoading")}</p>}
      {error && <p role="status" className="text-[11px] text-amber-700 dark:text-amber-400">{t(FAILURE_KEYS[error] ?? "speakerView.framing.tracksFailed")}</p>}
      {faces.map((face) => {
        const value = assignmentOf(face.trackId)
        const selected = value === null ? NOBODY : value === undefined ? DETECTED : value
        return (
          <label key={face.trackId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate tabular-nums" dir="ltr">{face.trackId}</span>
            <select
              aria-label={t("speakerView.framing.assignTitle", { track: face.trackId })}
              data-testid={`region-face-assign-${face.trackId}`}
              data-face-assign={face.trackId}
              disabled={readOnly}
              className="h-7 rounded-md border border-border bg-background px-1 text-xs"
              value={selected}
              onChange={(e) => onAssign(face.trackId, e.target.value === DETECTED ? undefined : e.target.value === NOBODY ? null : e.target.value)}
            >
              <option value={DETECTED}>{t("speakerView.framing.assignDetected")}</option>
              {speakers.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value={NOBODY}>{t("speakerView.framing.assignNobody")}</option>
            </select>
          </label>
        )
      })}
    </section>
  )
}
