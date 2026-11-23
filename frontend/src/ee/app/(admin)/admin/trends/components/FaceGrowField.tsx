// The face grow (Admin → Video Remake's Precise column alone): how far the face
// mask is widened, % of each face's height, before it is filled. Shown with
// target "Face" and a covering fill (Blur or Depth colors); a value already set
// stays shown (to be set back to 0) wherever it is. Greyed out while any
// environment's engine cannot grow a face mask OR its platform does not take
// the key yet (the setting is shared by every environment), each named apart.
// 0 (or empty) is off and saved as no key.

import { useId } from "react"
import { CAST_SWAP_FACE_GROW_BOUNDS } from "@nodaro/render-rules"
import { Input } from "@/components/ui/input"

interface Props {
  readonly value: number | undefined
  /** Whether the grow changes anything with the setting's target and fill (the server's `faceGrowSent` rules). */
  readonly applies: boolean
  readonly missing: { readonly engine: readonly string[]; readonly platform: readonly string[] }
  readonly onChange: (v: number | undefined) => void
}

export function FaceGrowField({ value, applies, missing, onChange }: Props) {
  const id = useId()
  const { min, max, step } = CAST_SWAP_FACE_GROW_BOUNDS
  const on = typeof value === "number" && value > 0
  const unsupported = missing.engine.length > 0 || missing.platform.length > 0
  const invalid = value !== undefined && !(Number.isInteger(value) && value >= min && value <= max)
  return (
    <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
      <label htmlFor={id} className="font-medium">
        Face grow
      </label>
      <Input
        id={id}
        aria-describedby={`${id}-help`}
        type="number"
        inputMode="numeric"
        className="h-9"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        placeholder={String(min)}
        disabled={unsupported && !on}
        aria-invalid={invalid}
        onChange={(e) => {
          const raw = e.target.value
          const n = raw === "" ? undefined : Number(raw)
          // 0 (or emptied) removes the key: a setting without the grow is saved exactly as before it existed.
          onChange(n === undefined || Number.isNaN(n) || n === 0 ? undefined : n)
        }}
      />
      <span id={`${id}-help`} className="text-xs text-muted-foreground">
        {`Widens the face mask by this % of each face's height before it is covered (${min}–${max}; 0 is off): never above the face's top, never onto the hair, beyond a thin edge only onto the face's own skin. The face mesh is drawn as before.`}
      </span>
      {on && !applies && (
        <span role="status" className="text-xs text-muted-foreground">
          The grow applies to target Face with a Blur or Depth colors fill: with this setting it changes nothing.
        </span>
      )}
      {missing.engine.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {`The Cast Swap engine of ${missing.engine.join(", ")} cannot grow the face mask yet, and this setting is shared by every environment${on ? ": set it to 0 to save" : ""}.`}
        </span>
      )}
      {missing.platform.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          {`The platform in ${missing.platform.join(", ")} does not take the face grow yet, and this setting is shared by every environment${on ? ": empty it to save" : ""}.`}
        </span>
      )}
    </div>
  )
}
