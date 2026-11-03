// Admin → Nodaro Motion → Engine prompt: the Cast Swap engine's own prompt
// wording for every run people start themselves, per engine (Prism, Pulse)
// and style (Precise, Motion), part by part (the trend editor's rows,
// PromptPartRow.tsx). Empty uses the engine's default; "-" removes the part.
//
// Each tab shows the engine's answer for a sample run (one person, a clip with
// sound) with the tab's edits, asked again a moment after typing stops, so the
// assembled prompt and the problems follow the edits. Save sends the WHOLE
// setting (PUT /v1/admin/nodaro-motion/prompt-parts): the engine checks every
// engine and style first, and any problem keeps everything unsaved, shown in
// its own tab. The setting stores text only, so there is no "default changed"
// flag here.
//
// The tabs stay keyed by the run's style (Precise, Motion: how the overrides
// are stored), and each shows the parts of the prompt style that style runs
// with: Precise, the Precise prompt; Motion, the SAVED Motion setting's
// (left out: Flexible), on its saved clip preparation. Saving the Motion
// setting asks the previews again.
//
// The Motion tab, while its prompt is Flexible, also has the engine's Flex
// prompt wording (PromptWordingSelect.tsx, `nodaro_motion_prompt_wording`):
// Current (the default) or New, for every direct Flex run of that engine.
// The tab's preview follows the chosen wording before it is saved; Save saves
// a changed wording first (PUT /v1/admin/nodaro-motion/prompt-wording), so the
// overrides are then checked worded as the runs will be. "New" is greyed out
// until every environment's engine words it (the setting is shared; the
// server refuses the save otherwise). Precise never reads it.

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  PromptPartsInvalidError,
  isPromptPartsEngineOutOfDate,
  type AdminTrendEngine,
  type CastSwapPromptStyleId,
  type CastSwapPromptWordingId,
  type CastSwapStyleId,
  type NodaroMotionEngine,
  type NodaroMotionMotionEntry,
  type NodaroMotionPromptParts,
  type NodaroMotionPromptWording,
  type PromptPartProblem,
  type PromptPartTexts,
} from "@/lib/api"
import { useNodaroMotionMotion } from "@/ee/hooks/queries/use-nodaro-motion-motion"
import {
  useNodaroMotionPromptParts,
  useNodaroMotionPromptPreview,
  useSaveNodaroMotionPromptParts,
} from "@/ee/hooks/queries/use-nodaro-motion-prompt-parts"
import { useEngineEnvironments } from "@/ee/hooks/queries/use-admin-queries"
import { useNodaroMotionPromptWording, useSaveNodaroMotionPromptWording } from "@/ee/hooks/queries/use-nodaro-motion-prompt-wording"
import { AssembledPrompt, PromptPartRow, nonEmpty, partsShown } from "../../trends/components/PromptPartRow"
import { ENGINE_OUT_OF_DATE } from "../../trends/components/EnginePromptParts"
import { PromptWordingSelect } from "../../trends/components/PromptWordingSelect"
import { DIRECT_WORDING_NOTE, environmentsThatCannotUseNewWording } from "../../trends/prompt-wording"

const STYLE_LABELS: Readonly<Record<CastSwapStyleId, { label: string; hint: string }>> = {
  precise: { label: "Precise", hint: "Follows the clip exactly (the default)." },
  motion: { label: "Motion", hint: "Follows the clip's movement and takes the looks from the photos, more freely than Precise." },
}

const PROMPT_STYLE_NAMES: Readonly<Record<CastSwapPromptStyleId, string>> = { precise: "Precise", flexible: "Flexible" }

/** The prompt style a direct run of `style` is worded with: Precise's own; Motion's from its saved setting (left out: Flexible). */
export function promptStyleOfRun(style: CastSwapStyleId, motion: NodaroMotionMotionEntry | undefined): CastSwapPromptStyleId {
  return style === "precise" ? "precise" : (motion?.promptStyle ?? "flexible")
}

/** A tab's name: the run's style, and for Motion the prompt style its parts are. */
export function styleTabLabel(style: CastSwapStyleId, motion: NodaroMotionMotionEntry | undefined): string {
  const label = STYLE_LABELS[style]?.label ?? style
  return style === "motion" ? `${label} (${PROMPT_STYLE_NAMES[promptStyleOfRun(style, motion)]} prompt)` : label
}

/** The wording setting as it is saved: each engine on "new"; one on the current wording is left out. */
export function promptWordingToSave(draft: NodaroMotionPromptWording | null | undefined): NodaroMotionPromptWording {
  const out: NodaroMotionPromptWording = {}
  for (const [id, w] of Object.entries(draft ?? {}) as Array<[NodaroMotionEngine, CastSwapPromptWordingId | undefined]>) {
    if (w === "new") out[id] = "new"
  }
  return out
}

