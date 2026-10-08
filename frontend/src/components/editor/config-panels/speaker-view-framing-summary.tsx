import { Crop } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { openFraming, useFramingHostMounted } from "@/hooks/use-framing-open-store"
import { useT } from "@/lib/i18n"

const BORDER_DEFAULT_ACCENT = "#FFFFFF"

/** FRAMING (U2): which speakers are cropped, and the way into the region
 *  editor (U4, C3.5), where each (camera, speaker) crop is drawn. */
export function SpeakerViewFramingSummary({ regions, nodeId }: { readonly regions: unknown; readonly nodeId?: string }) {
  const t = useT()
  const canOpen = useFramingHostMounted() && !!nodeId
  const count = Array.isArray(regions) ? regions.length : 0
  return (
    <section className="flex flex-col gap-1">
      <Label>{t("speakerView.section.framing")}</Label>
      <p data-testid="speaker-view-framing" className="text-[11px] text-muted-foreground">
        {count > 0 ? t("speakerView.framing.set", { count }) : t("speakerView.framing.full")}
      </p>
      {canOpen && (
        <Button type="button" variant="outline" size="sm" className="self-start h-7 text-xs" onClick={() => openFraming(nodeId!)} data-testid="speaker-view-edit-framing">
          <Crop className="w-3.5 h-3.5 me-1" />
          {t("speakerView.framing.edit")}
        </Button>
      )}
    </section>
  )
}

/** ADVANCED (U2), collapsed: the Border emphasis's colour. */
export function SpeakerViewAdvanced({ accentColor, onChange }: { readonly accentColor: unknown; readonly onChange: (hex: string) => void }) {
  const t = useT()
  return (
    <details className="group text-[11px]">
      <summary className="cursor-pointer select-none text-xs font-medium">{t("speakerView.section.advanced")}</summary>
      <div className="mt-2 flex flex-col gap-1">
        <Label htmlFor="speaker-view-accent" className="text-[11px] text-muted-foreground">{t("speakerView.field.accent")}</Label>
        <Input
          id="speaker-view-accent"
          type="color"
          value={typeof accentColor === "string" ? accentColor : BORDER_DEFAULT_ACCENT}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-8 w-16 p-1"
        />
      </div>
    </details>
  )
}
