import { useMemo } from "react"
import { SPEAKER_MAP_DEFAULT_MARGIN_DB } from "@nodaro/shared/edl"
import { useT } from "@/lib/i18n"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ConnectedMediaList, applyMediaOrder } from "@/components/editor/config-panels/connected-media-list"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import type { UnitConfigKit } from "../exec-kit"
import type { SpeakerMapData } from "./types"

/** The Select value for "no master / no wide" (the field is left unset). */
const NONE = "__none__"
/** The lead slider's range, dB (a run clamps any value to 0–30; the panel offers the useful part). */
const SPEAKER_MAP_MARGIN_SLIDER = { min: 1, max: 12, step: 0.5 } as const

/**
 * Speaker Map's settings: the cameras wired into Cameras, in the order the
 * run reads them (`sourceOrder`, by upstream node id, as Audio Sync's); which
 * of them is the master recording and which the wide shot (each a wired node
 * id); and the lead the loudest camera needs. Nothing depends on a provider,
 * so nothing snaps (CLAUDE.md Provider Enum Sync 12b does not apply); a
 * master / wide no longer wired shows as None, and both engines drop it from
 * the run (speakerMapRunInputs), so there is nothing to clear here either.
 */
export function ConfigPanel({ data: raw, onUpdate, sources = [], kit }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as SpeakerMapData
  const t = useT()
  // One row per upstream node wired into Cameras (the node id IS the recording's id in the result).
  const cameras = useMemo(() => {
    const seen = new Set<string>()
    return sources.filter((s) => s.targetHandle === "sources" && !seen.has(s.id) && (seen.add(s.id), true))
  }, [sources])
  const ordered = applyMediaOrder(cameras, data.sourceOrder ?? [])
  const wired = (id: string | undefined) => (id && cameras.some((c) => c.id === id) ? id : NONE)
  const margin = typeof data.marginDb === "number" && Number.isFinite(data.marginDb) ? data.marginDb : SPEAKER_MAP_DEFAULT_MARGIN_DB

  const pick = (field: "masterSourceId" | "wideSourceId", ariaKey: "proccfg.speakerMapMasterAria" | "proccfg.speakerMapWideAria") => (
    <Select value={wired(data[field])} onValueChange={(v) => onUpdate({ [field]: v === NONE ? undefined : v })} disabled={cameras.length === 0}>
      <SelectTrigger aria-label={t(ariaKey)}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("proccfg.speakerMapNone")}</SelectItem>
        {ordered.map((c) => <SelectItem key={c.id} value={c.id}>{kit.localizeNodeLabel(c.label)}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">{t("proccfg.speakerMapHint")}</p>

      <div className="flex flex-col gap-1.5">
        <Label>{t("proccfg.speakerMapCameras")}</Label>
        <ConnectedMediaList
          sources={cameras}
          mediaOrder={data.sourceOrder ?? []}
          onUpdateOrder={(order) => onUpdate({ sourceOrder: order })}
          mediaType="any"
          emptyMessage={t("proccfg.speakerMapCamerasEmpty")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("proccfg.speakerMapMaster")}</Label>
        {pick("masterSourceId", "proccfg.speakerMapMasterAria")}
        <p className="text-[11px] text-muted-foreground">{t("proccfg.speakerMapMasterHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("proccfg.speakerMapWide")}</Label>
        {pick("wideSourceId", "proccfg.speakerMapWideAria")}
        <p className="text-[11px] text-muted-foreground">{t("proccfg.speakerMapWideHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>{t("proccfg.speakerMapMargin")}</Label>
          <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">{margin} dB</span>
        </div>
        <Slider
          aria-label={t("proccfg.speakerMapMargin")}
          value={[margin]}
          min={SPEAKER_MAP_MARGIN_SLIDER.min}
          max={SPEAKER_MAP_MARGIN_SLIDER.max}
          step={SPEAKER_MAP_MARGIN_SLIDER.step}
          onValueChange={([v]) => onUpdate({ marginDb: v })}
          className="w-full"
        />
        <p className="text-[11px] text-muted-foreground">{t("proccfg.speakerMapMarginHint")}</p>
      </div>
    </div>
  )
}
