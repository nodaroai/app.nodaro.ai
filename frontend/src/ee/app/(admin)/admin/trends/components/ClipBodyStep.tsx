// "Body from the clip" (`steps.clipBody`): for a person role whose Outfit is
// new and whose Body or Hair is from the clip, the engine redraws the role's
// reference from a frame of the clip. Left out, each engine applies its own
// default — and the setting is shared by environments whose engines read an
// absent key differently (an earlier engine runs it, a newer one does not), so
// what the admin picks is always saved as it is (`{ mode }`), never dropped
// because it matches this environment's default. While unset the switch says
// this engine's default (`defaults.clipBody.mode`; an earlier engine that
// answers no mode: On), or "the engine's default" while that is unknown;
// "Use the engine's default" removes the key.
//
// - The switch is
//   choosable whatever the environments declare: Off is safe everywhere (an
//   engine without the step has it stripped and does not run it). Beside it,
//   where the step runs and where it does not yet.
// - A pick is stored as `{ mode }` (Off drops any prompt).
// - A prompt of its own replaces the engine's default (shown as the
//   placeholder, read from the engine's defaults at run time, never written
//   here); emptied, it goes (the mode stays). Offered only once every environment's engine
//   runs the step (`promptOffered`): the server refuses it otherwise. One set
//   before can always be removed. It may name {subject}, {body} and {hair}
//   only, said here as it is typed (the save refuses any other).

import { useId } from "react"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { CLIP_BODY_PLACEHOLDERS, CLIP_BODY_PROMPT_MAX, type CastSwapStepsProblem, type ClipBodySetting } from "@/lib/api"
import { Problems } from "./LlmStepEditor"

interface Props {
  /** The setting; undefined = the engine's default (on). */
  readonly value: ClipBodySetting | undefined
  /** The next setting; undefined = removed (the engine's default). */
  readonly onChange: (next: ClipBodySetting | undefined) => void
  /** The engine's default image prompt (unknown while loading, or from an engine without the step). */
  readonly defaultPrompt: string | undefined
  /** This environment's engine's default mode (`clipBodyDefaultMode`): what an unset step does; undefined while unknown. */
  readonly defaultMode: ClipBodySetting["mode"] | undefined
  /** Whether a prompt of its own may be written: the steps are offered and every environment's engine runs it. */
  readonly promptOffered: boolean
  /** The environments whose engine runs it (unknown while loading). */
  readonly runsIn: readonly string[] | undefined
  /** The environments whose engine does not run it yet (unknown while loading). */
  readonly notYetIn: readonly string[] | undefined
  /** The check's problems for this step, their paths relative to it ("prompt", …). */
  readonly problems: readonly CastSwapStepsProblem[]
}

export const CLIP_BODY_HINT = "For a person whose Outfit is new and Body or Hair is from the clip."

const PLACEHOLDER_CODE = "clip_body_placeholder"

/** Whether the setting needs every environment's engine to run the step: only On with a prompt of its own. */
export function clipBodyNeedsEngine(c: ClipBodySetting | undefined): boolean {
  return c?.mode === "on" && c.prompt !== undefined
}

