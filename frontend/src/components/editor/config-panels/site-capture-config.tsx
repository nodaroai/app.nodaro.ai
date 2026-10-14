"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SITE_CAPTURE_STILLS, siteCaptureMaxStills } from "@nodaro/shared/nodes"
import { useT } from "@/lib/i18n"
import type { SiteCaptureNodeData } from "@/types/nodes"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"

/** Site Capture: the page to capture and how many section stills to aim for. */
export function SiteCaptureConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SiteCaptureNodeData>) {
  const t = useT()
  const stills = siteCaptureMaxStills(data.maxStills)
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="url" label={t("cfgext.siteCapturePage")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          id="site-capture-url"
          type="url"
          inputMode="url"
          value={data.url ?? ""}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder={t("node.siteCapturePlaceholder")}
          className="text-sm"
        />
      </MappableField>
      <p className="text-[11px] text-muted-foreground leading-snug -mt-1.5">{t("cfgext.siteCapturePageHint")}</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="site-capture-stills">{t("cfgext.siteCaptureStills")}</Label>
        <Input
          id="site-capture-stills"
          type="number"
          min={SITE_CAPTURE_STILLS.min}
          max={SITE_CAPTURE_STILLS.max}
          value={stills}
          onChange={(e) => onUpdate({ maxStills: siteCaptureMaxStills(parseInt(e.target.value, 10)) })}
          className="text-sm w-24"
        />
        <p className="text-[11px] text-muted-foreground leading-snug">{t("cfgext.siteCaptureStillsHint")}</p>
      </div>

      <p className="text-[11px] text-muted-foreground leading-snug">{t("cfgext.siteCaptureOutputs")}</p>
    </div>
  )
}
