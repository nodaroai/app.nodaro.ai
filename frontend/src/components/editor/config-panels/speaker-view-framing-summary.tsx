import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n"

const BORDER_DEFAULT_ACCENT = "#FFFFFF"

/** FRAMING (U2): which speakers are cropped. Read-only until the region editor
 *  (C3.5) — a crop is written in the workflow JSON as `speakerRegions` for now. */
export function SpeakerViewFramingSummary({ regions }: { readonly regions: unknown }) {
  const t = useT()
  const count = Array.isArray(regions) ? regions.length : 0
  return (
    <section className="flex flex-col gap-1">
      <Label>{t("speakerView.section.framing")}</Label>
      <p data-testid="speaker-view-framing" className="text-[11px] text-muted-foreground">
        {count > 0 ? t("speakerView.framing.set", { count }) : t("speakerView.framing.full")}
      </p>
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
