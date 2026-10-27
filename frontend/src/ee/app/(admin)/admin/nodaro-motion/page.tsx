// Admin → Nodaro Motion: how each engine covers the faces in a clip before
// the video model sees it, on every run a person starts themselves (the API,
// the SDK, MCP `cast_swap`). People never set it. A trend keeps its own
// setting (Admin → Trends). Until an admin saves here, no engine masks.
//
// Each engine (Prism, Pulse) has two columns, edited with the trend editor's
// own controls:
// - Precise: the face masking of a Precise run (PUT /v1/admin/nodaro-motion/masking).
// - Motion: a Motion run's masking (Same as Precise, Faces hidden, or Full
//   depth with its scene source) and its prompt style (left out: Flexible),
//   PUT /v1/admin/nodaro-motion/motion (MotionColumn.tsx).
// Save sends each setting that changed, whole; the Cast Swap engine reads
// them within a minute.
//
// Below it, the engine prompt per engine and style (PromptPartsTabs.tsx),
// saved on its own.

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { hasAdmin } from "@/lib/edition"
import type { AdminTrendEngine, NodaroMotionMasking, NodaroMotionMotion } from "@/lib/api"
import { useNodaroMotionMasking, useSaveNodaroMotionMasking } from "@/ee/hooks/queries/use-admin-queries"
import { useNodaroMotionMotion, useSaveNodaroMotionMotion } from "@/ee/hooks/queries/use-nodaro-motion-motion"
import { FaceMaskingEditor } from "../trends/components/FaceMaskingEditor"
import { maskingIssues } from "../trends/model"
import { motionIssues, motionToSaved, toSaved } from "./model"
import { PromptPartsTabs } from "./components/PromptPartsTabs"
import { MotionColumn } from "./components/MotionColumn"

/** The model each engine runs on, shown to admins beside the public name. */
const INTERNAL_NAMES: Readonly<Record<AdminTrendEngine, string>> = {
  "seedance-2-5": "Seedance 2.5",
  "kling-4": "Kling 4",
}

const AUTO_HINT =
  "Only when the video model refuses the clip: one retry with the faces covered, charged only then (the quote names it apart)."

export default function AdminNodaroMotionPage() {
  const { data, isLoading, error } = useNodaroMotionMasking()
  const save = useSaveNodaroMotionMasking()
  const motionQuery = useNodaroMotionMotion()
  const saveMotion = useSaveNodaroMotionMotion()
  const [draft, setDraft] = useState<NodaroMotionMasking>({})
  const [motionDraft, setMotionDraft] = useState<NodaroMotionMotion>({})

  // The drafts start from what is stored, and again after each save.
  useEffect(() => {
    if (data) setDraft(structuredClone(data.masking ?? {}))
  }, [data])
  useEffect(() => {
    if (motionQuery.data) setMotionDraft(structuredClone(motionQuery.data.motion ?? {}))
  }, [motionQuery.data])

  const saved = useMemo(() => JSON.stringify(toSaved(data?.masking ?? {})), [data])
  const next = toSaved(draft)
  const changed = JSON.stringify(next) !== saved
  const savedMotion = useMemo(() => JSON.stringify(motionToSaved(motionQuery.data?.motion ?? {})), [motionQuery.data])
  const nextMotion = motionToSaved(motionDraft)
  // Until the Motion setting has loaded there is nothing of it to save.
  const motionChanged = !!motionQuery.data && JSON.stringify(nextMotion) !== savedMotion
  const issues = (data?.engines ?? []).flatMap((e) => {
    const m = draft[e.id]
    return [...(m ? maskingIssues(m) : []), ...motionIssues(motionDraft[e.id])].map((i) => `${e.name}: ${i}`)
  })
  const pending = save.isPending || saveMotion.isPending

  if (!hasAdmin()) return null

  // Each setting that changed, the Precise one first; a refusal of either is said and stops there.
  const onSave = async () => {
    try {
      if (changed) await save.mutateAsync(next)
      if (motionChanged) await saveMotion.mutateAsync(nextMotion)
      toast.success("Saved. Runs pick it up within a minute.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Nodaro Motion</h1>
          <p className="text-sm text-muted-foreground">
            How each engine prepares the clip for every run people start themselves (the API, the SDK and MCP), in the
            Precise and the Motion style. People never see or set it. A trend keeps its own setting.
          </p>
        </div>
        <Button size="sm" className="min-h-9" disabled={(!changed && !motionChanged) || issues.length > 0 || pending} onClick={() => void onSave()}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : String(error)}</p>}

      {data && (
        <>
          <p className="mb-4 text-xs text-muted-foreground" data-saved-state>
            {data.masking === null
              ? "Never saved: no engine masks faces."
              : data.updatedAt
                ? `Saved ${new Date(data.updatedAt).toLocaleString()}.`
                : "Saved."}
          </p>
          <div className="flex flex-col gap-4">
            {data.engines.map((engine) => (
              <section key={engine.id} aria-labelledby={`engine-${engine.id}`} className="rounded-lg border p-4">
                <h2 id={`engine-${engine.id}`} className="mb-3 text-base font-semibold">
                  {engine.name} <span className="font-normal text-muted-foreground">({INTERNAL_NAMES[engine.internal] ?? engine.internal})</span>
                </h2>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div role="group" aria-label={`${engine.name} Precise`} className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-sm font-semibold">Precise</h3>
                    <FaceMaskingEditor
                      value={draft[engine.id]}
                      autoHint={AUTO_HINT}
                      onChange={(m) =>
                        setDraft((d) => {
                          const out = { ...d }
                          if (m) out[engine.id] = m
                          else delete out[engine.id]
                          return out
                        })
                      }
                    />
                  </div>
                  <div role="group" aria-label={`${engine.name} Motion`} className="flex min-w-0 flex-col gap-2">
                    <h3 className="text-sm font-semibold">Motion</h3>
                    {motionQuery.data ? (
                      <MotionColumn
                        value={motionDraft[engine.id]}
                        supports={motionQuery.data.supports}
                        onChange={(entry) => setMotionDraft((d) => ({ ...d, [engine.id]: entry }))}
                      />
                    ) : motionQuery.error ? (
                      <p className="text-xs text-destructive">{motionQuery.error.message}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    )}
                  </div>
                </div>
              </section>
            ))}
          </div>
          {issues.length > 0 && (
            <ul className="mt-4 list-disc pl-5 text-sm text-destructive" aria-live="polite">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <PromptPartsTabs internalNames={INTERNAL_NAMES} />
    </div>
  )
}
