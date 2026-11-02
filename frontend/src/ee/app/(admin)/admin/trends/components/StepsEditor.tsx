// The preparation steps of a Nodaro Motion run (`steps`, beside the face
// masking, never inside it): a trend's (Admin → Trends, saved with the draft)
// or one engine's for the runs people start themselves (Admin → Nodaro
// Motion). Left out, or `{}`, every run is today's exactly.
//
// Four sections:
// 1. Reference sheets: "Today's sheet" (the key left out) or "By the photos
//    (rules)": an LLM labels each role photo (the labeller, LlmStepEditor.tsx
//    with no input boxes: it reads the role pictures only) and the rules
//    table (SheetRulesTable.tsx) maps what they cover to a layout. Choosing
//    the rules seeds the engine's default rules.
// 2. Engine prompt: Template (the key left out) or LLM (TextStepSwitch.tsx).
// 3. Scene description: only for Full depth with the scene from a
//    description (`source`, `scene`); Template or LLM.
// 4. Body from the clip (ClipBodyStep.tsx): on / off and its image prompt.
//    Unset reads the engine's default (`defaults.clipBody.mode`; Off while unknown). Off is choosable whatever the
//    environments declare; a prompt of its own only once every environment's
//    engine also declares `castSwap.clipBodySheet`.
// 5. Shot list (ShotListStep.tsx): per style — Precise off / on, Flex always
//    on — and each one's LLM; anything but the defaults only once every
//    environment's engine also declares `castSwap.shotList`.
// 6. Style the role pictures (StyleRefsStep.tsx): for runs with an art style,
//    each role's picture redrawn in that style first. Off until turned on
//    (always saved as picked), its Send and image instruction; On only once
//    every environment's engine also declares `castSwap.styleRefs`.
// A section whose step the engine marks not critical (`critical`) says it is
// skipped when it fails: the run goes on without it.
//
// The engine's defaults, texts and layout prompts are read at run time
// (`fetchStepDefaults`); none is written here. The setting is checked against
// the platform and the engine as it is edited (`checkSteps`, debounced), and
// each problem is said under its place.
//
// Offered only once every environment's engine takes the steps
// (`environmentsThatCannotTakeSteps`); otherwise greyed out, naming the
// environments (as the face mesh switch is), with only removing a step left
// choosable. Nothing is written until the admin picks something: loading a
// draft or the defaults never changes the setting.

import { useEffect, useId, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import {
  checkSteps,
  fetchStepDefaults,
  type AdminTrendEngine,
  type AdminTrendFaceMaskingSource,
  type AdminTrendFullDepthScene,
  type CastSwapStepDefaults,
  type CastSwapSteps,
  type CastSwapStepsProblem,
  type NodaroMotionEngine,
  type SkippableStep,
  type TrendEngineEnvironment,
} from "@/lib/api"
import { useAdminLlmModels, type AdminLlmModel } from "@/ee/hooks/queries/use-admin-queries"
import {
  environmentsThatCannotTakeClipBody,
  environmentsThatCannotTakeShotList,
  environmentsThatCannotTakeSteps,
  environmentsThatCannotTakeStyleRefs,
  environmentsThatTakeClipBody,
} from "../clip-preparation"
import { fullDepthSceneDescribes } from "@nodaro/render-rules"
import { ClipBodyStep, clipBodyDefaultMode, clipBodyNeedsEngine } from "./ClipBodyStep"
import { normaliseShotList, shotListNeedsEngine } from "../shot-list"
import { ShotListStep } from "./ShotListStep"
import { StyleRefsStep, styleRefsNeedsEngine } from "./StyleRefsStep"
import { LABELLER_INPUTS, LlmStepEditor, Problems } from "./LlmStepEditor"
import { SheetRulesTable } from "./SheetRulesTable"
import { TextStepSwitch } from "./TextStepSwitch"

/** How long the check waits after the last edit. */
export const STEPS_CHECK_DEBOUNCE_MS = 400

/** Whether anything is set: `{}` (or undefined) is today's run. */
export function stepsSet(s: CastSwapSteps | undefined | null): s is CastSwapSteps {
  return (
    !!s &&
    (s.sheets !== undefined || s.enginePrompt !== undefined || s.sceneDescription !== undefined || s.clipBody !== undefined || normaliseShotList(s.shotList) !== undefined || s.styleRefs !== undefined)
  )
}

/** The setting as saved: undefined when nothing is set, else a copy without its absent keys. */
export function normaliseSteps(s: CastSwapSteps | undefined | null): CastSwapSteps | undefined {
  if (!stepsSet(s)) return undefined
  return structuredClone({
    ...(s.sheets !== undefined ? { sheets: s.sheets } : {}),
    ...(s.enginePrompt !== undefined ? { enginePrompt: s.enginePrompt } : {}),
    ...(s.sceneDescription !== undefined ? { sceneDescription: s.sceneDescription } : {}),
    ...(s.clipBody !== undefined ? { clipBody: s.clipBody } : {}),
    ...(normaliseShotList(s.shotList) ? { shotList: normaliseShotList(s.shotList) } : {}),
    // Kept as picked, Off included: never trimmed to a default (the setting is shared by environments).
    ...(s.styleRefs !== undefined ? { styleRefs: s.styleRefs } : {}),
  })
}

/** The problems under `prefix`, their paths made relative to it. */
function under(problems: readonly CastSwapStepsProblem[], prefix: string): CastSwapStepsProblem[] {
  return problems
    .filter((p) => p.path === prefix || p.path.startsWith(`${prefix}.`))
    .map((p) => ({ ...p, path: p.path.slice(prefix.length + 1) }))
}

/** The setting edited as it settles (debounced), as a string: equal strings = nothing new to check. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

interface Props {
  /** The setting; undefined = none (today's run). */
  readonly value: CastSwapSteps | undefined
  /** The next setting; undefined when nothing is left set (the key is removed). */
  readonly onChange: (next: CastSwapSteps | undefined) => void
  /** Each environment's engine, as reported (unknown while loading: greyed out). */
  readonly envs: readonly TrendEngineEnvironment[] | undefined
  /** The engine whose defaults and checks apply (a public or an internal id). */
  readonly engine: NodaroMotionEngine | AdminTrendEngine
  /** How the clip is prepared; the scene description applies to Full depth only. */
  readonly source?: AdminTrendFaceMaskingSource
  /** Full depth's scene source; the scene description applies to one written in words ("description", "description-and-original"). */
  readonly scene?: AdminTrendFullDepthScene
}

