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
// Pulse also has its audio, for every direct Pulse run of either style: the
// original audio back on the result (the default) or Kling's own track
// (PUT /v1/admin/nodaro-motion/pulse-audio).
// Prism has its reference audio, for every direct Prism run of either style:
// what the reference video sent to the video model carries (the full audio,
// the default; the voice only; or none), the original audio always back on
// the result (PUT /v1/admin/nodaro-motion/prism-reference-audio).
// Save sends each setting that changed, whole; runs pick them up within a
// minute.
//
// Below it, the engine prompt per engine and style (PromptPartsTabs.tsx),
// saved on its own.

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { hasAdmin } from "@/lib/edition"
import type { AdminTrendEngine, CastSwapPrismReferenceAudioId, CastSwapPulseAudioId, NodaroMotionMasking, NodaroMotionMotion } from "@/lib/api"
import { useNodaroMotionMasking, useSaveNodaroMotionMasking } from "@/ee/hooks/queries/use-admin-queries"
import { useNodaroMotionMotion, useSaveNodaroMotionMotion } from "@/ee/hooks/queries/use-nodaro-motion-motion"
import { useNodaroMotionPulseAudio, useSaveNodaroMotionPulseAudio } from "@/ee/hooks/queries/use-nodaro-motion-pulse-audio"
import {
  useNodaroMotionPrismReferenceAudio,
  useSaveNodaroMotionPrismReferenceAudio,
} from "@/ee/hooks/queries/use-nodaro-motion-prism-reference-audio"
import { FaceMaskingEditor } from "../trends/components/FaceMaskingEditor"
import { DEFAULT_PULSE_AUDIO, PulseAudioSelect } from "../trends/components/PulseAudioSelect"
import { DEFAULT_PRISM_REFERENCE_AUDIO, PrismReferenceAudioSelect } from "../trends/components/PrismReferenceAudioSelect"
import { maskingIssues } from "../trends/model"
import { motionIssues, motionToSaved, toSaved } from "./model"
import { PromptPartsTabs } from "./components/PromptPartsTabs"
import { MotionColumn } from "./components/MotionColumn"

/** The model each engine runs on, shown to admins beside the public name. */
const INTERNAL_NAMES: Readonly<Record<AdminTrendEngine, string>> = {
  "seedance-2-5": "Seedance 2.5",
  "kling-4": "Kling 4",
}

/** Said under the Pulse audio select when this environment's engine does not take it yet. */
const PULSE_AUDIO_UNSUPPORTED = "This environment's engine does not take it yet: its runs deliver the original audio."

/** Said under the Prism reference audio select when this environment's engine does not take it yet. */
const PRISM_REFERENCE_AUDIO_UNSUPPORTED = "This environment's engine does not take it yet: its runs send the full audio."

const AUTO_HINT =
  "Only when the video model refuses the clip: one retry with the faces covered, charged only then (the quote names it apart)."

