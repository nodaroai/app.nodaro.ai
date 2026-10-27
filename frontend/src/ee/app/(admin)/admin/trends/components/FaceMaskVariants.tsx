// The trend's person masks (decided 2026-10-27): when optional people have
// face marks, a run that leaves one of them empty keeps that person as in the
// clip, so it must be sent a mask that leaves their face uncovered. One person
// mask per combination of marked people a run can leave empty (at most 3
// people, so at most 7 masks) is made from the approved face mask: "Make
// person masks" starts every one not made yet (billed to the admin), the panel
// moves them on while they are being made, and each is approved as it
// finishes. Each plays here. Publishing needs every one made and up to date.
//
// Only a trend with no examples has truly empty optional slots: with examples,
// an empty slot takes an example's person, so the people's face marks have no
// effect on runs (the panel says so).

import { useEffect } from "react"
import { Loader2, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AdminTrendFaceMaskVariantStatus, AdminTrendFaceMaskVariantsState } from "@/lib/api"
import { useAdvanceTrendFaceMaskVariants, useStartTrendFaceMaskVariants } from "@/ee/hooks/queries/use-admin-queries"
import type { MarkPerson } from "./FaceMaskMarks"

/** How often the panel moves the person masks being made on. */
export const VARIANT_ADVANCE_MS = 5_000

const CHIP: Readonly<Record<AdminTrendFaceMaskVariantStatus, { label: string; className: string }>> = {
  approved: { label: "Approved", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  making: { label: "Being made", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  failed: { label: "Failed", className: "bg-destructive/15 text-destructive" },
  missing: { label: "Not made", className: "bg-muted text-muted-foreground" },
  out_of_date: { label: "Out of date", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
}

/** The people a mask leaves empty, by their labels ("Amy and Ben"). */
export function peopleNamed(keys: readonly string[], people: readonly MarkPerson[]): string {
  const names = keys.map((k) => people.find((p) => p.key === k)?.label ?? k)
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

interface Props {
  readonly trendId: string
  readonly state: AdminTrendFaceMaskVariantsState | undefined
  /** The trend's optional people (key and label). */
  readonly people: readonly MarkPerson[]
  readonly dirty: boolean
  readonly revision: string
  readonly onRevision: (revision: string) => void
  readonly onWriteError: (err: Error) => void
}

export function FaceMaskVariants({ trendId, state, people, dirty, revision, onRevision, onWriteError }: Props) {
  const start = useStartTrendFaceMaskVariants(trendId)
  const advance = useAdvanceTrendFaceMaskVariants(trendId)
  const making = state?.variants.some((v) => v.status === "making") ?? false

  // While any is being made, move them on (each is approved as it finishes).
  const advanceNow = advance.mutate
  const busyAdvancing = advance.isPending
  useEffect(() => {
    if (!making || dirty) return
    const timer = setInterval(() => {
      if (busyAdvancing) return
      advanceNow(revision, { onSuccess: (r) => r.changed && onRevision(r.revision) })
    }, VARIANT_ADVANCE_MS)
    return () => clearInterval(timer)
  }, [making, dirty, revision, advanceNow, busyAdvancing, onRevision])

  if (!state || state.people.length === 0) return null
  const named = (keys: readonly string[]) => peopleNamed(keys, people)
  const todo = state.variants.filter((v) => v.status === "missing" || v.status === "out_of_date" || v.status === "failed").length
  const canMake = state.applies && !state.overCap && state.baseProblem === null && todo > 0 && !dirty && !start.isPending

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-2" aria-label="Person masks">
      <span className="flex items-center gap-1 text-xs font-medium">
        <Users className="h-3.5 w-3.5" /> Person masks
      </span>
      <p className="text-xs text-muted-foreground">
        A run that leaves {named(state.people)} empty keeps that person as in the clip, so it gets a mask that leaves their face
        uncovered. One mask per combination, made from the approved face mask and approved as it finishes (billed to your account).
      </p>
      {state.overCap && (
        <p className="text-xs text-destructive">
          {state.people.length} people have face marks; at most 3 may. Remove some of their marks: the trend can't be published until then.
        </p>
      )}
      {!state.applies && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This trend has examples: an optional person left empty takes an example's person, so these face marks have no effect on runs.
        </p>
      )}
      {state.applies && state.baseProblem === "no_raw_mask" && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          The approved face mask kept no copy from before its marks: make the face mask again, then the person masks.
        </p>
      )}
      {state.applies && (state.baseProblem === "no_base" || state.baseProblem === "base_out_of_date") && (
        <p className="text-xs text-muted-foreground">Approve an up-to-date face mask first: the person masks are made from it.</p>
      )}

      {state.applies && state.variants.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Person mask list">
          {state.variants.map((v) => {
            const chip = CHIP[v.status]
            return (
              <li key={v.emptySlots.join("+")} className="flex flex-col gap-1 rounded border p-2 text-xs" data-testid="face-mask-variant">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Runs without {named(v.emptySlots)}</span>
                  <span className={cn("rounded px-2 py-0.5 font-medium", chip.className)}>{chip.label}</span>
                  {v.status === "making" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                {v.status === "failed" && v.job?.error && <p className="text-destructive">{v.job.error.message}</p>}
                {v.status === "approved" && v.variant && !v.variant.url && (
                  <p className="text-muted-foreground">Nothing is left to cover: such runs go unmasked.</p>
                )}
                {v.variant?.url && (v.status === "approved" || v.status === "out_of_date") && (
                  <video
                    src={v.variant.url}
                    controls
                    muted
                    playsInline
                    aria-label={`The mask for runs without ${named(v.emptySlots)}`}
                    className="max-h-56 w-full rounded-md bg-black object-contain"
                  />
                )}
                {v.variant && (
                  <p className="tabular-nums text-muted-foreground">
                    {(v.variant.stats.coverage * 100).toFixed(1)} % covered · {v.variant.stats.erasedRegions} region{v.variant.stats.erasedRegions === 1 ? "" : "s"} left unmasked
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {state.applies && !state.overCap && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-9"
            disabled={!canMake}
            onClick={() =>
              start.mutate(revision, {
                onSuccess: (r) => {
                  if (r.revision) onRevision(r.revision)
                  if (r.started > 0) toast.success(`Making ${r.started} person mask${r.started === 1 ? "" : "s"}`)
                },
                onError: onWriteError,
              })
            }
          >
            {start.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Users className="mr-1 h-4 w-4" />}
            {todo > 0 ? `Make person masks (${todo})` : "Person masks made"}
          </Button>
          {dirty && <span className="text-muted-foreground text-xs">Save first: the person masks are made from the saved draft.</span>}
        </div>
      )}
    </div>
  )
}
