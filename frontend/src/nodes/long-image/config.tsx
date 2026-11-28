import {
  LONG_IMAGE_LENGTHS,
  LONG_IMAGE_PRODUCT_INPUTS,
  LONG_IMAGE_PROMPT_MAX,
  LONG_IMAGE_RESOLUTIONS,
  LONG_IMAGE_STYLE_INPUT,
  LONG_IMAGE_STYLE_NAME,
  LONG_IMAGE_SUBJECT_INPUT,
  LONG_IMAGE_SUBJECT_NAME,
  LONG_IMAGE_TEXT_AT,
  longImageLength,
  longImageMode,
  longImagePictureInputs,
  longImageProductName,
  longImageResolution,
  type LongImageLength,
  type LongImageMode,
} from "@nodaro/render-rules"
import { useMemo } from "react"
import { Info } from "lucide-react"
import { useT, type MessageKey } from "@/lib/i18n"
import { hasCredits } from "@/lib/edition"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useHandleConnections } from "@/hooks/use-handle-connections"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import type { UnitConfigKit } from "../exec-kit"
import { definition } from "./definition.generated"
import { creditId } from "./price-id"
import type { LongImageData } from "./types"

/** The ids of the node's inputs that carry a wire, as the canvas holds them now (every picture input, whatever the mode). */
export function useWiredInputs(nodeId: string): ReadonlySet<string> {
  const product1 = useHandleConnections(nodeId, LONG_IMAGE_PRODUCT_INPUTS[0], "target").length > 0
  const product2 = useHandleConnections(nodeId, LONG_IMAGE_PRODUCT_INPUTS[1], "target").length > 0
  const product3 = useHandleConnections(nodeId, LONG_IMAGE_PRODUCT_INPUTS[2], "target").length > 0
  const style = useHandleConnections(nodeId, LONG_IMAGE_STYLE_INPUT, "target").length > 0
  const subject = useHandleConnections(nodeId, LONG_IMAGE_SUBJECT_INPUT, "target").length > 0
  return useMemo(() => {
    const wired = [
      [LONG_IMAGE_PRODUCT_INPUTS[0], product1],
      [LONG_IMAGE_PRODUCT_INPUTS[1], product2],
      [LONG_IMAGE_PRODUCT_INPUTS[2], product3],
      [LONG_IMAGE_STYLE_INPUT, style],
      [LONG_IMAGE_SUBJECT_INPUT, subject],
    ] as const
    return new Set(wired.flatMap(([id, on]) => (on ? [id] : [])))
  }, [product1, product2, product3, style, subject])
}

/**
 * How many pictures a run of `mode` is priced on with these wires: each wired
 * picture input of the mode (render-rules longImagePictureInputs, the rule
 * price-id.ts prices by). A wired input whose upstream has not made its picture
 * yet counts, so the price shown before a first run is never below the run's.
 */
export function wiredPictureCount(mode: LongImageMode, wired: ReadonlySet<string>): number {
  return longImagePictureInputs(mode).filter((id) => wired.has(id)).length
}

/** Whether a picture is wired into an input the mode does not read (it is not sent). */
export function otherModeWired(mode: LongImageMode, wired: ReadonlySet<string>): boolean {
  return longImagePictureInputs(mode === "ecommerce" ? "webpage" : "ecommerce").some((id) => wired.has(id))
}

const PRICE_ROWS: Readonly<Record<string, number>> = definition.priceRows

/**
 * What a run of `data` with these wires costs: the charged price of the row
 * price-id.ts names (its mode, length, size and each wired picture input; the
 * rule the editor's Generate button and run estimate read too), the editor's
 * price mirror until the server answers. 0 with credits off. The Run button and
 * the config panel read this one figure.
 */
export function useRunCredits(data: Readonly<Record<string, unknown>>, wired: ReadonlySet<string>): number {
  const id = creditId(data, wired)
  return useModelCredits(id, PRICE_ROWS[id] ?? PRICE_ROWS[definition.type] ?? 0)
}

const MODE_LABEL: Record<LongImageMode, MessageKey> = { webpage: "longImage.modeWebpage", ecommerce: "longImage.modeEcommerce" }
const LENGTH_LABEL: Record<LongImageLength, MessageKey> = { short: "longImage.lengthShort", medium: "longImage.lengthMedium", long: "longImage.lengthLong" }

