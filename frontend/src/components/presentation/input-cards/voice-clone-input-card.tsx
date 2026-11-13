import { useId, useRef, useState } from "react"
import { CheckCircle2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  REPLICA_CONSENT_MAX_SEC,
  REPLICA_CONSENT_SENTENCE,
  REPLICA_MAX_BYTES,
  REPLICA_SOURCE_MAX_SEC,
  REPLICA_SOURCE_MIN_SEC,
} from "@nodaro/shared/models"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useOneOffCloneWithheld } from "@/lib/voice-clone-availability"
import { useAuth } from "@/hooks/use-auth"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededError, voiceCloneConsentApi } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { cloneRunProblem, recordingFileProblem, replicaConsentIsYours, withRecording, type ReplicaRecording } from "@/lib/voice-clone"
import {
  appCloneEffectiveData,
  appClonesOf,
  withSpeakerClone,
  type AppCloneInputData,
  type AppClonePatch,
} from "@/lib/app-clone-inputs"
import type { WorkflowNode } from "@/types/nodes"
import { GlassCard } from "../output-cards/shared"
import { FileDropZone } from "./shared"

/**
 * "Your voice": a published app's (or a share link's) one-off voice clone, as
 * the runner's own input (decided 2026-11-13). The graph ships every clone
 * emptied; the runner adds their own two WAV recordings (ordinary uploads, as
 * every input of the app's page) and ticks the consent box, which asks the
 * server for a record of THEIR consent over exactly those two links. Text to
 * Speech: one clone, written as `replica` and `replicaConsent` on the node.
 * Text to Dialogue: one block per cloned speaker a line speaks with, written as
 * the node's whole `speakers` list in one update. A recording changed or
 * removed clears its consent (`withRecording`).
 */

const MAX_MB = Math.round(REPLICA_MAX_BYTES / (1024 * 1024))
const WAV_ACCEPT = ".wav,audio/wav,audio/x-wav"
const BTN = "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/30 px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation"

type Links = { sourceAudioUrl: string; consentAudioUrl: string }

function linksOf(replica: unknown): Links {
  const r = (replica && typeof replica === "object" ? replica : {}) as Partial<Record<keyof Links, unknown>>
  return {
    sourceAudioUrl: typeof r.sourceAudioUrl === "string" ? r.sourceAudioUrl : "",
    consentAudioUrl: typeof r.consentAudioUrl === "string" ? r.consentAudioUrl : "",
  }
}

interface VoiceCloneInputCardProps {
  /** The synthetic "Your voice" node (`APP_CLONE_INPUT_TYPE`): it carries the clone node it stands for. */
  readonly node: WorkflowNode
  /** The runner's input values (the clone node's slice is read). */
  readonly inputValues: Record<string, Record<string, unknown>>
  readonly onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readonly readOnly?: boolean
  /** "composer": inside the chat composer's dialog, which carries the title. */
  readonly variant?: "composer"
}

