// Admin → Nodaro Motion, one engine's Style choice (the `nodaro_motion_style`
// setting's entry for the engine): people choose Precise or Flex on every run
// they start themselves (the default), or every such run is always Precise or
// always Flex, which also hides the Style choice in Nodaro Motion. A trend
// keeps its own style.
//
// The setting is shared by every environment, so "Always Precise" and
// "Always Flex" are greyed out, naming the environments, until every one's
// engine enforces it (the server refuses the save otherwise, 409
// `engine_unsupported`). "Users choose" is always offered, so a forced style
// can always be taken back.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { NodaroMotionEngine, NodaroMotionStyle, NodaroMotionStyleChoice } from "@/lib/api"

export const STYLE_CHOICE_OPTIONS: ReadonlyArray<{ value: NodaroMotionStyleChoice; label: string }> = [
  { value: "user", label: "Users choose (Precise or Flex)" },
  { value: "precise", label: "Always Precise" },
  { value: "flex", label: "Always Flex" },
]

export const STYLE_CHOICE_HINT =
  "Hides the Style choice in Nodaro Motion and runs every direct run in this style (API and agents too). Trends keep their own style."

/** The setting as it is saved: each engine forced to a style; an engine where people choose is left out. */
export function styleToSaved(draft: NodaroMotionStyle | null | undefined): NodaroMotionStyle {
  const out: NodaroMotionStyle = {}
  for (const [id, choice] of Object.entries(draft ?? {}) as Array<[NodaroMotionEngine, NodaroMotionStyleChoice | undefined]>) {
    if (choice && choice !== "user") out[id] = choice
  }
  return out
}

interface Props {
  /** As stored; undefined = none set (people choose). */
  readonly value: NodaroMotionStyleChoice | undefined
  readonly onChange: (next: NodaroMotionStyleChoice) => void
  /**
   * The environments whose engine cannot enforce a forced style
   * (`environmentsThatCannotForceStyle`); undefined while they are unknown.
   * The forced choices are offered only when this is empty.
   */
  readonly missingIn: readonly string[] | undefined
}

export function StyleChoiceSelect({ value, onChange, missingIn }: Props) {
  const id = useId()
  const selectId = `${id}-style`
  const hintId = `${id}-style-hint`
  const current = value ?? "user"
  const forcedOffered = missingIn !== undefined && missingIn.length === 0
  const reason = missingIn === undefined ? "checking the environments" : `not supported yet: ${missingIn.join(", ")}`

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={selectId} className="font-medium">
        Style
      </label>
      <Select value={current} onValueChange={(v) => onChange(v as NodaroMotionStyleChoice)}>
        <SelectTrigger id={selectId} className="h-9" aria-describedby={hintId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STYLE_CHOICE_OPTIONS.map((o) => {
            const off = o.value !== "user" && !forcedOffered
            return (
              <SelectItem key={o.value} value={o.value} disabled={off}>
                {off ? `${o.label} (${reason})` : o.label}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <p id={hintId} className="text-xs text-muted-foreground">
        {STYLE_CHOICE_HINT}
        {!forcedOffered && missingIn !== undefined
          ? ` Always Precise and Always Flex wait for the engine in ${missingIn.join(" and ")}: this setting is shared by every environment.`
          : ""}
      </p>
    </div>
  )
}