/** How long typing must stop before a tab asks the engine again. */
export const PREVIEW_DEBOUNCE_MS = 400

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** The setting as it is saved: each engine and style's non-empty texts, the empty ones left out. */
export function promptPartsToSave(draft: NodaroMotionPromptParts): NodaroMotionPromptParts {
  const out: NodaroMotionPromptParts = {}
  for (const [engine, styles] of Object.entries(draft) as Array<[NodaroMotionEngine, Partial<Record<CastSwapStyleId, PromptPartTexts>> | undefined]>) {
    const entry: Partial<Record<CastSwapStyleId, PromptPartTexts>> = {}
    for (const [style, texts] of Object.entries(styles ?? {}) as Array<[CastSwapStyleId, PromptPartTexts | undefined]>) {
      const kept = nonEmpty(texts ?? {})
      if (Object.keys(kept).length > 0) entry[style] = kept
    }
    if (Object.keys(entry).length > 0) out[engine] = entry
  }
  return out
}

export function PromptPartsTabs({ internalNames }: { readonly internalNames: Readonly<Record<AdminTrendEngine, string>> }) {
  const query = useNodaroMotionPromptParts()
  const save = useSaveNodaroMotionPromptParts()
  const motion = useNodaroMotionMotion().data?.motion ?? null
  const [draft, setDraft] = useState<NodaroMotionPromptParts>({})
  const [problems, setProblems] = useState<PromptPartProblem[]>([])
  const data = query.data

  useEffect(() => {
    if (data) setDraft(structuredClone(data.promptParts ?? {}))
  }, [data])

  const saved = useMemo(() => JSON.stringify(promptPartsToSave(data?.promptParts ?? {})), [data])
  const next = promptPartsToSave(draft)
  const partsChanged = JSON.stringify(next) !== saved

  // The Flex prompt wording per engine (its own setting, saved by the same button).
  const wordingQuery = useNodaroMotionPromptWording()
  const saveWording = useSaveNodaroMotionPromptWording()
  const envs = useEngineEnvironments()
  const newWordingMissingIn = environmentsThatCannotUseNewWording(envs.data)
  const [wordingDraft, setWordingDraft] = useState<NodaroMotionPromptWording>({})
  useEffect(() => {
    if (wordingQuery.data) setWordingDraft({ ...(wordingQuery.data.promptWording ?? {}) })
  }, [wordingQuery.data])
  const nextWording = promptWordingToSave(wordingDraft)
  // Never saved reads as the current wording: choosing it then is no change.
  const wordingChanged = !!wordingQuery.data && JSON.stringify(nextWording) !== JSON.stringify(promptWordingToSave(wordingQuery.data.promptWording))
  const changed = partsChanged || wordingChanged
  const pending = save.isPending || saveWording.isPending

  const setTexts = (engine: NodaroMotionEngine, style: CastSwapStyleId, texts: PromptPartTexts) =>
    setDraft((d) => ({ ...d, [engine]: { ...(d[engine] ?? {}), [style]: texts } }))

  // The wording first: the overrides' check then words a Flex run as its runs will be.
  const onSave = async () => {
    setProblems([])
    try {
      if (wordingChanged) await saveWording.mutateAsync(nextWording)
      if (partsChanged) await save.mutateAsync(next)
      toast.success("Saved. Runs pick it up within a minute.")
    } catch (err) {
      if (err instanceof PromptPartsInvalidError) setProblems(err.problems)
      else {
        const e = err instanceof Error ? err : new Error(String(err))
        toast.error(isPromptPartsEngineOutOfDate(e) && !wordingChanged ? ENGINE_OUT_OF_DATE : e.message)
      }
    }
  }

  return (
    <section aria-labelledby="engine-prompt-heading" className="mt-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="engine-prompt-heading" className="text-lg font-semibold">
            Engine prompt
          </h2>
          <p className="text-sm text-muted-foreground">
            The engine's own wording for every run people start themselves, per engine and style. Empty uses the default; "-" removes the
            part. A trend keeps its own.
          </p>
        </div>
        <Button size="sm" className="min-h-9" disabled={!changed || pending || !data} onClick={() => void onSave()}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save engine prompts
        </Button>
      </div>
      {query.isLoading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {query.error && <p className="text-sm text-destructive">{query.error.message}</p>}
      {data && (
        <p className="text-xs text-muted-foreground" data-prompt-parts-saved-state>
          {data.promptParts === null ? "Never saved: every run uses the engine's defaults." : data.updatedAt ? `Saved ${new Date(data.updatedAt).toLocaleString()}.` : "Saved."}
        </p>
      )}
      {data?.engines.map((engine) => (
        <section key={engine.id} aria-labelledby={`prompt-${engine.id}`} className="rounded-lg border p-4">
          <h3 id={`prompt-${engine.id}`} className="mb-3 text-base font-semibold">
            Engine prompt: {engine.name}{" "}
            <span className="font-normal text-muted-foreground">({internalNames[engine.internal] ?? engine.internal})</span>
          </h3>
          <Tabs defaultValue={data.styles[0] ?? "precise"}>
            <TabsList aria-label={`${engine.name} styles`}>
              {data.styles.map((style) => {
                const n = problems.filter((p) => p.engine === engine.id && p.style === style).length
                return (
                  <TabsTrigger key={style} value={style}>
                    {styleTabLabel(style, motion?.[engine.id])}
                    {n > 0 ? ` (${n})` : ""}
                  </TabsTrigger>
                )
              })}
            </TabsList>
            {data.styles.map((style) => (
              <TabsContent key={style} value={style}>
                <StylePanel
                  engine={engine.id}
                  style={style}
                  motion={style === "motion" ? motion?.[engine.id] : undefined}
                  texts={draft[engine.id]?.[style] ?? {}}
                  onChange={(texts) => setTexts(engine.id, style, texts)}
                  saveProblems={problems.filter((p) => p.engine === engine.id && p.style === style)}
                  disabled={pending}
                  wording={
                    style === "motion" && wordingQuery.data
                      ? {
                          value: wordingDraft[engine.id] ?? "current",
                          missingIn: newWordingMissingIn,
                          onChange: (w) => setWordingDraft((d) => ({ ...d, [engine.id]: w })),
                        }
                      : undefined
                  }
                />
              </TabsContent>
            ))}
          </Tabs>
        </section>
      ))}
    </section>
  )
}

function StylePanel({
  engine,
  style,
  motion,
  texts,
  onChange,
  saveProblems,
  disabled,
  wording,
}: {
  readonly engine: NodaroMotionEngine
  readonly style: CastSwapStyleId
  /** Motion: the saved Motion setting's entry (its parts follow it). */
  readonly motion?: NodaroMotionMotionEntry
  readonly texts: PromptPartTexts
  readonly onChange: (texts: PromptPartTexts) => void
  readonly saveProblems: readonly PromptPartProblem[]
  readonly disabled: boolean
  /** Motion: the engine's Flex prompt wording as edited (shown while its prompt is Flexible), and what offers "New". */
  readonly wording?: {
    readonly value: CastSwapPromptWordingId
    /** The environments whose engine cannot word it the new way; undefined while unknown. */
    readonly missingIn: readonly string[] | undefined
    readonly onChange: (next: CastSwapPromptWordingId) => void
  }
}) {
  const overrides = useDebounced(nonEmpty(texts), PREVIEW_DEBOUNCE_MS)
  const flexible = style === "motion" && promptStyleOfRun(style, motion) === "flexible"
  // The saved Motion setting is part of the question: its prompt style and clip preparation decide the parts.
  // The Flex wording as chosen here (a Precise prompt never reads it, so none is sent for it).
  const preview = useNodaroMotionPromptPreview(engine, style, overrides, JSON.stringify(motion ?? {}), true, flexible ? wording?.value : undefined)
  const answer = preview.data
  const problems = saveProblems.length > 0 ? saveProblems : (answer?.problems ?? [])
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {STYLE_LABELS[style]?.hint}
        {style === "motion" ? ` The parts are the ${PROMPT_STYLE_NAMES[promptStyleOfRun(style, motion)]} prompt's, as the saved Motion setting runs it.` : ""}
      </p>
      {flexible && wording && (
        <PromptWordingSelect
          value={wording.value}
          onChange={wording.onChange}
          newOffered={wording.missingIn !== undefined && wording.missingIn.length === 0}
          unofferedReason={wording.missingIn === undefined ? "checking the environments" : `not supported yet: ${wording.missingIn.join(", ")}`}
          note={DIRECT_WORDING_NOTE}
          disabled={disabled}
        />
      )}
      {preview.isLoading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the engine…
        </p>
      )}
      {preview.error && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          {isPromptPartsEngineOutOfDate(preview.error) ? ENGINE_OUT_OF_DATE : preview.error.message}
        </p>
      )}
      {answer && (
        <>
          {partsShown(answer.parts, texts).map((part) => (
            <PromptPartRow
              key={part.id}
              part={part}
              value={texts[part.id] ?? ""}
              onChange={(text) => onChange({ ...texts, [part.id]: text })}
              problems={problems.filter((p) => p.part === part.id)}
              disabled={disabled}
            />
          ))}
          <AssembledPrompt assembled={answer.assembled} length={answer.length} max={answer.max} problems={problems.filter((p) => !p.part)} />
        </>
      )}
    </div>
  )
}
