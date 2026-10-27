// How the trend's source clip is prepared before the video model sees it
// (hidden from users): Faces hidden (the face mask), Full depth, or Keep people
// (clip-preparation.ts). The depth modes are made once, approved and stored
// like a face mask, so they always run (mode "always").
//
// An environment whose Cast Swap engine does not declare the chosen mode
// (`castSwap.sourceModes`; absent = Faces hidden only) is named under the
// select: the trend can't be published until every environment can run it.

import { useId } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AdminTrendFaceMaskingSource, TrendEngineEnvironment } from "@/lib/api"
import { CLIP_PREPARATIONS } from "../clip-preparation"

interface Props {
  readonly value: AdminTrendFaceMaskingSource
  readonly onChange: (next: AdminTrendFaceMaskingSource) => void
  /** Each environment's engine, as reported (unknown while loading: nothing is flagged). */
  readonly envs?: readonly TrendEngineEnvironment[]
}

/** The environments whose engine cannot prepare a clip this way (none for Faces hidden). */
export function environmentsLacking(source: AdminTrendFaceMaskingSource, envs: readonly TrendEngineEnvironment[] | undefined): string[] {
  if (source === "faces" || !envs) return []
  return envs.filter((e) => !(e.supports.castSwap?.sourceModes ?? []).includes(source)).map((e) => e.env)
}

export function ClipPreparationSelect({ value, onChange, envs }: Props) {
  const id = useId()
  const hint = CLIP_PREPARATIONS.find((c) => c.value === value)?.hint
  const lacking = environmentsLacking(value, envs)
  return (
    <div className="flex flex-col gap-1 text-sm sm:w-1/2 sm:pr-1.5">
      <label htmlFor={id} className="font-medium">
        Clip preparation
      </label>
      <Select value={value} onValueChange={(v) => onChange(v as AdminTrendFaceMaskingSource)}>
        <SelectTrigger id={id} className="h-9" aria-describedby={`${id}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CLIP_PREPARATIONS.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </span>
      {lacking.length > 0 && (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Not supported yet by the Cast Swap engine of: {lacking.join(", ")}. The trend can't be published until it is.
        </span>
      )}
    </div>
  )
}