export function VoiceCloneInputCard({ node, inputValues, onUpdateInput, readOnly, variant }: VoiceCloneInputCardProps) {
  const t = useT()
  const { user } = useAuth()
  const withheld = useOneOffCloneWithheld()
  const { upload } = useFileUpload()
  const d = node.data as unknown as AppCloneInputData
  const nodeId = d.cloneNodeId
  const data = appCloneEffectiveData(d.cloneNodeData, inputValues[nodeId])
  const clones = appClonesOf(d.cloneNodeType, data)
  // The data as last rendered: an upload or a consent request that lands later builds its write on it.
  const latest = useRef(data)
  latest.current = data
  // One request at a time across the whole card, so each write builds on the others' finished results.
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signedIn = !!user
  const locked = readOnly || !signedIn || busy !== null

  function currentLinks(label: string | null): Links {
    const clone = appClonesOf(d.cloneNodeType, latest.current).find((c) => c.label === label)
    return linksOf(clone?.replica)
  }

  function write(label: string | null, patch: AppClonePatch) {
    if (label === null) {
      // Text to Speech: the clone's two keys on the node, the recordings first.
      if ("replica" in patch) onUpdateInput(nodeId, "replica", patch.replica)
      if ("replicaConsent" in patch) onUpdateInput(nodeId, "replicaConsent", patch.replicaConsent)
      return
    }
    // Text to Dialogue: the node's whole speakers list, every other speaker as it is, in one update.
    onUpdateInput(nodeId, "speakers", withSpeakerClone(latest.current.speakers, label, patch))
  }

  async function addRecording(label: string | null, which: ReplicaRecording, file: File) {
    if (locked) return
    const problem = recordingFileProblem(file)
    if (problem) {
      setError(problem === "not-wav" ? t("audiocfg.cloneNotWav") : t("audiocfg.cloneTooLarge", { mb: MAX_MB }))
      return
    }
    setError(null)
    setBusy(`${label ?? ""}:${which}`)
    try {
      const { url } = await upload(file)
      write(label, withRecording(currentLinks(label), which, url))
    } catch (err) {
      setError(err instanceof StorageExceededError ? err.message : t("audiocfg.cloneUploadFailed"))
    } finally {
      setBusy(null)
    }
  }

  async function tick(label: string | null, on: boolean) {
    if (!on) {
      write(label, { replicaConsent: undefined })
      return
    }
    const links = currentLinks(label)
    setBusy(`${label ?? ""}:consent-record`)
    try {
      const record = await voiceCloneConsentApi({ sourceAudioUrl: links.sourceAudioUrl, consentAudioUrl: links.consentAudioUrl })
      write(label, { replicaConsent: record })
    } catch (err) {
      // Nothing is stored: the box stays unticked.
      toast.error(err instanceof Error && err.message ? err.message : t("apiErr.voiceCloneConsent"))
    } finally {
      setBusy(null)
    }
  }

  const ready = clones.length > 0 && clones.every((c) => !cloneRunProblem(c.replica, c.consent, user?.id))

  const body = withheld ? (
    <p className="text-xs text-amber-600" data-testid="clone-unavailable">{t("audiocfg.cloneUnavailable")}</p>
  ) : (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">{t("audiocfg.cloneExplainer")}</p>
      {!signedIn && !readOnly && <p className="text-xs text-muted-foreground" data-testid="app-clone-sign-in">{t("appClone.signIn")}</p>}
      {clones.map((clone, i) => (
        <CloneBlock
          key={clone.label ?? i}
          label={clone.label}
          links={linksOf(clone.replica)}
          consent={clone.consent}
          userId={user?.id}
          busy={busy}
          locked={locked}
          readOnly={!!readOnly}
          onFile={(which, file) => void addRecording(clone.label, which, file)}
          onRemove={(which) => write(clone.label, withRecording(currentLinks(clone.label), which, ""))}
          onTick={(on) => void tick(clone.label, on)}
        />
      ))}
      {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
      <p className="flex items-center gap-1.5 text-xs" aria-live="polite" data-testid="app-clone-status">
        {ready ? (
          <><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" aria-hidden /><span className="text-foreground">{t("appClone.ready")}</span></>
        ) : (
          <span className="text-amber-600">{t("appClone.waiting")}</span>
        )}
      </p>
    </div>
  )

  if (variant === "composer") return <div data-testid="app-clone-card">{body}</div>
  return (
    <GlassCard>
      <section aria-label={d.label} data-testid="app-clone-card">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground" dir="auto">{d.label}</h3>
        {body}
      </section>
    </GlassCard>
  )
}

function CloneBlock({ label, links, consent, userId, busy, locked, readOnly, onFile, onRemove, onTick }: {
  /** A dialogue speaker's label; null for a Text to Speech node's one clone. */
  readonly label: string | null
  readonly links: Links
  readonly consent: unknown
  readonly userId: string | undefined
  readonly busy: string | null
  readonly locked: boolean
  readonly readOnly: boolean
  readonly onFile: (which: ReplicaRecording, file: File) => void
  readonly onRemove: (which: ReplicaRecording) => void
  readonly onTick: (on: boolean) => void
}) {
  const t = useT()
  const consentId = useId()
  const sentence = t("audiocfg.cloneConsentSentence")
  const key = label ?? ""
  const fields = (
    <>
      <RecordingInput
        testId="app-clone-reference"
        label={t("audiocfg.cloneReference")}
        hint={t("audiocfg.cloneReferenceHint", { min: REPLICA_SOURCE_MIN_SEC, max: REPLICA_SOURCE_MAX_SEC, mb: MAX_MB })}
        url={links.sourceAudioUrl}
        uploading={busy === `${key}:source`}
        locked={locked}
        readOnly={readOnly}
        removeLabel={t("audiocfg.cloneRemoveReference")}
        onFile={(file) => onFile("source", file)}
        onRemove={() => onRemove("source")}
      />
      <div className="space-y-1.5">
        <RecordingInput
          testId="app-clone-consent"
          label={t("audiocfg.cloneConsentRecording")}
          hint={t("audiocfg.cloneConsentHint", { max: REPLICA_CONSENT_MAX_SEC, mb: MAX_MB })}
          url={links.consentAudioUrl}
          uploading={busy === `${key}:consent`}
          locked={locked}
          readOnly={readOnly}
          removeLabel={t("audiocfg.cloneRemoveConsent")}
          onFile={(file) => onFile("consent", file)}
          onRemove={() => onRemove("consent")}
        />
        <blockquote className="border-s-2 border-border ps-2 text-xs italic text-foreground" dir="auto" data-testid="app-clone-sentence">{sentence}</blockquote>
        {/* The English wording is the one certainly accepted: shown beside any other. */}
        {sentence !== REPLICA_CONSENT_SENTENCE && (
          <p className="text-[11px] text-muted-foreground" dir="auto">
            {t("audiocfg.cloneConsentSentenceEnglish", { sentence: REPLICA_CONSENT_SENTENCE })}
          </p>
        )}
      </div>
      <div className="flex items-start gap-3">
        <Checkbox
          id={consentId}
          className="mt-3.5"
          checked={replicaConsentIsYours(consent, userId)}
          disabled={locked || !links.sourceAudioUrl || !links.consentAudioUrl}
          onCheckedChange={(v) => onTick(v === true)}
        />
        {/* The whole sentence is the box's tap target: at least 44 px tall. */}
        <Label htmlFor={consentId} className="min-h-11 flex-1 py-2.5 text-xs font-normal leading-snug">
          {t("audiocfg.cloneConsentConfirm")}
        </Label>
      </div>
    </>
  )
  if (label === null) return <div className="space-y-4" data-testid="app-clone">{fields}</div>
  return (
    <section className="space-y-4 rounded-lg border border-border p-3" aria-label={label} data-testid="app-clone">
      <h4 className="text-sm font-medium text-foreground" dir="auto">{label}</h4>
      {fields}
    </section>
  )
}

function RecordingInput({ testId, label, hint, url, uploading, locked, readOnly, removeLabel, onFile, onRemove }: {
  readonly testId: string
  readonly label: string
  readonly hint: string
  readonly url: string
  readonly uploading: boolean
  readonly locked: boolean
  readonly readOnly: boolean
  readonly removeLabel: string
  readonly onFile: (file: File) => void
  readonly onRemove: () => void
}) {
  const t = useT()
  const labelId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const pick = () => { if (!locked) inputRef.current?.click() }
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <p id={labelId} className="text-xs font-medium text-foreground">{label}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      {url ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-muted/30 p-2">
            <WaveformAudioPlayer url={url} variant="compact" label={label} />
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN} disabled={locked} onClick={pick}>
                {uploading ? t("inputcfg.uploading") : t("common.replace")}
              </button>
              <button type="button" className={`${BTN} w-11 px-0`} aria-label={removeLabel} disabled={locked} onClick={onRemove}>
                <Trash2 className="h-4 w-4" />
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={WAV_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-labelledby={labelId}
                disabled={locked}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) onFile(file)
                }}
              />
            </div>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-xs text-muted-foreground">{t("present.noAudio")}</p>
      ) : (
        <div className={locked && !uploading ? "pointer-events-none opacity-60" : undefined}>
          <FileDropZone
            isDragOver={isDragOver}
            setIsDragOver={setIsDragOver}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              const file = e.dataTransfer.files[0]
              if (file && !locked) onFile(file)
            }}
            onClick={pick}
            isUploading={uploading}
            accept={WAV_ACCEPT}
            fileInputRef={inputRef}
            onFileChange={(file) => { if (!locked) onFile(file) }}
            label={t("audiocfg.cloneUpload")}
            height="h-24"
          />
        </div>
      )}
    </div>
  )
}
