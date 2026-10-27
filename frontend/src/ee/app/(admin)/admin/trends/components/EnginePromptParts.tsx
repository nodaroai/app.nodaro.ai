// The trend's engine prompt (hidden from users), under 4. Prompts: the Cast
// Swap engine's own wording around the slots, part by part, as this
// environment's engine writes it for the SAVED draft (its slots, references,
// pre and trend prompts and clip preparation). Each part shows its default;
// the admin may replace it (empty = the default, "-" removes the part).
//
// Collapsed until opened: only then is the engine asked
// (GET /v1/admin/trends/:id/prompt-parts). Save checks the overrides with the
// engine first (PUT, guarded on the draft's revision): its problems show by
// their part and nothing is stored. A stored override written against another
// default says "Default changed". An engine without the route (503), or one
// that answers off the contract (502), reads as out of date.
//
// Like the face mask panel, it waits while the form has unsaved edits: the
// engine reads the saved draft.

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  PromptPartsInvalidError,
  isPromptPartsEngineOutOfDate,
  type AdminTrendPromptPartOverrides,
  type CastSwapPromptPartId,
  type PromptPartProblem,
  type PromptPartTexts,
} from "@/lib/api"
import { useSaveTrendPromptParts, useTrendPromptParts } from "@/ee/hooks/queries/use-nodaro-motion-prompt-parts"
import { AssembledPrompt, PromptPartRow, nonEmpty, partsShown } from "./PromptPartRow"

export const ENGINE_OUT_OF_DATE = "This environment's Cast Swap engine is out of date: it can't show or check the engine prompt yet."

interface Props {
  readonly trendId: string
  /** The draft revision this screen holds. */
  readonly revision: string
  /** The form has unsaved edits (the engine reads the saved draft). */
  readonly dirty: boolean
  /** A save here moved the draft: the screen adopts its revision. */
  readonly onRevision: (revision: string) => void
  readonly onWriteError: (err: Error) => void
}

/** The stored overrides' texts. */
export function textsOf(overrides: AdminTrendPromptPartOverrides | undefined): PromptPartTexts {
  const out: PromptPartTexts = {}
  for (const [id, o] of Object.entries(overrides ?? {}) as Array<[CastSwapPromptPartId, { text: string } | undefined]>) {
    if (o) out[id] = o.text
  }
  return out
}

export function EnginePromptParts({ trendId, revision, dirty, onRevision, onWriteError }: Props) {
  const [open, setOpen] = useState(false)
  const query = useTrendPromptParts(trendId, revision, open)
  const save = useSaveTrendPromptParts(trendId)
  const data = query.data
  const storedKey = JSON.stringify(textsOf(data?.overrides))
  const [edits, setEdits] = useState<PromptPartTexts>({})
  const [saveProblems, setSaveProblems] = useState<PromptPartProblem[] | null>(null)
  // The edits start from what is stored, and again whenever that changes (a save here, or elsewhere).
  useEffect(() => {
    setEdits(JSON.parse(storedKey) as PromptPartTexts)
    setSaveProblems(null)
  }, [storedKey])

  const changed = JSON.stringify(nonEmpty(edits)) !== JSON.stringify(nonEmpty(JSON.parse(storedKey) as PromptPartTexts))
  const problems = saveProblems ?? data?.problems ?? []
  const byPart = useMemo(() => {
    const m = new Map<string, PromptPartProblem[]>()
    for (const p of problems) if (p.part) m.set(p.part, [...(m.get(p.part) ?? []), p])
    return m
  }, [problems])

  const onSave = () => {
    setSaveProblems(null)
    save.mutate(
      { parts: nonEmpty(edits), revision },
      {
        onSuccess: (w) => {
          onRevision(w.revision)
          toast.success("Engine prompt saved")
        },
        onError: (err) => {
          if (err instanceof PromptPartsInvalidError) setSaveProblems(err.problems)
          else if (isPromptPartsEngineOutOfDate(err)) toast.error(ENGINE_OUT_OF_DATE)
          // A stale revision reloads the trend (the page's own handling), anything else is said.
          else onWriteError(err)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" aria-label="Engine prompt">
      <button
        type="button"
        className="flex min-h-9 items-center gap-1 text-start text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Engine prompt
      </button>
      <p className="text-xs text-muted-foreground">
        The Cast Swap engine's own wording around the slots, part by part, for this trend's clip preparation and prompt style. Type to replace a part; empty uses
        the default, and "-" removes it. The engine checks every change before it is saved.
      </p>
      {open && (
        <>
          {query.isLoading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the engine…
            </p>
          )}
          {query.error && (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              {isPromptPartsEngineOutOfDate(query.error) ? ENGINE_OUT_OF_DATE : query.error.message}
            </p>
          )}
          {data && (
            <>
              {partsShown(data.parts, edits).map((part) => {
                const stored = data.overrides[part.id]
                return (
                  <PromptPartRow
                    key={part.id}
                    part={part}
                    value={edits[part.id] ?? ""}
                    onChange={(text) => setEdits((e) => ({ ...e, [part.id]: text }))}
                    problems={byPart.get(part.id)}
                    defaultChanged={!!stored && stored.defaultHash !== part.defaultHash}
                    disabled={save.isPending}
                  />
                )
              })}
              <AssembledPrompt assembled={data.assembled} length={data.length} max={data.max} problems={problems.filter((p) => !p.part)} />
              {changed && <p className="text-xs text-muted-foreground">The prompt above is the saved one: save to check your changes.</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" className="min-h-9" disabled={!changed || dirty || save.isPending} onClick={onSave}>
                  {save.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
                  Save engine prompt
                </Button>
                {changed && (
                  <Button type="button" variant="ghost" className="min-h-9" disabled={save.isPending} onClick={() => setEdits(JSON.parse(storedKey) as PromptPartTexts)}>
                    Discard
                  </Button>
                )}
                {dirty && <span className="text-xs text-muted-foreground">Save the draft first: the engine reads the saved draft.</span>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
