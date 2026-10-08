import { SpeakerEmphasisPicker, SpeakerLayoutPicker, SpeakerSwitchPicker } from "@/lib/picker-ui"
import { COMBINE_TRANSITIONS } from "@nodaro/shared"
import { SPEAKER_VIEW_DEFAULTS, type SpeakerViewNormalizeNote, type SpeakerViewOption } from "@nodaro/render-rules"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { SPEAKER_LAYOUT_LABEL_KEYS, SPEAKER_SWITCH_LABEL_KEYS } from "@/components/nodes/speaker-view-quick-configs"
import { useT, type MessageKey } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { cn } from "@/lib/utils"
import { SPEAKER_EMPHASIS_LABEL_KEYS, distinctReasons, speakerViewPickerOptions, speakerViewReasonText, speakerViewSnapText } from "./speaker-view-reasons"

type Update = (patch: Record<string, unknown>) => void

function Reasons({ testId, reasons }: { readonly testId: string; readonly reasons: readonly string[] }) {
  if (reasons.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground" data-testid={testId}>
      {reasons.map((r) => <li key={r}>{r}</li>)}
    </ul>
  )
}

/** A tween length, 0–5000 ms in 50 ms steps, with its value beside the name. */
function TweenSlider({ label, value, disabled, onChange }: { readonly label: string; readonly value: number; readonly disabled?: boolean; readonly onChange: (ms: number) => void }) {
  const t = useT()
  return (
    <div className={cn("flex flex-col gap-1", disabled && "opacity-50")}>
      <div className="flex items-center justify-between">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <span className="text-[11px] tabular-nums text-muted-foreground">{t("speakerView.ms", { ms: value })}</span>
      </div>
      <Slider min={0} max={5000} step={50} value={[value]} disabled={disabled} thumbAriaLabel={label} onValueChange={([n]) => onChange(n!)} />
    </div>
  )
}

const msOf = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback)

interface LayoutSectionProps {
  readonly options: readonly SpeakerViewOption[]
  readonly value: string
  readonly aspect: string
  readonly snapped: readonly SpeakerViewNormalizeNote[]
  readonly onUpdate: Update
}

/** LAYOUT (U2): the tile grid, each tile drawn at the output's aspect. */
export function SpeakerViewLayoutSection({ options, value, aspect, snapped, onUpdate }: LayoutSectionProps) {
  const t = useT()
  return (
    <section className="flex flex-col gap-1.5">
      <Label>{t("speakerView.section.layout")}</Label>
      <SpeakerLayoutPicker options={speakerViewPickerOptions(options, SPEAKER_LAYOUT_LABEL_KEYS, t)} value={value} aspect={aspect} ariaLabel={t("speakerView.field.layout")} onChange={(layout) => onUpdate({ layout })} />
      <p className="text-[10px] text-muted-foreground">{t("speakerView.layoutAutoHint")}</p>
      <Reasons testId="speaker-view-layout-reasons" reasons={distinctReasons(options, t)} />
      {snapped.map((n) => (
        <p key={n.from} role="status" data-testid="speaker-view-snap" className="text-[10px] text-amber-700 dark:text-amber-400">{speakerViewSnapText(n, t)}</p>
      ))}
    </section>
  )
}

interface SwitchSectionProps {
  readonly options: readonly SpeakerViewOption[]
  /** Whether the Crossfade family applies to this edit (`validSpeakerCrossfade`). */
  readonly crossfade: SpeakerViewOption
  readonly value: string
  readonly durationMs: unknown
  /** The speaker changes Pan and Crossfade apply to (SV5, SV21 c), when countable. */
  readonly counts: { readonly changes: number; readonly pan: number; readonly crossfade: number } | null
  readonly onUpdate: Update
}

/** SWITCH (U2): what happens at a speaker change, with how many changes Pan
 *  and Crossfade actually reach. */
export function SpeakerViewSwitchSection({ options, crossfade, value, durationMs, counts, onUpdate }: SwitchSectionProps) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const pan = options.find((o) => o.id === "pan")
  // A fixed multi-slot layout keeps its slots: nothing to count (SV2).
  const fixed = pan?.reason?.code === "slots-fixed"
  const crossfadeName = value.startsWith("xfade:") ? (COMBINE_TRANSITIONS.find((c) => c.id === value.slice("xfade:".length))?.label ?? value) : ""
  const notes: string[] = []
  if (counts && !fixed) {
    if (pan?.allowed) {
      notes.push(counts.pan === counts.changes ? t("speakerView.note.panAll", { changes: counts.changes }) : t("speakerView.note.panCount", { applies: counts.pan, changes: counts.changes, cut: counts.changes - counts.pan }))
    }
    // Ruled out, the greyed tile's reason says it (nothing to count).
    if (crossfade.allowed) notes.push(t("speakerView.note.crossfadeCount", { applies: counts.crossfade, changes: counts.changes }))
  }
  return (
    <section className="flex flex-col gap-1.5">
      <Label>{t("speakerView.section.switch")}</Label>
      <SpeakerSwitchPicker
        options={speakerViewPickerOptions(options, SPEAKER_SWITCH_LABEL_KEYS, t)}
        value={value}
        ariaLabel={t("speakerView.field.switch")}
        crossfadeLabel={t("speakerView.switch.crossfadeMore")}
        crossfadeSelectedLabel={t("speakerView.switch.crossfadeOf", { name: localizeOption(crossfadeName) })}
        localizeLabel={localizeOption}
        crossfadeDisabled={!crossfade.allowed}
        crossfadeReason={crossfade.reason ? speakerViewReasonText(crossfade.reason, t) : undefined}
        onChange={(switchType) => onUpdate({ switchType })}
      />
      {notes.length > 0 && (
        <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground" data-testid="speaker-view-switch-notes">
          {notes.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
      <Reasons testId="speaker-view-switch-reasons" reasons={distinctReasons([...options, crossfade], t)} />
      <TweenSlider label={t("speakerView.field.switchMs")} value={msOf(durationMs, SPEAKER_VIEW_DEFAULTS.switchDurationMs)} onChange={(n) => onUpdate({ switchDurationMs: n })} />
    </section>
  )
}

interface EmphasisSectionProps {
  readonly options: readonly SpeakerViewOption[]
  readonly value: string | undefined
  readonly durationMs: unknown
  readonly onUpdate: Update
}

/** EMPHASIS (U2): who is marked while speaking — greyed whole under Single. */
export function SpeakerViewEmphasisSection({ options, value, durationMs, onUpdate }: EmphasisSectionProps) {
  const t = useT()
  const none = options.every((o) => !o.allowed)
  return (
    <section className="flex flex-col gap-1.5">
      <Label>{t("speakerView.section.emphasis")}</Label>
      <SpeakerEmphasisPicker options={speakerViewPickerOptions(options, SPEAKER_EMPHASIS_LABEL_KEYS as Readonly<Record<string, MessageKey>>, t)} value={value} ariaLabel={t("speakerView.field.emphasis")} onChange={(emphasisStyle) => onUpdate({ emphasisStyle })} />
      <Reasons testId="speaker-view-emphasis-reasons" reasons={distinctReasons(options, t)} />
      <TweenSlider label={t("speakerView.field.emphasisMs")} value={msOf(durationMs, SPEAKER_VIEW_DEFAULTS.emphasisDurationMs)} disabled={none} onChange={(n) => onUpdate({ emphasisDurationMs: n })} />
    </section>
  )
}
