import { ScanFace } from "lucide-react"
import { SPEAKER_VIEW_TRACKED_DEFAULT_MOTION, validSpeakerMotions, type SpeakerViewTracksResolved } from "@nodaro/render-rules"
import type { SpeakerTrackSetDescriptor } from "@nodaro/shared/edl"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { addFaceTrackingOnCanvas } from "@/hooks/use-add-face-tracking"
import { useT, type MessageKey } from "@/lib/i18n"
import { SpeakerOptionTile } from "@/lib/picker-ui"
import { speakerViewPickerOptions, speakerViewReasonText } from "./speaker-view-reasons"

const MOTION_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  static: "speakerView.motion.static",
  glide: "speakerView.motion.glide",
}

interface TrackingSectionProps {
  readonly nodeId?: string
  /** Whether anything is wired into `tracks`. */
  readonly wired: boolean
  /** The wired tracks at rest; undefined while Speaker Frames has not run. */
  readonly tracks?: SpeakerViewTracksResolved
  readonly motion: unknown
  readonly readOnly?: boolean
  readonly onUpdate: (patch: Record<string, unknown>) => void
}

/** How many tracks, on how many cameras, and how many carry a speaker. */
function trackCounts(tracks: SpeakerViewTracksResolved | undefined): { tracks: number; cameras: number; labelled: number } | undefined {
  const d = tracks?.tracks as SpeakerTrackSetDescriptor | undefined
  if (!d || !Array.isArray(d.sources)) return undefined
  const all = d.sources.flatMap((s) => s.tracks ?? [])
  return { tracks: all.length, cameras: d.sources.length, labelled: all.filter((t) => !!t.speaker).length }
}

/**
 * FACE TRACKING (P3.9): the tracks wired in and how tracked slots move
 * (P3-10). Glide is greyed, with its reason, until Speaker Frames is wired;
 * without tracks Static is v1 framing exactly. With nothing wired, "Add face
 * tracking" inserts and wires Speaker Frames (P3-17 (c)).
 */
export function SpeakerViewTrackingSection({ nodeId, wired, tracks, motion, readOnly, onUpdate }: TrackingSectionProps) {
  const t = useT()
  const options = validSpeakerMotions(wired)
  // What a run sends: the stored choice, else glide while tracks are wired.
  const value = motion === "static" || motion === "glide" ? motion : wired ? SPEAKER_VIEW_TRACKED_DEFAULT_MOTION : "static"
  const counts = trackCounts(tracks)
  const reasons = options.flatMap((o) => (o.reason ? [speakerViewReasonText(o.reason, t)] : []))
  return (
    <section className="flex flex-col gap-1.5" data-testid="speaker-view-tracking">
      <Label>{t("speakerView.section.tracking")}</Label>
      <p className="text-[11px] text-muted-foreground" data-testid="speaker-view-tracks-state">
        {!wired
          ? t("speakerView.tracks.none")
          : counts
            ? t("speakerView.tracks.summary", { tracks: counts.tracks, cameras: counts.cameras, labelled: counts.labelled })
            : t("speakerView.tracks.notRun")}
      </p>
      {/* The shared tile (as Layout, Switch and Emphasis): a ruled-out Glide
          stays focusable and reads its reason aloud, never a dead grey box. */}
      <div role="radiogroup" aria-label={t("speakerView.field.motion")} className="grid grid-cols-4 gap-1">
        {speakerViewPickerOptions(options, MOTION_LABEL_KEYS, t).map((o) => (
          <SpeakerOptionTile
            key={o.id}
            role="radio"
            label={o.label}
            checked={o.id === value}
            disabled={o.disabled}
            reason={o.reason}
            data-testid={`speaker-view-motion-${o.id}`}
            onSelect={() => { if (!readOnly) onUpdate({ motion: o.id }) }}
          />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground">{t("speakerView.motion.hint")}</p>
      {reasons.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground" data-testid="speaker-view-motion-reasons">
          {reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {!wired && nodeId && !readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start h-7 text-xs"
          data-testid="speaker-view-add-face-tracking"
          title={t("speakerView.tracks.addHint")}
          onClick={() => addFaceTrackingOnCanvas(nodeId)}
        >
          <ScanFace className="w-3.5 h-3.5 me-1" />
          {t("speakerView.tracks.add")}
        </Button>
      )}
    </section>
  )
}
