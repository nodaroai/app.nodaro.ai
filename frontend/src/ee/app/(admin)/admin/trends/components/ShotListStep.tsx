// The shot list step of a Video Remake run's preparation (`steps.shotList`):
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
//
// "Speech in the script" (decided 2026-11-18, `speech`; Admin → Video Remake
// and a trend's editor alike): per style, beside its model picker, what each
// shot line says of the speech heard — Off (never written), who speaks and
// when, or that and the words — and, while it is not Off, what of the other
// mouths (`speechMouth`: closed when not speaking with singing left alone, the
// default and never written; closed when not speaking; nothing). Offered only
// once every environment's engine declares `castSwap.shotListSpeech` and its
// platform claims `shotListSpeech`; otherwise disabled with a short note, a set
// value still removable (Off stays choosable). On Admin → Video Remake alone
// (`allowLlmNodeOnlyMedia`) the shot list's model picker offers a model that
// reads video on the LLM nodes only (Gemini 4 Hydrogen, decided 2026-11-18); a
// trend's editor never does.

import { useId, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { CastSwapStepDefaults, CastSwapStepsProblem, LlmStepSetting, ShotListSetting, ShotListSpeech, ShotListSpeechMouth, ShotListStyle, ShotListStyleSetting } from "@/lib/api"
import type { AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"
import { SHOT_LIST_SPEECH_MOUTH_OPTIONS, SHOT_LIST_SPEECH_OPTIONS, normaliseShotList, shotListNeedsEngine } from "../shot-list"
import { LlmStepEditor, Problems } from "./LlmStepEditor"
import { SHARED_SETTING_ENVIRONMENTS } from "../clip-preparation"

const SHOT_LIST_HINT =
  "The clip described shot by shot, from the cuts measured in the file, with every role placed (or said to be absent) in each shot. Flex always makes one; Precise only when turned on."

const LENGTH_NOTE = "the run caps it further: the room the engine's prompt leaves"

/** Which environments cannot take "Speech in the script" yet. */
export interface ShotListSpeechOffer {
  /** The environments whose engine or platform cannot take it (unknown while loading: not offered). */
  readonly missing: { readonly engine: readonly string[]; readonly platform: readonly string[] } | undefined
}

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
  /** "Speech in the script" per style; left out: not shown. */
  readonly speech?: ShotListSpeechOffer
  /** Offer a model that reads video on the LLM nodes only (Admin → Video Remake alone). */
  readonly allowLlmNodeOnlyMedia?: boolean
}

/** The problems under `prefix`, their paths made relative to it. */
function under(problems: readonly CastSwapStepsProblem[], prefix: string): CastSwapStepsProblem[] {
  return problems.filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`)).map((p) => ({ ...p, path: p.path.slice(prefix.length + 1) }))
}

export function ShotListStep({ value, onChange, defaults, models, offered, notYetIn, problems, speech, allowLlmNodeOnlyMedia = false }: Props) {
  const id = useId()
  const usable = offered && !!defaults
  const speechMissing = speech?.missing
  const speechOffered = usable && !!speechMissing && speechMissing.engine.length === 0 && speechMissing.platform.length === 0
  const set = (style: ShotListStyle, next: ShotListStyleSetting | undefined) => {
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
            allowLlmNodeOnlyMedia={allowLlmNodeOnlyMedia}
            llmNodeOnlyMediaHeldIn={allowLlmNodeOnlyMedia ? (speechMissing ? speechMissing.platform : SHARED_SETTING_ENVIRONMENTS) : []}
            onChange={(llm) => set("precise", { mode: "on", ...(llm ? { llm } : {}), ...speechOf(value?.precise) })}
            besideModel={
              speech && (
                <SpeechSelect
                  style="Precise"
                  value={value?.precise?.speech}
                  mouth={value?.precise?.speechMouth}
                  offered={speechOffered}
                  missing={speechMissing}
                  onChange={(next) => set("precise", { ...(value?.precise ?? {}), mode: "on", speech: next })}
                  onMouthChange={(next) => set("precise", { ...(value?.precise ?? {}), mode: "on", speechMouth: next })}
                />
              )
            }
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
            allowLlmNodeOnlyMedia={allowLlmNodeOnlyMedia}
            llmNodeOnlyMediaHeldIn={allowLlmNodeOnlyMedia ? (speechMissing ? speechMissing.platform : SHARED_SETTING_ENVIRONMENTS) : []}
            onChange={(llm) => set("flex", { mode: "on", ...(llm ? { llm } : {}), ...speechOf(value?.flex) })}
            besideModel={
              speech && (
                <SpeechSelect
                  style="Flex"
                  value={value?.flex?.speech}
                  mouth={value?.flex?.speechMouth}
                  offered={speechOffered}
                  missing={speechMissing}
                  onChange={(next) => set("flex", { ...(value?.flex ?? {}), mode: "on", speech: next })}
                  onMouthChange={(next) => set("flex", { ...(value?.flex ?? {}), mode: "on", speechMouth: next })}
                />
              )
            }
          />
        )}
        <Problems list={under(problems, "flex").filter((p) => !/^llm(\.|$)/.test(p.path))} />
      </div>
    </div>
  )
}

/** A style's speech (and its mouths) as kept beside an edit of its LLM (none, or "off": nothing). */
function speechOf(step: ShotListStyleSetting | undefined): { speech?: ShotListSpeech; speechMouth?: ShotListSpeechMouth } {
  if (step?.speech === undefined || step.speech === "off") return {}
  return { speech: step.speech, ...(step.speechMouth !== undefined ? { speechMouth: step.speechMouth } : {}) }
}

/**
 * "Speech in the script" for one style: Off (the value left out) or what each shot line says of the speech heard;
 * while it is not Off, what of the other mouths (its default, "spoken", left out). Not offered: disabled with a short
 * note naming the environments; a value already set stays shown and can be set back to Off.
 */
function SpeechSelect({
  style,
  value,
  mouth,
  offered,
  missing,
  onChange,
  onMouthChange,
}: {
  readonly style: string
  readonly value: ShotListSpeech | undefined
  readonly mouth: ShotListSpeechMouth | undefined
  readonly offered: boolean
  readonly missing: ShotListSpeechOffer["missing"]
  readonly onChange: (next: ShotListSpeech) => void
  readonly onMouthChange: (next: ShotListSpeechMouth) => void
}) {
  const id = useId()
  const current = value ?? "off"
  const waiting = missing ? [...new Set([...missing.engine, ...missing.platform])] : []
  return (
    <>
      <label htmlFor={`${id}-speech`} className="font-medium">
        Speech in the script
      </label>
      <select
        id={`${id}-speech`}
        aria-label={`${style} shot list: speech in the script`}
        className="h-9 min-h-9 rounded-md border bg-background px-2 text-sm"
        value={current}
        disabled={!offered && current === "off"}
        onChange={(e) => onChange(e.target.value as ShotListSpeech)}
      >
        {SHOT_LIST_SPEECH_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} disabled={!offered && o.value !== "off" && o.value !== current}>
            {o.label}
          </option>
        ))}
      </select>
      {current !== "off" && (
        <>
          <label htmlFor={`${id}-mouth`} className="font-medium">
            Other mouths
          </label>
          <select
            id={`${id}-mouth`}
            aria-label={`${style} shot list: other mouths`}
            className="h-9 min-h-9 rounded-md border bg-background px-2 text-sm"
            value={mouth ?? "spoken"}
            disabled={!offered}
            onChange={(e) => onMouthChange(e.target.value as ShotListSpeechMouth)}
          >
            {SHOT_LIST_SPEECH_MOUTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </>
      )}
      {offered ? (
        <span className="text-xs text-muted-foreground">Each shot line ends with who speaks and when{current === "words" ? ", and the words heard" : ""}.</span>
      ) : (
        <span role="status" className="text-xs text-amber-700 dark:text-amber-400">
          Not available yet{waiting.length > 0 ? ` in ${waiting.join(", ")}` : ""}.
        </span>
      )}
    </>
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
  allowLlmNodeOnlyMedia,
  llmNodeOnlyMediaHeldIn,
  besideModel,
}: {
  readonly label: string
  readonly value: LlmStepSetting | undefined
  readonly defaults: LlmStepSetting & { instructions: string }
  readonly models: readonly AdminLlmModel[] | undefined
  readonly disabled: boolean
  readonly problems: readonly CastSwapStepsProblem[]
  readonly onChange: (next: LlmStepSetting | undefined) => void
  readonly allowLlmNodeOnlyMedia?: boolean
  readonly llmNodeOnlyMediaHeldIn?: readonly string[]
  readonly besideModel?: ReactNode
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
        allowLlmNodeOnlyMedia={allowLlmNodeOnlyMedia}
        llmNodeOnlyMediaHeldIn={llmNodeOnlyMediaHeldIn}
        besideModel={besideModel}
        onChange={(llm) => onChange(llm)}
      />
    </div>
  )
}
