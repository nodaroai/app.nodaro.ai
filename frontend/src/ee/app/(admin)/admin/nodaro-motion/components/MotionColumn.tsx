// Admin → Nodaro Motion, one engine's Motion column: how a run people start
// themselves with the Motion style prepares its clip and words its prompt
// (the `nodaro_motion_motion` setting's entry for the engine).
//
// - Masking: "Same as Precise" (left out: the engine's Precise masking, on
//   one video), Faces hidden (its own face mask, the trend editor's
//   controls), or Full depth (the whole clip as depth, with where the scene
//   comes from). Keep people is a trend's alone.
// - Prompt style: left out = Flexible.
//
// Nothing set reads "Same as Precise, Flexible prompt".
//
// What this environment's Cast Swap engine cannot do yet of the column's
// setting (`supports`, from the setting's GET; `motionEngineGaps`) is said
// under it: the engine plugin is out of date.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AdminTrendFaceMasking, NodaroMotionEngineSupports, NodaroMotionMotionEntry } from "@/lib/api"
import { FaceMaskingEditor } from "../../trends/components/FaceMaskingEditor"
import { PromptStyleSelect } from "../../trends/components/PromptStyleSelect"
import { clipPreparationOf, withClipPreparation } from "../../trends/clip-preparation"
import { motionEngineGaps } from "../model"

type MaskingChoice = "same" | "faces" | "full-depth"

const MASKING_CHOICES: ReadonlyArray<{ value: MaskingChoice; label: string; hint: string }> = [
  { value: "same", label: "Same as Precise", hint: "The Precise column's masking, on one video: no clip preparation of its own." },
  { value: "faces", label: "Faces hidden", hint: "Its own face masking (the settings below)." },
  { value: "full-depth", label: "Full depth", hint: "The whole clip becomes one depth video on every run (charged as clip preparation); the scene comes from below." },
]

/** What the column's masking select shows for the entry's masking. */
export function maskingChoiceOf(m: AdminTrendFaceMasking | undefined): MaskingChoice {
  if (!m) return "same"
  return clipPreparationOf(m) === "full-depth" ? "full-depth" : "faces"
}

/** The entry with its masking chosen another way (a new object; empty keys left out). */
export function withMaskingChoice(entry: NodaroMotionMotionEntry | undefined, choice: MaskingChoice): NodaroMotionMotionEntry {
  const { masking, ...rest } = entry ?? {}
  if (choice === "same") return rest
  if (choice === "faces") return { ...rest, masking: withClipPreparation(masking, "faces").masking ?? { mode: "off" } }
  return { ...rest, masking: withClipPreparation(masking, "full-depth").masking }
}

interface Props {
  readonly value: NodaroMotionMotionEntry | undefined
  readonly onChange: (next: NodaroMotionMotionEntry) => void
  /** This environment's engine (unknown when left out: nothing is said). */
  readonly supports?: NodaroMotionEngineSupports
}

export function MotionColumn({ value, onChange, supports }: Props) {
  const id = useId()
  const choice = maskingChoiceOf(value?.masking)
  const hint = MASKING_CHOICES.find((c) => c.value === choice)?.hint
  const empty = !value?.masking && !value?.promptStyle
  const gaps = motionEngineGaps(value, supports)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
        <label htmlFor={id} className="font-medium">
          Motion masking
        </label>
        <Select value={choice} onValueChange={(v) => onChange(withMaskingChoice(value, v as MaskingChoice))}>
          <SelectTrigger id={id} className="h-9" aria-describedby={`${id}-hint`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MASKING_CHOICES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      </div>
      {value?.masking && (
        <FaceMaskingEditor
          value={value.masking}
          source={choice === "full-depth" ? "full-depth" : "faces"}
          // Off is kept as Off ({ mode: "off" }), never read as "Same as Precise".
          onChange={(m) => onChange({ ...value, masking: m ?? { mode: "off" } })}
        />
      )}
      <PromptStyleSelect
        label="Motion prompt style"
        value={value?.promptStyle}
        faceMasking={value?.masking}
        defaultStyle="flexible"
        onChange={(promptStyle) => {
          const { promptStyle: _was, ...rest } = value ?? {}
          onChange(promptStyle ? { ...rest, promptStyle } : rest)
        }}
      />
      {empty && <p className="text-xs text-muted-foreground">Same as Precise, Flexible prompt.</p>}
      {gaps.length > 0 && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          This environment's Cast Swap engine plugin is out of date: it cannot run {gaps.join(", ")} yet. Until it is updated,
          runs here do not follow that part of the setting.
        </p>
      )}
    </div>
  )
}
