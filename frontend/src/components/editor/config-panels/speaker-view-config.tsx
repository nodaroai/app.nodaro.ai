import { useMemo } from "react"
import {
  SPEAKER_VIEW_ASPECTS,
  SPEAKER_VIEW_DEFAULTS,
  SPEAKER_VIEW_NOT_PRICED_MESSAGE,
  SPEAKER_VIEW_PRICED,
  normalizeSpeakerViewData,
  validSpeakerEmphasis,
  validSpeakerLayouts,
  validSpeakerSwitches,
  speakerViewAspectOf,
  type SpeakerViewNodeSettings,
} from "@nodaro/render-rules"
import { COMBINE_TRANSITIONS, SPEAKER_SWITCHES } from "@nodaro/shared"
import { EdlValidityBadge } from "@/components/inspector/edl-validity-badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SPEAKER_LAYOUT_LABEL_KEYS, SPEAKER_SWITCH_LABEL_KEYS } from "@/components/nodes/speaker-view-quick-configs"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { useT } from "@/lib/i18n"
import { speakerViewBatchValidity } from "@/lib/speaker-view-validity"
import { speakerViewContextOf, speakerViewEdits, speakerViewTranscript } from "@/lib/speaker-view-context"
import type { SpeakerViewData } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { SPEAKER_EMPHASIS_LABEL_KEYS, speakerViewReasonText, speakerViewSnapText } from "./speaker-view-reasons"

const BORDER_DEFAULT_ACCENT = "#FFFFFF"

/**
 * Speaker View's settings (U2, C3.2): layout, switch, emphasis, aspect, quality
 * and accent colour. A choice the aspect or the speaker count rules out is
 * GREYED with its reason (SV3); the same pure functions feed the quick strip and
 * the run, so the three always agree. The tile pickers of U2 replace the
 * selects in C3.3; the rules behind them are these.
 */