const NOT_CRITICAL = "Not critical — skipped if it fails"

export function StepsEditor({ value, onChange, envs, engine, source, scene }: Props) {
  const missing = environmentsThatCannotTakeSteps(envs)
  const offered = missing !== undefined && missing.length === 0
  const defaultsQuery = useQuery({
    queryKey: ["admin", "nodaro-motion", "steps", "defaults", engine],
    queryFn: () => fetchStepDefaults(engine),
    enabled: hasAdmin() && offered,
    staleTime: 60_000,
  })
  // The engine answered that it takes no steps (this environment's plugin is older).
  const engineLacks = offered && defaultsQuery.data === null
  const defaults = offered && defaultsQuery.data ? defaultsQuery.data : undefined
  // The models list and the check are read only for an editor that is offered.
  const [models, setModels] = useState<readonly AdminLlmModel[] | undefined>(undefined)
  const normalised = useMemo(() => normaliseSteps(value), [value])
  const current = normalised ? JSON.stringify(normalised) : ""
  const settled = useSettled(current, STEPS_CHECK_DEBOUNCE_MS)
  const check = useQuery({
    queryKey: ["admin", "nodaro-motion", "steps", "check", engine, settled],
    queryFn: () => checkSteps(engine, JSON.parse(settled) as CastSwapSteps),
    enabled: hasAdmin() && !!defaults && settled !== "",
    staleTime: Infinity,
  })
  // Only the problems of the setting as it stands now (never a former one's while the next is checked).
  const problems = defaults && check.data && settled === current ? check.data : []

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="steps-editor">
      <div>
        <h3 className="text-sm font-semibold">Preparation steps</h3>
        <p className="text-xs text-muted-foreground">
          How the reference sheets, the engine prompt, the scene description, the body from the clip, the shot list and the styled role pictures are made. Left as they are, runs are prepared as today.
        </p>
      </div>
      {missing === undefined ? (
        <p className="text-xs text-muted-foreground">Checking the environments…</p>
      ) : missing.length > 0 ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          The Cast Swap engine of {missing.join(", ")} cannot take preparation steps yet
          {stepsSet(value) &&
          (stepsSet({ ...value, clipBody: undefined, shotList: undefined, styleRefs: undefined }) ||
            clipBodyNeedsEngine(value.clipBody) ||
            shotListNeedsEngine(value.shotList) ||
            styleRefsNeedsEngine(value.styleRefs))
            ? ": remove them to publish or save"
            : ""}
          .
        </p>
      ) : engineLacks ? (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
          This environment's engine does not take preparation steps yet.
        </p>
      ) : defaultsQuery.error ? (
        <p className="text-xs text-destructive">{defaultsQuery.error.message}</p>
      ) : !defaults ? (
        <p className="text-xs text-muted-foreground">Loading the engine's defaults…</p>
      ) : null}
      {defaults && <ModelsReader onModels={setModels} />}
      <Sections
        value={value}
        onChange={onChange}
        sceneShown={source === "full-depth" && fullDepthSceneDescribes(scene)}
        defaults={defaults}
        models={defaults ? models : undefined}
        problems={problems}
        clipBodyMissing={environmentsThatCannotTakeClipBody(envs)}
        clipBodyHas={environmentsThatTakeClipBody(envs)}
        shotListMissing={environmentsThatCannotTakeShotList(envs)}
        styleRefsMissing={environmentsThatCannotTakeStyleRefs(envs)}
      />
    </div>
  )
}

