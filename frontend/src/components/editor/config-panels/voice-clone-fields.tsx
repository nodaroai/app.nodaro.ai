"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import {
  REPLICA_CONSENT_MAX_SEC,
  REPLICA_CONSENT_SENTENCE,
  REPLICA_MAX_BYTES,
  REPLICA_SOURCE_MAX_SEC,
  REPLICA_SOURCE_MIN_SEC,
  dialogueMaxSpeakers,
  getDialogueCapabilities,
} from "@nodaro/shared/models"
import { ttsTakesReplica } from "@nodaro/shared/model-catalog"
import type { TtsReplica } from "@nodaro/shared/models"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { StorageExceededError, uploadAudio, voiceCloneConsentApi } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useT } from "@/lib/i18n"
import { dialogueTakesReplica, replicaConsentIsYours } from "@/lib/dialogue-direction"
import { useOneOffCloneWithheld } from "@/lib/voice-clone-availability"
import {
  PENDING_REPLICA,
  cloneLabelProblem,
  dialogueCloneLabels,
  nextCloneLabel,
  recordingFileProblem,
  removeClone,
  renameClone,
  withRecording,
  type ReplicaRecording,
} from "@/lib/voice-clone"
import type { DialogueLine, DialogueSpeakerDirection, ReplicaConsentRecord } from "@/types/nodes"

/**
 * A one-off clone of a person's voice (Gemini 3.8 Flash, decided 2026-11-13):
 * two WAV recordings uploaded to the person's library as any upload is
 * (`uploadAudio`), and the person's consent. Nothing is saved as a voice. Every
 * write is the person's own action; a recording changed or removed clears the
 * consent (`withRecording`).
 */

/** What the recordings block writes: the clone's links and the consent record. */
export type ReplicaPatch = { replica?: TtsReplica; replicaConsent?: ReplicaConsentRecord | undefined }

/** Re-exported for the editor's callers; the hook lives in lib so the app runner reads it without editor code. */
export { useOneOffCloneWithheld }

/** A node holding a clone where clones are withheld: said, never hidden, with a way to take the clone off. */
function CloneUnavailableNotice({ onRemove }: { readonly onRemove: () => void }) {
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-2" data-testid="clone-unavailable">
      <p className="text-[11px] text-amber-600">{t("audiocfg.cloneUnavailable")}</p>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={onRemove}>{t("common.remove")}</Button>
    </div>
  )
}

const MAX_MB = Math.round(REPLICA_MAX_BYTES / (1024 * 1024))
const WAV_ACCEPT = ".wav,audio/wav,audio/x-wav"