export default function AdminNodaroMotionPage() {
  const { data, isLoading, error } = useNodaroMotionMasking()
  const save = useSaveNodaroMotionMasking()
  const motionQuery = useNodaroMotionMotion()
  const saveMotion = useSaveNodaroMotionMotion()
  const pulseQuery = useNodaroMotionPulseAudio()
  const savePulse = useSaveNodaroMotionPulseAudio()
  const prismAudioQuery = useNodaroMotionPrismReferenceAudio()
  const savePrismAudio = useSaveNodaroMotionPrismReferenceAudio()
  const [draft, setDraft] = useState<NodaroMotionMasking>({})
  const [motionDraft, setMotionDraft] = useState<NodaroMotionMotion>({})
  const [pulseDraft, setPulseDraft] = useState<CastSwapPulseAudioId>(DEFAULT_PULSE_AUDIO)
  const [prismAudioDraft, setPrismAudioDraft] = useState<CastSwapPrismReferenceAudioId>(DEFAULT_PRISM_REFERENCE_AUDIO)

  // The drafts start from what is stored, and again after each save.
  useEffect(() => {
    if (data) setDraft(structuredClone(data.masking ?? {}))
  }, [data])
  useEffect(() => {
    if (motionQuery.data) setMotionDraft(structuredClone(motionQuery.data.motion ?? {}))
  }, [motionQuery.data])
  useEffect(() => {
    if (pulseQuery.data) setPulseDraft(pulseQuery.data.pulseAudio ?? DEFAULT_PULSE_AUDIO)
  }, [pulseQuery.data])
  useEffect(() => {
    if (prismAudioQuery.data) setPrismAudioDraft(prismAudioQuery.data.prismReferenceAudio ?? DEFAULT_PRISM_REFERENCE_AUDIO)
  }, [prismAudioQuery.data])

  const saved = useMemo(() => JSON.stringify(toSaved(data?.masking ?? {})), [data])
  const next = toSaved(draft)
  const changed = JSON.stringify(next) !== saved
  const savedMotion = useMemo(() => JSON.stringify(motionToSaved(motionQuery.data?.motion ?? {})), [motionQuery.data])
  const nextMotion = motionToSaved(motionDraft)
  // Until the Motion setting has loaded there is nothing of it to save.
  const motionChanged = !!motionQuery.data && JSON.stringify(nextMotion) !== savedMotion
  // Never saved reads as the original audio: choosing it then is no change.
  const pulseChanged = !!pulseQuery.data && pulseDraft !== (pulseQuery.data.pulseAudio ?? DEFAULT_PULSE_AUDIO)
  // Never saved reads as the full audio: choosing it then is no change.
  const prismAudioChanged =
    !!prismAudioQuery.data && prismAudioDraft !== (prismAudioQuery.data.prismReferenceAudio ?? DEFAULT_PRISM_REFERENCE_AUDIO)
  const issues = (data?.engines ?? []).flatMap((e) => {
    const m = draft[e.id]
    return [...(m ? maskingIssues(m) : []), ...motionIssues(motionDraft[e.id])].map((i) => `${e.name}: ${i}`)
  })
  const pending = save.isPending || saveMotion.isPending || savePulse.isPending || savePrismAudio.isPending

  if (!hasAdmin()) return null

  // Each setting that changed, the Precise one first; a refusal of either is said and stops there.
  const onSave = async () => {
    try {
      if (changed) await save.mutateAsync(next)
      if (motionChanged) await saveMotion.mutateAsync(nextMotion)
      if (pulseChanged) await savePulse.mutateAsync(pulseDraft)
      if (prismAudioChanged) await savePrismAudio.mutateAsync(prismAudioDraft)
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
        <Button size="sm" className="min-h-9" disabled={(!changed && !motionChanged && !pulseChanged && !prismAudioChanged) || issues.length > 0 || pending} onClick={() => void onSave()}>
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
                {engine.id === "motion-pulse" && (
                  <div role="group" aria-label={`${engine.name} audio`} className="mt-4 max-w-sm">
                    {pulseQuery.data ? (
                      <PulseAudioSelect
                        value={pulseDraft}
                        onChange={setPulseDraft}
                        note={pulseQuery.data.supported ? undefined : PULSE_AUDIO_UNSUPPORTED}
                      />
                    ) : pulseQuery.error ? (
                      <p className="text-xs text-destructive">{pulseQuery.error.message}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    )}
                  </div>
                )}
                {engine.id === "motion-prism" && (
                  <div role="group" aria-label={`${engine.name} reference audio`} className="mt-4 max-w-sm">
                    {prismAudioQuery.data ? (
                      <PrismReferenceAudioSelect
                        value={prismAudioDraft}
                        onChange={setPrismAudioDraft}
                        note={prismAudioQuery.data.supported ? undefined : PRISM_REFERENCE_AUDIO_UNSUPPORTED}
                      />
                    ) : prismAudioQuery.error ? (
                      <p className="text-xs text-destructive">{prismAudioQuery.error.message}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    )}
                  </div>
                )}
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