/** Reads the admin LLM models list (mounted only for an editor that is offered). */
function ModelsReader({ onModels }: { readonly onModels: (models: readonly AdminLlmModel[] | undefined) => void }) {
  const { data } = useAdminLlmModels()
  useEffect(() => onModels(data?.models), [data, onModels])
  return null
}

/** The three sections; greyed out with no `defaults` (only removing a step is left choosable). */
function Sections({
  value,
  onChange,
  sceneShown,
  defaults,
  models,
  problems,
  clipBodyMissing,
  clipBodyHas,
  shotListMissing,
  styleRefsMissing,
}: {
  readonly value: CastSwapSteps | undefined
  readonly onChange: (next: CastSwapSteps | undefined) => void
  readonly sceneShown: boolean
  readonly defaults: CastSwapStepDefaults | undefined
  readonly models: readonly AdminLlmModel[] | undefined
  readonly problems: readonly CastSwapStepsProblem[]
  /** The environments whose engine cannot take Body from the clip (unknown while loading). */
  readonly clipBodyMissing: readonly string[] | undefined
  /** The environments whose engine runs it (unknown while loading). */
  readonly clipBodyHas: readonly string[] | undefined
  /** The environments whose engine cannot take the shot list (unknown while loading). */
  readonly shotListMissing: readonly string[] | undefined
  /** The environments whose engine cannot take Style the role pictures (unknown while loading). */
  readonly styleRefsMissing: readonly string[] | undefined
}) {
  const id = useId()
  const disabled = !defaults
  const set = (patch: Partial<CastSwapSteps>) => {
    const next: CastSwapSteps = { ...(value ?? {}), ...patch }
    for (const k of Object.keys(patch) as Array<keyof CastSwapSteps>) if (patch[k] === undefined) delete next[k]
    onChange(normaliseSteps(next))
  }
  const tag = (step: SkippableStep) => (defaults?.critical[step] === false ? NOT_CRITICAL : undefined)
  const sheets = value?.sheets
  const sheetsProblems = under(problems, "sheets")
  const enginePromptProblems = under(problems, "enginePrompt")
  const sceneProblems = under(problems, "sceneDescription")
  const clipBodyProblems = under(problems, "clipBody")
  const shotListProblems = under(problems, "shotList")
  const styleRefsProblems = under(problems, "styleRefs")
  const rest = problems.filter((p) => !/^(sheets|enginePrompt|sceneDescription|clipBody|shotList|styleRefs)(\.|$)/.test(p.path))

  return (
    <>
      <Section title="Reference sheets" tag={tag("reference-sheet")}>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="sr-only">Reference sheets</legend>
          <div className="flex flex-wrap gap-x-4">
            <Radio
              id={`${id}-sheets-today`}
              name={`${id}-sheets`}
              label="Today's sheet"
              checked={!sheets}
              disabled={disabled && !sheets}
              onSelect={() => set({ sheets: undefined })}
            />
            <Radio
              id={`${id}-sheets-rules`}
              name={`${id}-sheets`}
              label="By the photos (rules)"
              checked={!!sheets}
              disabled={disabled}
              onSelect={() => defaults && set({ sheets: { rules: structuredClone(defaults.defaultRules) } })}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {sheets
              ? "An LLM labels each role photo; the rules below pick the layout from what the photos cover."
              : "Each kind's sheet as today, with no labelling."}
          </span>
        </fieldset>
        {sheets && defaults && (
          <>
            <div role="group" aria-labelledby={`${id}-labeller`} className="flex min-w-0 flex-col gap-1">
              <h5 id={`${id}-labeller`} className="text-sm font-semibold">
                The labeller
              </h5>
              <p className="text-xs text-muted-foreground">Reads the role pictures and says what each one shows.</p>
              <LlmStepEditor
                value={sheets.labeller}
                defaults={defaults.defaults.labeller}
                models={models}
                showInputs={false}
                problems={under(sheetsProblems, "labeller")}
                onChange={(labeller) => set({ sheets: { ...sheets, labeller: { ...labeller, inputs: [...LABELLER_INPUTS] } } })}
              />
            </div>
            <SheetRulesTable
              value={sheets.rules}
              layouts={defaults.layouts}
              defaults={defaults.defaultRules}
              layoutPrompts={defaults.layoutPrompts}
              problems={under(sheetsProblems, "rules")}
              onChange={(rules) => set({ sheets: { ...sheets, rules } })}
            />
          </>
        )}
        <Problems list={sheetsProblems.filter((p) => !/^(labeller|rules)(\.|$)/.test(p.path))} />
      </Section>

      <Section title="Engine prompt" tag={tag("engine-prompt")}>
        <TextStepSwitch
          label="Engine prompt"
          value={value?.enginePrompt}
          defaults={defaults?.defaults.enginePrompt}
          models={models}
          lengthNote="the run caps it further: the engine's prompt cap"
          problems={under(enginePromptProblems, "llm")}
          disabled={disabled}
          onChange={(enginePrompt) => set({ enginePrompt })}
        />
        <Problems list={enginePromptProblems.filter((p) => !/^llm(\.|$)/.test(p.path))} />
      </Section>

      {sceneShown ? (
        <Section title="Scene description" tag={tag("scene-description")}>
          <TextStepSwitch
            label="Scene description"
            value={value?.sceneDescription}
            defaults={defaults?.defaults.sceneDescription}
            models={models}
            lengthNote="the run caps it further: 4,000 for a scene"
            problems={under(sceneProblems, "llm")}
            disabled={disabled}
            onChange={(sceneDescription) => set({ sceneDescription })}
          />
          <Problems list={sceneProblems.filter((p) => !/^llm(\.|$)/.test(p.path))} />
        </Section>
      ) : (
        value?.sceneDescription && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            A scene description step is set, but this clip preparation writes no scene description, so it is not used.{" "}
            <button type="button" className="min-h-9 underline" onClick={() => set({ sceneDescription: undefined })}>
              Remove it
            </button>
          </p>
        )
      )}
      <Section title="Body from the clip" tag={tag("clip-body")}>
        <ClipBodyStep
          value={value?.clipBody}
          defaultPrompt={defaults?.defaults.clipBody?.prompt}
          defaultMode={clipBodyDefaultMode(defaults?.defaults.clipBody)}
          promptOffered={!disabled && clipBodyMissing !== undefined && clipBodyMissing.length === 0}
          runsIn={clipBodyHas}
          notYetIn={clipBodyMissing}
          problems={clipBodyProblems}
          onChange={(clipBody) => set({ clipBody })}
        />
      </Section>
      <Section title="Shot list" tag={tag("scene-description")}>
        <ShotListStep
          value={value?.shotList}
          defaults={defaults?.defaults.shotList}
          models={models}
          offered={!disabled && shotListMissing !== undefined && shotListMissing.length === 0 && !!defaults?.defaults.shotList}
          notYetIn={shotListMissing}
          problems={shotListProblems}
          onChange={(shotList) => set({ shotList })}
        />
      </Section>
      <Section title="Style the role pictures" tag={tag("style-refs")}>
        <StyleRefsStep
          value={value?.styleRefs}
          defaults={defaults?.defaults.styleRefs}
          offered={!disabled && styleRefsMissing !== undefined && styleRefsMissing.length === 0 && !!defaults?.defaults.styleRefs}
          notYetIn={styleRefsMissing}
          problems={styleRefsProblems}
          onChange={(styleRefs) => set({ styleRefs })}
        />
      </Section>
      <Problems list={rest} />
    </>
  )
}

function Section({ title, tag, children }: { readonly title: string; readonly tag?: string; readonly children: React.ReactNode }) {
  return (
    <section aria-label={`${title} step`} className="flex min-w-0 flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {tag && <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>}
      </div>
      {children}
    </section>
  )
}

function Radio({
  id,
  name,
  label,
  checked,
  disabled,
  onSelect,
}: {
  readonly id: string
  readonly name: string
  readonly label: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onSelect: () => void
}) {
  return (
    <div className="flex min-h-11 items-center gap-2">
      <input id={id} type="radio" name={name} className="h-4 w-4" checked={checked} disabled={disabled} onChange={onSelect} />
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
    </div>
  )
}
