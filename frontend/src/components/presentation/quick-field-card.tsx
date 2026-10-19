import { useContext, useEffect, useMemo, useRef, useState } from "react"
import { AutoCorrectContext } from "./auto-correct-context"
import {
  isInQuickConfigRange,
  quickConfigChoicePatch,
  quickConfigRetainedOption,
  quickConfigSnapPatch,
  quickConfigSnapWrite,
  readQuickConfigValue,
  resolveQuickConfigOptions,
  type QuickConfigControl,
  type QuickConfigOption,
} from "@/components/nodes/node-quick-configs"
import { GlassCard } from "./output-cards/shared"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { cn } from "@/lib/utils"

const LABEL_CLS = "text-xs font-medium text-muted-foreground uppercase tracking-wider"
/** The Select value of the "Custom…" item: it opens the number editor and never writes. */
const CUSTOM = "__custom__"

export interface QuickFieldCardProps {
  readonly control: QuickConfigControl
  /** The node's data with this run's values on top — the options are the ones the node can take NOW. */
  readonly nodeData: Record<string, unknown>
  /** The publisher's restriction (node-data values), if any. */
  readonly allowedValues?: ReadonlyArray<string | number | boolean>
  readonly readOnly?: boolean
  readonly customLabel?: string
  /** Applies a node-data patch: a choice may write more than the field itself (Draft also pins 480p). */
  readonly onPatch: (patch: Record<string, unknown>) => void
}

/**
 * A published app's card for a field derived from a quick-strip control (presentation/exposable-fields.ts).
 * It is the strip's dropdown in app form, through the same functions: the option list for the node's current
 * data, `quickConfigChoicePatch` for a choice and `quickConfigSnapPatch` for a value the current model cannot
 * take — so changing the model on the app never leaves the previous model's resolution or aspect behind for the
 * route to reject. Two app-only rules:
 *  - a restriction filters the options, and an UNSET field whose run value (the strip's `defaultValue`) is not
 *    allowed is moved onto the first allowed option — otherwise the run would quietly use a model the publisher
 *    ruled out (nothing is submitted, so the server has nothing to check);
 *  - read-only never writes.
 */
export function QuickFieldCard({ control, nodeData, allowedValues, readOnly, customLabel, onPatch }: QuickFieldCardProps) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const onPatchRef = useRef(onPatch)
  onPatchRef.current = onPatch
  const [customOpen, setCustomOpen] = useState(false)

  const options = useMemo<ReadonlyArray<QuickConfigOption>>(() => {
    const all = resolveQuickConfigOptions(control, nodeData)
    if (!allowedValues) return all
    return all.filter((o) => allowedValues.some((av) => String(av) === o.value))
  }, [control, nodeData, allowedValues])

  const stored = readQuickConfigValue(control, nodeData)
  const effective = stored !== "" ? stored : (control.defaultValue ?? "")

  const autoCorrect = useContext(AutoCorrectContext)

  // A retired value the node keeps (not listed, still runs) stays put — unless
  // the publisher's restriction rules it out, when it snaps like any other.
  const retained = quickConfigRetainedOption(control, stored)
  const keepRetained = retained !== undefined && (!allowedValues || allowedValues.some((av) => String(av) === stored))

  useEffect(() => {
    if (readOnly || !autoCorrect) return
    const snap = quickConfigSnapPatch(keepRetained ? control : { ...control, retainedOptions: undefined }, stored, options, nodeData)
    if (snap) {
      onPatchRef.current(snap)
      return
    }
    if (stored === "" && allowedValues && options.length > 0 && !options.some((o) => o.value === effective)) {
      onPatchRef.current(quickConfigSnapWrite(control, options[0]!.value))
    }
  }, [control, stored, effective, options, nodeData, allowedValues, readOnly, autoCorrect, keepRetained])

  if (options.length === 0) return null

  // An in-range custom value (a panel slider's 46s) is valid though no preset lists it: show it as it is.
  const listed = options.some((o) => o.value === effective)
  const shown: ReadonlyArray<QuickConfigOption> =
    !listed && effective !== "" && isInQuickConfigRange(control, effective)
      ? [...options, { value: effective, label: `${effective}${control.customRange?.unit ?? ""}` }]
      : options
  const current = shown.find((o) => o.value === effective)
  // Labels the trigger only; the menu still never lists it.
  const shownCurrent = current ?? (keepRetained ? retained : undefined)
  const label = customLabel ?? control.ariaLabel
  const range = control.customRange
  // The strip's "Custom…": any in-range number, through the same slider + clamped input pair.
  const showCustom = range !== undefined && (customOpen || (!listed && effective !== "" && isInQuickConfigRange(control, effective)))
  const customValue = isInQuickConfigRange(control, effective) ? Number(effective) : (range?.min ?? 0)
  const writeChoice = (v: string) => onPatchRef.current(quickConfigChoicePatch(control, v, nodeData))

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{label}</Label>
      <Select
        value={current ? effective : undefined}
        onValueChange={(v) => {
          if (v === CUSTOM) {
            setCustomOpen(true)
            return
          }
          if (shown.find((o) => o.value === v)?.disabled) return
          writeChoice(v)
        }}
        disabled={readOnly}
      >
        <SelectTrigger className={cn("w-full", readOnly && "opacity-70 cursor-default")} aria-label={label}>
          {/* An unlisted retained value leaves the Select without a value, so Radix shows the placeholder: name it there. */}
          <SelectValue placeholder={shownCurrent && !current ? localizeOption(shownCurrent.label) : t("present.selectFieldPlaceholder", { label: label.toLowerCase() })}>
            {shownCurrent ? localizeOption(shownCurrent.label) : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {shown.map((o) => {
            const note = o.disabled ? o.reason : o.description
            return (
              <SelectItem
                key={o.value}
                value={o.value}
                className={o.disabled ? "opacity-60 cursor-not-allowed" : undefined}
                {...(o.disabled ? { "aria-disabled": true, title: o.reason } : {})}
              >
                <span>{localizeOption(o.label)}</span>
                {note && <span className="ms-1.5 text-xs text-muted-foreground">- {note}</span>}
              </SelectItem>
            )
          })}
          {range && <SelectItem value={CUSTOM}>{t("node.customEllipsis")}</SelectItem>}
        </SelectContent>
      </Select>
      {showCustom && range && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="range"
            min={range.min}
            max={range.max}
            step={range.step ?? 1}
            value={customValue}
            disabled={readOnly}
            onChange={(e) => writeChoice(e.target.value)}
            className="flex-1 h-1.5 rounded-lg cursor-pointer accent-[#ff0073]"
            aria-label={t("node.customAria", { label })}
          />
          <ClampedNumberInput
            min={range.min}
            max={range.max}
            step={range.step ?? 1}
            value={customValue}
            disabled={readOnly}
            onCommit={(n) => {
              if (n !== undefined) writeChoice(String(n))
            }}
            className="w-20 h-8 text-xs shrink-0"
            aria-label={t("node.customValueAria", { label })}
          />
        </div>
      )}
    </GlassCard>
  )
}
