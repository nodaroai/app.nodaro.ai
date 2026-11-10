// @registry-lookup localizes each format and SVG level label it shows, one option at a time
"use client"

/**
 * The output-format levers of an image node (GPT Image 2.6 writes PNG, JPEG,
 * WebP, an animated GIF or an SVG) and the background select they constrain,
 * shared by the Generate Image and Modify Image panels so the two never drift.
 * Every list and range is the catalog's (`model-options.ts`); the panels' own
 * fail-safe (`imageFormatFailSafe`) keeps the stored values valid.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { IMAGE_GIF_FRAME_SIZE, MASKLESS_OUTPUT_FORMATS, type LabeledOption } from "@nodaro/shared/model-catalog"
import type { FieldMappings } from "@/types/nodes"
import { MappableField } from "./mappable-field"
import {
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  IMAGE_SVG_LEVEL_OPTIONS,
  gifFramesFor,
  gifFrameDurationFor,
  keepsTransparentBackground,
  outputFormatOf,
  type ImageFormatNodeLevers,
} from "./model-options"
import type { SourceNodeInfo } from "./types"

interface MappingProps {
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}


/** A slider and the number beside it (the panels' Duration pair), committing whole steps inside the range. */
function RangeWithNumber({
  label, min, max, step, value, onChange,
}: {
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly onChange: (n: number) => void
}) {
  const t = useT()
  const commit = (n: number) => onChange(Math.min(Math.max(Math.round(n / step) * step, min), max))
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => commit(Number(e.target.value))}
        className="flex-1 h-1.5 rounded-lg cursor-pointer accent-[#ff0073]"
        aria-label={label}
      />
      {/* Commits on blur / Enter: clamping per keystroke made two-digit values untypeable. */}
      <ClampedNumberInput
        min={min}
        max={max}
        step={step}
        value={value}
        onCommit={(n) => {
          if (n !== undefined) commit(n)
        }}
        className="w-16 h-7 text-xs shrink-0"
        aria-label={t("imgcfg.exactValueAria", { label })}
      />
    </div>
  )
}

/**
 * Format, then a GIF's frames and speed or an SVG's level, for a node whose one
 * model writes several formats. Nothing for any other model, or with several
 * models selected (`provider` undefined): the format is not offered across models.
 */
export function ImageFormatFields({
  provider, data, onUpdate, sources, fieldMappings, onMapField,
}: {
  readonly provider: string | undefined
  readonly data: Readonly<ImageFormatNodeLevers> & { readonly maskUrl?: string }
  readonly onUpdate: (patch: Record<string, unknown>) => void
} & MappingProps) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const options = provider ? IMAGE_OUTPUT_FORMAT_OPTIONS[provider] : undefined
  if (!provider || !options) return null
  const format = outputFormatOf(provider, data.outputFormat)
  const frames = format === "gif" ? gifFramesFor(provider) : undefined
  const speed = format === "gif" ? gifFrameDurationFor(provider) : undefined
  const levels = format === "svg" ? IMAGE_SVG_LEVEL_OPTIONS[provider] : undefined
  const mapping = { sources, fieldMappings, onMapField }
  const choose = (v: string) =>
    onUpdate({
      outputFormat: v,
      // Only PNG and WebP keep a transparent background.
      ...(data.background === "transparent" && !keepsTransparentBackground(v) ? { background: "auto" } : {}),
    })

  return (
    <>
      <MappableField field="outputFormat" label={t("field.outputFormat")} {...mapping}>
        <Select value={format} onValueChange={choose}>
          <SelectTrigger aria-label={t("field.outputFormat")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{localizeOption(o.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {format === "gif" && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("imgcfg.gifSquareNote", { size: IMAGE_GIF_FRAME_SIZE })}</p>
        )}
        {data.maskUrl && format && MASKLESS_OUTPUT_FORMATS.includes(format) && (
          <p role="status" className="text-[11px] text-amber-600 dark:text-amber-500/80 mt-0.5 leading-snug">{t("imgcfg.formatMaskWarning")}</p>
        )}
      </MappableField>
      {frames && (
        <MappableField field="gifFrames" label={t("field.gifFrames")} {...mapping}>
          {frames.values && frames.values.length > 0 ? (
            <Select
              value={String(typeof data.gifFrames === "number" ? data.gifFrames : frames.default)}
              onValueChange={(v) => onUpdate({ gifFrames: Number(v) })}
            >
              <SelectTrigger aria-label={t("field.gifFrames")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {frames.values.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <RangeWithNumber
              label={t("field.gifFrames")}
              min={frames.min}
              max={frames.max}
              step={1}
              value={typeof data.gifFrames === "number" ? data.gifFrames : frames.default}
              onChange={(n) => onUpdate({ gifFrames: n })}
            />
          )}
        </MappableField>
      )}
      {speed && (
        <MappableField field="gifFrameDurationMs" label={t("field.gifFrameDuration")} {...mapping}>
          <RangeWithNumber
            label={t("field.gifFrameDuration")}
            min={speed.min}
            max={speed.max}
            step={speed.step}
            value={typeof data.gifFrameDurationMs === "number" ? data.gifFrameDurationMs : speed.default}
            onChange={(n) => onUpdate({ gifFrameDurationMs: n })}
          />
        </MappableField>
      )}
      {levels && (
        <MappableField field="svgLevel" label={t("field.svgLevel")} {...mapping}>
          <Select
            value={levels.find((o) => o.value === data.svgLevel)?.value ?? levels[0]?.value}
            onValueChange={(v) => onUpdate({ svgLevel: v })}
          >
            <SelectTrigger aria-label={t("field.svgLevel")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {levels.map((o) => (
                <SelectItem key={o.value} value={o.value}>{localizeOption(o.label)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MappableField>
      )}
    </>
  )
}

/**
 * The background select. With a format that cannot keep transparency (JPEG,
 * GIF) Transparent is shown greyed with the reason; an SVG takes no background
 * setting, so the select is not shown at all.
 */
export function ImageBackgroundField({
  options, value, format, onChange, sources, fieldMappings, onMapField,
}: {
  readonly options: readonly LabeledOption[] | undefined
  readonly value: string | undefined
  /** The file the node writes (`outputFormatOf`); undefined for a model with no format setting. */
  readonly format: string | undefined
  readonly onChange: (background: string) => void
} & MappingProps) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  if (!options || format === "svg") return null
  const keeps = keepsTransparentBackground(format)
  const offersTransparent = options.some((o) => o.value === "transparent")
  return (
    <MappableField field="background" label={t("field.background")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
      <Select value={value || options[0]?.value} onValueChange={onChange}>
        <SelectTrigger aria-label={t("field.background")}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={!keeps && o.value === "transparent"}>
              {localizeOption(o.label)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!keeps && offersTransparent && (
        <p className="text-[11px] text-muted-foreground mt-0.5">{t("imgcfg.transparentNeedsFormat")}</p>
      )}
    </MappableField>
  )
}
