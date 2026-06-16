import { Check, Loader2 } from "lucide-react"
import { presetState } from "./preset-state"

/**
 * The shared "quick preset" chip row used by every sibling studio's asset and
 * motion tabs (object / location / creature). Each chip reflects its live state
 * via the `presetState` helper:
 *  - `creating` → spinner + disabled (a generation for that name is in flight,
 *    including the optimistic placeholder shown the instant the user clicks);
 *  - `created`  → ✓ + disabled (an asset with that name already exists);
 *  - `idle`     → clickable, with a tactile `active:` press response.
 *
 * Character Studio renders its own bar (`character-studio/generation-bar.tsx`)
 * because it also shows per-model credit costs, but it derives chip state from
 * the SAME `presetState` helper, so the two stay in lockstep.
 */
interface PresetChipsProps {
  readonly presets: readonly string[]
  /** Lowercased names already in the tab's grid. */
  readonly createdNames: ReadonlySet<string>
  /** Lowercased names with a generation in flight (real OR optimistic). */
  readonly busyNames: ReadonlySet<string>
  /** Hard-disable every chip (e.g. while the main image is being approved). */
  readonly disabled?: boolean
  /** Tooltip shown on every chip while the whole bar is `disabled` — explains
   *  WHY (e.g. "Approve a main image first"). */
  readonly disabledHint?: string
  readonly onPick: (preset: string) => void
}

export function PresetChips({ presets, createdNames, busyNames, disabled, disabledHint, onPick }: PresetChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {presets.map((p) => {
        const st = presetState(p, createdNames, busyNames)
        const inactive = st !== "idle"
        return (
          <button
            key={p}
            type="button"
            data-state={st}
            disabled={disabled || inactive}
            title={
              disabled
                ? disabledHint
                : st === "created"
                  ? `${p} — already generated`
                  : st === "creating"
                    ? `${p} — generating…`
                    : `Generate ${p}`
            }
            onClick={() => onPick(p)}
            className="px-3 py-1 text-[11px] rounded bg-[#1a1d27] hover:bg-[#1e293b] border border-[#1e293b] text-slate-300 inline-flex items-center gap-1.5 transition-transform active:scale-95 disabled:active:scale-100 disabled:opacity-40 disabled:cursor-not-allowed data-[state=created]:text-emerald-300/80 data-[state=created]:border-emerald-700/40"
          >
            {st === "creating" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {st === "created" && <Check className="w-2.5 h-2.5" />}
            {p}
          </button>
        )
      })}
    </div>
  )
}
