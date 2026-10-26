// Admin → Nodaro Motion: how each engine covers the faces in a clip before
// the video model sees it, on every run a person starts themselves (the API,
// the SDK, MCP `cast_swap`). People never set it. A trend keeps its own
// setting (Admin → Trends). Until an admin saves here, no engine masks.
//
// One setting per engine (Pro, Lite), edited with the trend editor's own
// controls, saved together (PUT /v1/admin/nodaro-motion/masking): the
// deployment's whole setting, read by the Cast Swap engine within a minute.

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { hasAdmin } from "@/lib/edition"
import type { AdminTrendEngine, NodaroMotionMasking } from "@/lib/api"
import { useNodaroMotionMasking, useSaveNodaroMotionMasking } from "@/ee/hooks/queries/use-admin-queries"
import { FaceMaskingEditor } from "../trends/components/FaceMaskingEditor"
import { maskingIssues } from "../trends/model"
import { toSaved } from "./model"

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
  const [draft, setDraft] = useState<NodaroMotionMasking>({})

  // The draft starts from what is stored, and again after each save.
  useEffect(() => {
    if (data) setDraft(structuredClone(data.masking ?? {}))
  }, [data])

  const saved = useMemo(() => JSON.stringify(toSaved(data?.masking ?? {})), [data])
  const next = toSaved(draft)
  const changed = JSON.stringify(next) !== saved
  const issues = (data?.engines ?? []).flatMap((e) => {
    const m = draft[e.id]
    return m ? maskingIssues(m).map((i) => `${e.name}: ${i}`) : []
  })

  if (!hasAdmin()) return null

  const onSave = () =>
    save.mutate(next, {
      onSuccess: () => toast.success("Saved. Runs pick it up within a minute."),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Nodaro Motion</h1>
          <p className="text-sm text-muted-foreground">
            Face masking for every run people start themselves (the API, the SDK and MCP), per engine. People never
            see or set it. A trend keeps its own setting.
          </p>
        </div>
        <Button size="sm" className="min-h-9" disabled={!changed || issues.length > 0 || save.isPending} onClick={onSave}>
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
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
    </div>
  )
}