export function SpeakerViewConfig({ data, onUpdate, nodes, edges = [], nodeId }: ConfigProps<SpeakerViewData> & { readonly nodeId?: string }) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const settings = data as SpeakerViewNodeSettings
  const ctx = useMemo(() => (nodeId ? speakerViewContextOf(nodeId, nodes, edges) : undefined), [nodeId, nodes, edges])
  const edits = useMemo(() => (nodeId ? speakerViewEdits(nodeId, nodes, edges) : []), [nodeId, nodes, edges])
  const transcript = useMemo(() => (nodeId ? speakerViewTranscript(nodeId, nodes, edges) : undefined), [nodeId, nodes, edges])
  const verdict = useMemo(() => speakerViewBatchValidity(edits, transcript, data), [edits, transcript, data])

  const aspect = speakerViewAspectOf(settings, ctx)
  const layouts = validSpeakerLayouts(settings, ctx)
  const switches = validSpeakerSwitches(settings, ctx)
  const emphasis = validSpeakerEmphasis(settings)
  const snapped = normalizeSpeakerViewData(settings, ctx).notes
  const layout = typeof data.layout === "string" ? data.layout : "auto"
  const switchType = typeof data.switchType === "string" ? data.switchType : "cut"
  const atoms = new Set((data.emphasisStyle ?? "none").split("+").map((a) => a.trim()).filter((a) => a && a !== "none"))
  // One line per distinct reason (Single rules all three emphasis atoms out for the same one).
  const reasons = [...new Set([...layouts, ...switches, ...emphasis].flatMap((o) => (o.reason ? [speakerViewReasonText(o.reason, t)] : [])))]

  const toggleAtom = (id: string, on: boolean) => {
    const next = new Set(atoms)
    if (on) next.add(id)
    else next.delete(id)
    onUpdate({ emphasisStyle: next.size === 0 ? "none" : [...next].join("+") })
  }
  const crossfadeName = (id: string) => COMBINE_TRANSITIONS.find((c) => c.id === id.slice("xfade:".length))?.label ?? id
  const ms = (key: "switchDurationMs" | "emphasisDurationMs", fallback: number) => (typeof data[key] === "number" ? (data[key] as number) : fallback)
  const setMs = (key: "switchDurationMs" | "emphasisDurationMs") => (raw: string) => {
    const n = Number(raw)
    onUpdate({ [key]: raw.trim() === "" || !Number.isFinite(n) ? undefined : Math.max(0, Math.min(5000, Math.round(n))) })
  }

  return (
    <div className="flex flex-col gap-3" data-testid="speaker-view-config">
      <p className="text-[11px] text-muted-foreground">{t("speakerView.hint")}</p>
      {!SPEAKER_VIEW_PRICED && (
        <p role="status" data-testid="speaker-view-not-priced" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400" title={SPEAKER_VIEW_NOT_PRICED_MESSAGE}>
          {t("speakerView.notPriced")}
        </p>
      )}

      <section className="flex flex-col gap-1">
        <Label>{t("speakerView.section.input")}</Label>
        {ctx ? (
          <p className="text-[11px] text-muted-foreground" data-testid="speaker-view-input-summary">
            {ctx.clips.length > 1
              ? t("speakerView.inputPack", { clips: ctx.clips.length, min: Math.min(...ctx.clips.map((c) => c.speakerCount)), max: Math.max(...ctx.clips.map((c) => c.speakerCount)) })
              : t("speakerView.inputSummary", { speakers: ctx.clips[0]!.speakerCount, cameras: ctx.clips[0]!.cameras })}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">{t("speakerView.inputNone")}</p>
        )}
        <EdlValidityBadge verdict={verdict} />
      </section>

      <section className="flex flex-col gap-2">
        <Label>{t("speakerView.section.output")}</Label>
        <Select value={data.targetAspect ?? aspect} onValueChange={(v) => onUpdate({ targetAspect: v })}>
          <SelectTrigger aria-label={t("speakerView.field.aspect")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SPEAKER_VIEW_ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={data.quality ?? "final"} onValueChange={(v) => onUpdate({ quality: v as "proxy" | "final" })}>
          <SelectTrigger aria-label={t("speakerView.field.quality")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="final">{t("proccfg.applyEdlFinal")}</SelectItem>
            <SelectItem value="proxy">{t("proccfg.applyEdlProxy")}</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <section className="flex flex-col gap-1">
        <Label>{t("speakerView.section.layout")}</Label>
        <Select value={layout} onValueChange={(v) => onUpdate({ layout: v })}>
          <SelectTrigger aria-label={t("speakerView.field.layout")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {layouts.map((o) => (
              <SelectItem key={o.id} value={o.id} disabled={!o.allowed} title={o.reason ? speakerViewReasonText(o.reason, t) : undefined}>
                {t(SPEAKER_LAYOUT_LABEL_KEYS[o.id]!)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">{t("speakerView.layoutAutoHint")}</p>
        {snapped.map((n) => (
          <p key={n.from} role="status" data-testid="speaker-view-snap" className="text-[10px] text-amber-700 dark:text-amber-400">{speakerViewSnapText(n, t)}</p>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <Label>{t("speakerView.section.switch")}</Label>
        <Select value={switchType} onValueChange={(v) => onUpdate({ switchType: v })}>
          <SelectTrigger aria-label={t("speakerView.field.switch")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {switches.map((o) => (
              <SelectItem key={o.id} value={o.id} disabled={!o.allowed} title={o.reason ? speakerViewReasonText(o.reason, t) : undefined}>
                {t(SPEAKER_SWITCH_LABEL_KEYS[o.id]!)}
              </SelectItem>
            ))}
            {SPEAKER_SWITCHES.filter((s) => s.overlaps).map((s) => (
              <SelectItem key={s.id} value={s.id}>{t("speakerView.switch.crossfadeOf", { name: localizeOption(crossfadeName(s.id)) })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="speaker-view-switch-ms" className="text-[11px] text-muted-foreground">{t("speakerView.field.switchMs")}</Label>
        <Input id="speaker-view-switch-ms" type="number" min={0} max={5000} step={50} value={ms("switchDurationMs", SPEAKER_VIEW_DEFAULTS.switchDurationMs)} onChange={(e) => setMs("switchDurationMs")(e.target.value)} />
      </section>

      <section className="flex flex-col gap-1">
        <Label>{t("speakerView.section.emphasis")}</Label>
        <div className="flex flex-wrap gap-3" role="group" aria-label={t("speakerView.field.emphasis")}>
          {emphasis.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5 text-[11px]" title={o.reason ? speakerViewReasonText(o.reason, t) : undefined}>
              <Checkbox checked={atoms.has(o.id)} disabled={!o.allowed} onCheckedChange={(on) => toggleAtom(o.id, on === true)} aria-label={t(SPEAKER_EMPHASIS_LABEL_KEYS[o.id]!)} />
              {t(SPEAKER_EMPHASIS_LABEL_KEYS[o.id]!)}
            </label>
          ))}
        </div>
        <Label htmlFor="speaker-view-emphasis-ms" className="text-[11px] text-muted-foreground">{t("speakerView.field.emphasisMs")}</Label>
        <Input id="speaker-view-emphasis-ms" type="number" min={0} max={5000} step={50} value={ms("emphasisDurationMs", SPEAKER_VIEW_DEFAULTS.emphasisDurationMs)} onChange={(e) => setMs("emphasisDurationMs")(e.target.value)} />
        <Label htmlFor="speaker-view-accent" className="text-[11px] text-muted-foreground">{t("speakerView.field.accent")}</Label>
        <Input id="speaker-view-accent" type="color" value={data.accentColor ?? BORDER_DEFAULT_ACCENT} onChange={(e) => onUpdate({ accentColor: e.target.value.toUpperCase() })} className="h-8 w-16 p-1" />
      </section>

      {reasons.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground" data-testid="speaker-view-reasons">
          {reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </div>
  )
}
