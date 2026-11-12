import {
  LAYER_SPLIT_MAX_LAYERS,
  LAYER_SPLIT_PROMPT_MAX,
  LAYER_SPLIT_SIZES,
  layerSplitMaxLayers,
  layerSplitSize,
} from "@nodaro/render-rules"
import { useT } from "@/lib/i18n"
import { hasCredits } from "@/lib/edition"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import type { UnitConfigKit } from "../exec-kit"
import { definition } from "./definition.generated"
import { creditId } from "./price-id"
import type { SplitIntoLayersData } from "./types"

/** The box mark a description may carry, shown in the hint as typed (corners on 0–1000 of the picture). */
const BBOX_MARK = "<bbox>x1 y1 x2 y2</bbox>"

const PRICE_ROWS: Readonly<Record<string, number>> = definition.priceRows

/**
 * What a run of `data` holds: the charged price of its hold row (Max layers
 * plus the base, at its size's tier — price-id.ts, the backend price.ee.ts
 * rule), the editor's price mirror until the server answers. 0 with credits
 * off. The Run button and the hold line read this one figure.
 */
export function useHoldCredits(data: Readonly<Record<string, unknown>>): number {
  const id = creditId(data)
  return useModelCredits(id, PRICE_ROWS[id] ?? PRICE_ROWS[definition.type] ?? 0)
}

/**
 * Split into Layers' settings: Max layers, the size and an optional
 * description of what to separate; below them, what a run holds. Nothing
 * depends on a provider, so nothing snaps (root CLAUDE.md Provider Enum Sync
 * 12b does not apply); each value is read through the render-rules helpers the
 * route and the server payload use, so a stale or hand-written value shows as
 * the value a run sends.
 */
export function ConfigPanel({ data: raw, onUpdate }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as SplitIntoLayersData
  const t = useT()
  const maxLayers = layerSplitMaxLayers(data.maxLayers)
  const size = layerSplitSize(data.size)
  const prompt = typeof data.prompt === "string" ? data.prompt : ""
  const hold = useHoldCredits(data)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="split-layers-max">{t("splitIntoLayers.maxLayers")}</Label>
        <ClampedNumberInput
          id="split-layers-max"
          className="w-24"
          value={maxLayers}
          min={LAYER_SPLIT_MAX_LAYERS.min}
          max={LAYER_SPLIT_MAX_LAYERS.max}
          step={1}
          onCommit={(n) => onUpdate({ maxLayers: layerSplitMaxLayers(n) })}
        />
        <p className="text-[11px] text-muted-foreground leading-snug">{t("splitIntoLayers.maxLayersHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("splitIntoLayers.size")}</Label>
        <Select value={size} onValueChange={(v) => onUpdate({ size: layerSplitSize(v) })}>
          <SelectTrigger aria-label={t("splitIntoLayers.size")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {LAYER_SPLIT_SIZES.map((s) => (
              <SelectItem key={s} value={s}>{s === "auto" ? t("splitIntoLayers.sizeAuto") : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground leading-snug">{t("splitIntoLayers.sizeHint")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="split-layers-prompt">{t("splitIntoLayers.prompt")}</Label>
        <Textarea
          id="split-layers-prompt"
          className="min-h-[80px] text-sm resize-y"
          value={prompt}
          maxLength={LAYER_SPLIT_PROMPT_MAX}
          placeholder={t("splitIntoLayers.promptPlaceholder")}
          onChange={(e) => onUpdate({ prompt: e.target.value.slice(0, LAYER_SPLIT_PROMPT_MAX) })}
        />
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] text-muted-foreground leading-snug">{t("splitIntoLayers.promptHint", { bbox: BBOX_MARK })}</p>
          <span data-testid="split-layers-prompt-count" aria-live="polite" className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {`${prompt.length} / ${LAYER_SPLIT_PROMPT_MAX}`}
          </span>
        </div>
      </div>

      {hasCredits() && (
        <p className="text-[11px] text-muted-foreground leading-snug border-t border-border pt-2">
          {t("splitIntoLayers.hold", { credits: hold, layers: maxLayers })}
        </p>
      )}
    </div>
  )
}