/** The names a prompt calls the product pictures by, as typed: "@image_1, @image_2, @image_3". */
function productNames(): string {
  return [1, 2, 3].map((n) => `@${longImageProductName(n)}`).join(", ")
}

/**
 * Long Image's settings: the mode (Webpage design or Product page), a product
 * page's length, the size and the prompt, with the names the prompt calls its
 * pictures by; below them, what a run with the pictures wired now costs.
 * Nothing depends on a provider, so nothing snaps (root CLAUDE.md Provider Enum
 * Sync 12b does not apply); each value is read through the render-rules helpers
 * the route and the server payload use, so a stale or hand-written value shows
 * as the value a run sends.
 */
export function ConfigPanel({ data: raw, onUpdate, nodeId }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as LongImageData
  const t = useT()
  const mode = longImageMode(data.mode)
  const length = longImageLength(data.length)
  const resolution = longImageResolution(data.resolution)
  const prompt = typeof data.prompt === "string" ? data.prompt : ""
  const wired = useWiredInputs(nodeId)
  const credits = useRunCredits(data, wired)
  const sent = wiredPictureCount(mode, wired)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{t("longImage.mode")}</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: longImageMode(v) })}>
          <SelectTrigger aria-label={t("longImage.mode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(["webpage", "ecommerce"] as const).map((m) => <SelectItem key={m} value={m}>{t(MODE_LABEL[m])}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground leading-snug">{mode === "webpage" ? t("longImage.modeWebpageHint") : t("longImage.modeEcommerceHint")}</p>
      </div>

      {mode === "ecommerce" && (
        <div className="flex flex-col gap-1.5">
          <Label>{t("longImage.length")}</Label>
          <Select value={length} onValueChange={(v) => onUpdate({ length: longImageLength(v) })}>
            <SelectTrigger aria-label={t("longImage.length")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {LONG_IMAGE_LENGTHS.map((l) => <SelectItem key={l} value={l}>{t(LENGTH_LABEL[l])}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground leading-snug">{t("longImage.lengthHint")}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{t("longImage.resolution")}</Label>
        <Select value={resolution} onValueChange={(v) => onUpdate({ resolution: longImageResolution(v) })}>
          <SelectTrigger aria-label={t("longImage.resolution")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {LONG_IMAGE_RESOLUTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="long-image-prompt">{t("longImage.prompt")}</Label>
        <Textarea
          id="long-image-prompt"
          className="min-h-[120px] text-sm resize-y"
          value={prompt}
          maxLength={LONG_IMAGE_PROMPT_MAX}
          placeholder={mode === "webpage" ? t("longImage.promptPlaceholderWebpage") : t("longImage.promptPlaceholderEcommerce")}
          onChange={(e) => onUpdate({ prompt: e.target.value.slice(0, LONG_IMAGE_PROMPT_MAX) })}
        />
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] text-muted-foreground leading-snug">
            {mode === "webpage"
              ? t("longImage.promptNamesWebpage", { style: `@${LONG_IMAGE_STYLE_NAME}`, subject: `@${LONG_IMAGE_SUBJECT_NAME}`, at: LONG_IMAGE_TEXT_AT })
              : t("longImage.promptNamesEcommerce", { names: productNames(), at: LONG_IMAGE_TEXT_AT })}
          </p>
          <span data-testid="long-image-prompt-count" aria-live="polite" className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {`${prompt.length} / ${LONG_IMAGE_PROMPT_MAX}`}
          </span>
        </div>
      </div>

      {otherModeWired(mode, wired) && (
        <p role="status" className="flex items-start gap-1.5 text-[11px] text-amber-500 leading-snug">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          {mode === "webpage" ? t("longImage.productInputsIgnored") : t("longImage.webpageInputsIgnored")}
        </p>
      )}

      {hasCredits() && (
        <p className="text-[11px] text-muted-foreground leading-snug border-t border-border pt-2">
          {t(sent === 0 ? "longImage.priceNone" : sent === 1 ? "longImage.priceOne" : "longImage.price", { credits, n: sent })}
        </p>
      )}
    </div>
  )
}