/** The `{word}` placeholders in `prompt` the engine does not fill (exact case), each once, in order. */
export function unknownClipBodyPlaceholders(prompt: string): string[] {
  const names = [...prompt.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map((m) => m[1]!)
  return [...new Set(names.filter((n) => !(CLIP_BODY_PLACEHOLDERS as readonly string[]).includes(n)))]
}

/**
 * This environment's engine's default for an unset "Body from the clip", for display only: its defaults'
 * `clipBody.mode` (an engine that answers the step with no mode runs it: On); undefined while unknown.
 */
export function clipBodyDefaultMode(defaults: { readonly mode?: ClipBodySetting["mode"] } | undefined): ClipBodySetting["mode"] | undefined {
  if (!defaults) return undefined
  return defaults.mode ?? "on"
}

/** The setting as picked: always its explicit mode (the row is shared), On with the prompt as typed (empty: none). */
function withPrompt(mode: ClipBodySetting["mode"], prompt: string | undefined): ClipBodySetting {
  const kept = prompt !== undefined && prompt.trim() !== "" ? prompt : undefined
  if (mode === "off") return { mode: "off" }
  return kept !== undefined ? { mode: "on", prompt: kept } : { mode: "on" }
}

/** "Runs in: staging · Not yet in: production"; null while the environments are unknown. */
function whereItRuns(runsIn: readonly string[] | undefined, notYetIn: readonly string[] | undefined): string | null {
  if (!runsIn || !notYetIn) return null
  const parts = [
    ...(runsIn.length > 0 ? [`Runs in: ${runsIn.join(", ")}`] : []),
    ...(notYetIn.length > 0 ? [`Not yet in: ${notYetIn.join(", ")}`] : []),
  ]
  return parts.length > 0 ? parts.join(" · ") : null
}

export function ClipBodyStep({ value, onChange, defaultPrompt, defaultMode, promptOffered, runsIn, notYetIn, problems }: Props) {
  const id = useId()
  const on = value ? value.mode === "on" : defaultMode === "on"
  const state = value ? (on ? "On" : "Off") : defaultMode ? `${on ? "On" : "Off"} (the engine's default)` : "The engine's default"
  const known = runsIn !== undefined && notYetIn !== undefined
  const where = whereItRuns(runsIn, notYetIn)
  const unknown = unknownClipBodyPlaceholders(value?.prompt ?? "")
  const own: CastSwapStepsProblem[] =
    unknown.length > 0
      ? [
          {
            path: "prompt",
            code: PLACEHOLDER_CODE,
            message: `Unknown placeholder ${unknown.map((n) => `{${n}}`).join(", ")}: the image prompt may name {subject}, {body} and {hair} only.`,
          },
        ]
      : []
  // The placeholder rule is said here as it is typed; the check's copy of it is not said twice.
  const shown = [...own, ...problems.filter((p) => p.code !== PLACEHOLDER_CODE)]
  const stalePrompt = !promptOffered && value?.prompt !== undefined
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs text-muted-foreground">{CLIP_BODY_HINT}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <Switch
            aria-label="Body from the clip"
            checked={on}
            disabled={!known}
            onCheckedChange={(checked) => onChange(withPrompt(checked ? "on" : "off", value?.prompt))}
          />
          <span className="font-medium">{state}</span>
        </label>
        {value && (
          <button type="button" className="min-h-9 text-xs underline" onClick={() => onChange(undefined)}>
            Use the engine's default
          </button>
        )}
        {where && <span className="text-xs text-muted-foreground">{where}</span>}
      </div>
      {stalePrompt && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          An image prompt of its own needs every environment's engine to run the step.{" "}
          <button type="button" className="min-h-9 underline" onClick={() => onChange(withPrompt(value?.mode ?? "on", undefined))}>
            Remove the prompt
          </button>
        </p>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={`${id}-prompt`} className="text-sm font-medium">
          Image prompt
        </label>
        <Textarea
          id={`${id}-prompt`}
          rows={5}
          maxLength={CLIP_BODY_PROMPT_MAX}
          value={value?.prompt ?? ""}
          placeholder={defaultPrompt}
          disabled={!promptOffered || !on}
          aria-describedby={`${id}-prompt-hint`}
          onChange={(e) => onChange(withPrompt("on", e.target.value))}
        />
        <span id={`${id}-prompt-hint`} className="text-xs text-muted-foreground">
          Empty: the engine's default (shown greyed out above). It may name {"{subject}"}, {"{body}"} and {"{hair}"}. At most{" "}
          {CLIP_BODY_PROMPT_MAX.toLocaleString("en-US")} characters.
        </span>
        <Problems list={shown} />
      </div>
    </div>
  )
}