function RecordingUpload({ label, hint, url, busy, disabled, removeLabel, testId, onFile, onRemove }: {
  readonly label: string
  readonly hint: string
  readonly url: string
  readonly busy: boolean
  readonly disabled: boolean
  readonly removeLabel: string
  readonly testId: string
  readonly onFile: (file: File) => void
  readonly onRemove: () => void
}) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  return (
    <div className="space-y-1" data-testid={testId}>
      <Label id={labelId}>{label}</Label>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
      {url && <audio controls src={url} aria-labelledby={labelId} className="w-full h-8" />}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={WAV_ACCEPT}
          className="sr-only"
          aria-labelledby={labelId}
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) onFile(file)
          }}
        />
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={disabled} onClick={() => inputRef.current?.click()}>
          {busy ? t("inputcfg.uploading") : url ? t("common.replace") : t("audiocfg.cloneUpload")}
        </Button>
        {url && (
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={removeLabel} disabled={disabled} onClick={onRemove}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * The two recordings, the sentence the consent recording reads, and the
 * consent box. The two uploads and the consent request run one at a time, so
 * each builds its write on the others' finished results. The box waits for
 * both recordings.
 *
 * The box is the viewer's own (decided 2026-11-13): ticking it asks the server
 * for a record of THEIR consent over exactly these two links and stores that
 * record; it shows ticked only for the person it was issued to, so a copy of
 * the node is unticked for anyone else.
 */
export function ReplicaRecordingsFields({ replica, consent, onChange }: {
  readonly replica: TtsReplica | undefined
  readonly consent: unknown
  readonly onChange: (patch: ReplicaPatch) => void
}) {
  const t = useT()
  const { user } = useAuth()
  const consentId = useId()
  const [busy, setBusy] = useState<ReplicaRecording | "consent-record" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const source = replica?.sourceAudioUrl ?? ""
  const consentUrl = replica?.consentAudioUrl ?? ""
  const sentence = t("audiocfg.cloneConsentSentence")

  async function tick(on: boolean) {
    if (!on) {
      onChange({ replicaConsent: undefined })
      return
    }
    setBusy("consent-record")
    try {
      const record = await voiceCloneConsentApi({ sourceAudioUrl: source, consentAudioUrl: consentUrl })
      onChange({ replicaConsent: record })
    } catch (err) {
      // Nothing is stored: the box stays unticked. A deployment that withholds clones says so
      // (`VoiceCloneUnavailableError`); any other refusal carries the route's own words.
      toast.error(err instanceof Error && err.message ? err.message : t("apiErr.voiceCloneConsent"))
    } finally {
      setBusy(null)
    }
  }

  async function upload(which: ReplicaRecording, file: File) {
    const problem = recordingFileProblem(file)
    if (problem) {
      setError(problem === "not-wav" ? t("audiocfg.cloneNotWav") : t("audiocfg.cloneTooLarge", { mb: MAX_MB }))
      return
    }
    setError(null)
    setBusy(which)
    try {
      const { url } = await uploadAudio(file)
      onChange(withRecording(replica, which, url))
    } catch (err) {
      setError(err instanceof StorageExceededError ? err.message : t("audiocfg.cloneUploadFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <RecordingUpload
        label={t("audiocfg.cloneReference")}
        hint={t("audiocfg.cloneReferenceHint", { min: REPLICA_SOURCE_MIN_SEC, max: REPLICA_SOURCE_MAX_SEC, mb: MAX_MB })}
        url={source}
        busy={busy === "source"}
        disabled={busy !== null}
        removeLabel={t("audiocfg.cloneRemoveReference")}
        testId="clone-reference"
        onFile={(file) => void upload("source", file)}
        onRemove={() => onChange(withRecording(replica, "source", ""))}
      />
      <div className="space-y-1">
        <RecordingUpload
          label={t("audiocfg.cloneConsentRecording")}
          hint={t("audiocfg.cloneConsentHint", { max: REPLICA_CONSENT_MAX_SEC, mb: MAX_MB })}
          url={consentUrl}
          busy={busy === "consent"}
          disabled={busy !== null}
          removeLabel={t("audiocfg.cloneRemoveConsent")}
          testId="clone-consent"
          onFile={(file) => void upload("consent", file)}
          onRemove={() => onChange(withRecording(replica, "consent", ""))}
        />
        <blockquote className="border-s-2 border-border ps-2 text-xs italic" dir="auto" data-testid="clone-sentence">{sentence}</blockquote>
        {/* The English wording is the one certainly accepted: shown beside any other. */}
        {sentence !== REPLICA_CONSENT_SENTENCE && (
          <p className="text-[11px] text-muted-foreground" dir="auto" data-testid="clone-sentence-english">
            {t("audiocfg.cloneConsentSentenceEnglish", { sentence: REPLICA_CONSENT_SENTENCE })}
          </p>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500" role="alert">{error}</p>}
      <div className="flex items-start gap-2">
        <Checkbox
          id={consentId}
          checked={replicaConsentIsYours(consent, user?.id)}
          disabled={!source || !consentUrl || busy !== null}
          onCheckedChange={(v) => void tick(v === true)}
        />
        <Label htmlFor={consentId} className="text-xs font-normal leading-snug">{t("audiocfg.cloneConsentConfirm")}</Label>
      </div>
    </div>
  )
}

/**
 * Text to Speech: "Your own voice (a one-off clone)", only on a model that
 * clones, off by default. Switching it on stores a clone with no recordings yet
 * (`PENDING_REPLICA`); switching it off removes the clone and its consent.
 */
export function TtsCloneSection({ provider, data, onUpdate }: {
  readonly provider: string
  readonly data: { readonly replica?: TtsReplica; readonly replicaConsent?: ReplicaConsentRecord }
  readonly onUpdate: (patch: ReplicaPatch) => void
}) {
  const t = useT()
  const switchId = useId()
  const withheld = useOneOffCloneWithheld()
  if (!ttsTakesReplica(provider)) return null
  const on = data.replica != null
  if (withheld) {
    return on ? <CloneUnavailableNotice onRemove={() => onUpdate({ replica: undefined, replicaConsent: undefined })} /> : null
  }
  return (
    <>
      <Separator />
      <div className="space-y-2" data-testid="tts-clone">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={switchId}>{t("audiocfg.cloneTitle")}</Label>
          <Switch
            id={switchId}
            checked={on}
            onCheckedChange={(v) => onUpdate(v ? { replica: PENDING_REPLICA, replicaConsent: undefined } : { replica: undefined, replicaConsent: undefined })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">{t("audiocfg.cloneExplainer")}</p>
        {on && <ReplicaRecordingsFields replica={data.replica} consent={data.replicaConsent} onChange={onUpdate} />}
      </div>
    </>
  )
}

function CloneRow({ provider, entry, otherLabels, onRename, onRemove, onChange }: {
  readonly provider: string
  readonly entry: DialogueSpeakerDirection
  readonly otherLabels: readonly string[]
  readonly onRename: (to: string) => void
  readonly onRemove: () => void
  readonly onChange: (patch: ReplicaPatch) => void
}) {
  const t = useT()
  const nameId = useId()
  // The name as typed: written to the node only when it is a name no other voice has, so a half-typed
  // name never takes over another voice's lines.
  const [draft, setDraft] = useState(entry.voice)
  useEffect(() => setDraft(entry.voice), [entry.voice])
  const problem = cloneLabelProblem(provider, draft, otherLabels)
  return (
    <section className="rounded-md border border-border p-2 space-y-2" aria-label={entry.voice} data-testid="dialogue-clone">
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <Label htmlFor={nameId}>{t("common.name")}</Label>
          <Input
            id={nameId}
            value={draft}
            dir="auto"
            onChange={(e) => {
              const next = e.target.value
              setDraft(next)
              if (!cloneLabelProblem(provider, next, otherLabels) && next !== entry.voice) onRename(next)
            }}
          />
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t("audiocfg.cloneRemove")} onClick={onRemove}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {problem && <p className="text-[11px] text-red-500" role="alert">{t(problem === "empty" ? "audiocfg.cloneNameEmpty" : "audiocfg.cloneNameTaken")}</p>}
      <ReplicaRecordingsFields replica={entry.replica} consent={entry.replicaConsent} onChange={onChange} />
    </section>
  )
}

/**
 * Text to Dialogue on a model that clones: "Cloned voices", up to the model's
 * speakers. Each clone is a `speakers` entry `{ voice: <its name>, replica,
 * replicaConsent }`; the lines speak with it by its name. Renaming or removing
 * one rewrites its lines in the same write.
 */
export function DialogueClonesSection({ provider, lines, speakers, onUpdate }: {
  readonly provider: string
  /** The lines as the panel shows them (their voices as the run sends them). */
  readonly lines: readonly DialogueLine[]
  readonly speakers: readonly DialogueSpeakerDirection[] | undefined
  readonly onUpdate: (patch: { dialogue?: DialogueLine[]; speakers?: DialogueSpeakerDirection[] | undefined }) => void
}) {
  const t = useT()
  const withheld = useOneOffCloneWithheld()
  if (!dialogueTakesReplica(provider)) return null
  const list = speakers ?? []
  const labels = dialogueCloneLabels(provider, list)
  if (withheld) {
    if (labels.length === 0) return null
    // Every clone off at once, its lines moved onto the model's voices in the same write.
    const removeAll = () => {
      let next: { dialogue: DialogueLine[]; speakers: DialogueSpeakerDirection[] | undefined } = { dialogue: [...lines], speakers: [...list] }
      for (const label of labels) next = removeClone(provider, next.dialogue, next.speakers ?? [], label)
      onUpdate(next)
    }
    return <CloneUnavailableNotice onRemove={removeAll} />
  }
  const max = dialogueMaxSpeakers(provider)
  const named = (getDialogueCapabilities(provider).voices ?? []).map((v) => v.id)
  const add = () => {
    const voice = nextCloneLabel((n) => t("audiocfg.cloneDefaultLabel", { n }), [...labels, ...named, ...list.map((s) => s.voice)])
    onUpdate({ speakers: [...list, { voice, replica: PENDING_REPLICA }] })
  }
  return (
    <>
      <Separator />
      <div className="space-y-2" data-testid="dialogue-clones">
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{t("audiocfg.clonesTitle")}</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("audiocfg.cloneExplainer")}</p>
        </div>
        {labels.map((label, i) => {
          const entry = list.find((s) => s.voice === label)!
          return (
            // Keyed by position, not name: a rename must not remount the row the person is typing in.
            <CloneRow
              key={i}
              provider={provider}
              entry={entry}
              otherLabels={labels.filter((l) => l !== label)}
              onRename={(to) => onUpdate(renameClone(lines, list, label, to))}
              onRemove={() => onUpdate(removeClone(provider, lines, list, label))}
              onChange={(patch) => onUpdate({ speakers: list.map((s) => (s.voice === label ? { ...s, ...patch } : s)) })}
            />
          )
        })}
        <Button type="button" variant="outline" size="sm" className="w-full" disabled={labels.length >= max} onClick={add}>
          <Plus className="h-3 w-3 me-1" /> {t("audiocfg.cloneAdd")}
        </Button>
        <p className="text-[11px] text-muted-foreground">{t("audiocfg.clonesLimit", { max })}</p>
      </div>
    </>
  )
}
