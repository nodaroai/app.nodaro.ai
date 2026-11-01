// The shot list step of a Nodaro Motion run's preparation (`steps.shotList`):
// the clip described shot by shot (the platform measures where the cuts are),
// per style.
//
// - Precise: Off until the admin turns it On (the key left out = Off). On
//   writes `{ mode: "on" }`, with an LLM of its own once one is edited.
// - Flex: always On (the engine refuses Off, `shot_list_flex_always_on`): only
//   its LLM can be set.
//
// The defaults (Precise off, Flex on, the engine's LLM) are never written: a
// style at its defaults is left out, so nothing needs an engine that runs the
// step. Anything else is offered only once every environment's engine declares
// `castSwap.shotList` (`offered`); otherwise greyed out, naming the
// environments, with a set value still removable.

import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { CastSwapStepDefaults, CastSwapStepsProblem, LlmStepSetting, ShotListSetting, ShotListStyle } from "@/lib/api"
import type { AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"
import { normaliseShotList, shotListNeedsEngine } from "../shot-list"
import { LlmStepEditor, Problems } from "./LlmStepEditor"

const SHOT_LIST_HINT =
  "The clip described shot by shot, from the cuts measured in the file, with every role placed (or said to be absent) in each shot. Flex always makes one; Precise only when turned on."

const LENGTH_NOTE = "the run caps it further: the room the engine's prompt leaves"

interface Props {
  /** As stored; undefined = the defaults. */
  readonly value: ShotListSetting | undefined
  readonly onChange: (next: ShotListSetting | undefined) => void
  /** The engine's defaults (undefined: greyed out). */
  readonly defaults: CastSwapStepDefaults["defaults"]["shotList"] | undefined
  readonly models: readonly AdminLlmModel[] | undefined
  /** Every environment's engine runs the step (anything but the defaults may be set). */
  readonly offered: boolean
  /** The environments whose engine cannot run it (named while greyed out; unknown while loading). */
  readonly notYetIn: readonly string[] | undefined
  /** The check's problems under `shotList`, their paths relative to it. */
  readonly problems: readonly CastSwapStepsProblem[]
}

/** The problems under `prefix`, their paths made relative to it. */
function under(problems: readonly CastSwapStepsProblem[], prefix: string): CastSwapStepsProblem[] {
  return problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`)).map((p) => ({ ...p, path: p.path.slice(prefix.length + 1) }))
}

export function ShotListStep({ value, onChange, defaults, models, offered, notYetIn, problems }: Props) {
  const id = useId()
  const usable = offered && !!defaults
  const set = (style: ShotListStyle, next: { mode: "on" | "off"; llm?: LlmStepSetting } | undefined) => {
    const merged: ShotListSetting = { ...(value ?? {}) }
    if (next) merged[style] = next
    else delete merged[style]
    onChange(normaliseShotList(merged))
  }
  const preciseOn = value?.precise?.mode === "on"
  const stale = !usable && shotListNeedsEngine(value)
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">{SHOT_LIST_HINT}</p>
      {notYetIn && notYetIn.length > 0 && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          The Cast Swap engine of {notYetIn.join(", ")} cannot run the shot list yet: its defaults apply.
          {stale && (
            <>
              {" "}
              <button type="button" className="min-h-9 underline" onClick={() => onChange(undefined)}>
                Back to the defaults
              </button>
            </>
          )}
        </p>
      )}

      <div role="group" aria-labelledby={`${id}-precise`} className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h5 id={`${id}-precise`} className="text-sm font-semibold">
            Precise
          </h5>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <Switch
              aria-label="Precise shot list"
              checked={preciseOn}
              disabled={!usable}
              onCheckedChange={(checked) => set("precise", checked ? { ...(value?.precise ?? {}), mode: "on" } : undefined)}
            />
            <span className="font-medium">{preciseOn ? "On" : "Off"}</span>
          </label>
        </div>
        {preciseOn && defaults && (
          <StyleLlm
            label="Precise"
            value={value?.precise?.llm}
            defaults={defaults.precise.llm}
            models={models}
            disabled={!usable}
            problems={under(problems, "precise.llm")}
            onChange={(llm) => set("precise", { mode: "on", ...(llm ? { llm } : {}) })}
          />
        )}
        <Problems list={under(problems, "precise").filter((p) => !/^llm(\.|$)/.test(p.path))} />
      </div>

      <div role="group" aria-labelledby={`${id}-flex`} className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h5 id={`${id}-flex`} className="text-sm font-semibold">
            Flex
          </h5>
          <span className="text-xs text-muted-foreground">Always on: Flex runs are Full depth with a shot list.</span>
        </div>
        {defaults && (
          <StyleLlm
            label="Flex"
            value={value?.flex?.llm}
            defaults={defaults.flex.llm}
            models={models}
            disabled={!usable}
            problems={under(problems, "flex.llm")}
            onChange={(llm) => set("flex", llm ? { mode: "on", llm } : undefined)}
          />
        )}
        <Problems list={under(problems, "flex").filter((p) => !/^llm(\.|$)/.test(p.path))} />
      </div>
    </div>
  )
}

/** One style's LLM: the engine's default until edited; "Use the default" removes it. */
function StyleLlm({
  label,
  value,
  defaults,
  models,
  disabled,
  problems,
  onChange,
}: {
  readonly label: string
  readonly value: LlmStepSetting | undefined
  readonly defaults: LlmStepSetting & { instructions: string }
  readonly models: readonly AdminLlmModel[] | undefined
  readonly disabled: boolean
  readonly problems: readonly CastSwapStepsProblem[]
  readonly onChange: (next: LlmStepSetting | undefined) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{value ? "Its own LLM:" : "The engine's default LLM (edit to set your own):"}</span>
        {value && (
          <Button type="button" size="sm" variant="ghost" className="min-h-9" aria-label={`${label} shot list: use the engine's default`} onClick={() => onChange(undefined)}>
            Use the default
          </Button>
        )}
      </div>
      <LlmStepEditor
        value={value}
        defaults={defaults}
        models={models}
        showInputs
        lengthNote={LENGTH_NOTE}
        problems={problems}
        disabled={disabled}
        onChange={(llm) => onChange(llm)}
      />
    </div>
  )
}
