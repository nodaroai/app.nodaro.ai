import { useEffect, useRef, useState } from "react"
import { VoiceBrowser } from "../config-panels/voice-browser"
import { textToSpeech, lipSyncApi, voiceDesignApi, getJobStatusLean } from "@/lib/api"
import type { CharacterVoice } from "@/types/nodes"
import { useT, tx, type MessageKey } from "@/lib/i18n"

/** The voice source's caption beside the chosen voice. */
const VOICE_TYPE_KEYS: Record<"premade" | "custom" | "library", MessageKey> = {
  premade: "voice.type.premade",
  custom: "voice.type.custom",
  library: "voice.type.library",
}

type Mode = "browse" | "design"

/**
 * Shared voice resource — the entity-agnostic core of the studio Voice page.
 *
 * Extracted verbatim from `character-studio/pages/voice-page.tsx` so the
 * character AND creature studios share one ~300-line voice surface (Browse /
 * Design-audition modes, the selected-voice card, and the Talk panel
 * that speaks + lip-syncs against the entity's main image). The ONLY coupling
 * to the host studio is the minimal `{ voice, onVoiceChange, sourceImageUrl }`
 * interface — there is no read of `state.staged` / `state.patch` here, so the
 * same component drives any entity that stores a `CharacterVoice`.
 *
 * Character behavior is byte-identical to the pre-extraction voice-page: the
 * mode tabs, accent classes, the `setVoice` null-collapse rule, and the
 * unmount-safe job polling all carry over unchanged.
 */
export interface VoiceResourceProps {
  /** The currently-selected voice (or null when none is set). */
  readonly voice: CharacterVoice | null
  /** Persist a new voice selection (or null to clear it). The host studio maps
   *  this to its own patch (`state.patch({ voice })`). */
  readonly onVoiceChange: (voice: CharacterVoice | null) => void
  /** The entity's main image URL — drives the "Speak + lip-sync portrait"
   *  affordance (disabled until a portrait/main image exists). */
  readonly sourceImageUrl: string
}

/** Studio-side job poll → output URL. The canvas `pollJobToCompletion` takes an
 *  ExecutionContext and returns ONLY output_data.imageUrl — useless for audio/video
 *  here. Confirmed: getJobStatusLean returns a JobStatusLean whose `output_data`
 *  carries `audioUrl` (AUDIO_TYPES finalize: text-to-speech) and
 *  `videoUrl` (VIDEO_TYPES finalize: lip-sync).
 *
 *  Cancellable: the Talk/Design preview is page-local and ephemeral, and
 *  `VoiceResource` unmounts on every studio navigation (StudioShell renders only the
 *  active page). `isMounted()` is checked at the top of each iteration so an
 *  orphaned poll returns early instead of running its full ~3 min budget — the
 *  job still finishes server-side, there's just nowhere to show the preview. */
async function pollJobUrl(
  jobId: string,
  field: "audioUrl" | "videoUrl",
  isMounted: () => boolean,
): Promise<string | null> {
  for (let i = 0; i < 120; i++) {
    if (!isMounted()) return null
    const job = await getJobStatusLean(jobId)
    if (job.status === "completed") return (job.output_data?.[field] as string | undefined) ?? null
    // A held job is neither done nor failed, and it will outlive this ~3 min
    // budget by hours. Returning `null` would land in the caller's
    // "Timed out or failed." branch — the wrong story about a working gate.
    if (job.status === "pending_review") throw new JobAwaitingReviewError()
    if (job.status === "failed" || job.status === "cancelled") return null
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}

/** A job parked in `pending_review` is not a failure and not a timeout. Thrown
 *  so the preview says so instead of reporting the generic failure text. */
class JobAwaitingReviewError extends Error {
  constructor() {
    super(tx("node.review.awaiting"))
    this.name = "JobAwaitingReviewError"
  }
}

/** The caught error's own text when the job is merely held; the caller's
 *  generic sentence otherwise. */
function previewErrorText(e: unknown, fallback: string): string {
  return e instanceof JobAwaitingReviewError ? e.message : fallback
}

export function VoiceResource({ voice: v, onVoiceChange, sourceImageUrl }: VoiceResourceProps) {
  const t = useT()
  const [mode, setMode] = useState<Mode>("browse")
  const [line, setLine] = useState("Hi, I'm here. Let's get started.")
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | "speak" | "lipsync">(null)
  const [error, setError] = useState<string | null>(null)

  // VoiceResource unmounts on every studio navigation (StudioShell renders only the
  // active page). The Talk preview's job poll runs up to ~3 min — guard every
  // setState and stop the poll once unmounted so we never touch state (or fire a
  // second lip-sync job) after the user has left this page.
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  const setVoice = (patch: Partial<CharacterVoice>) => {
    const base: CharacterVoice = v ?? { voiceId: "", voiceName: "", traits: "" }
    const next = { ...base, ...patch }
    onVoiceChange(next.voiceId || next.voiceName || next.traits ? next : null)
  }

  async function speak() {
    if (!v?.voiceId) return
    setBusy("speak"); setAudioUrl(null); setError(null)
    try {
      const { jobId } = await textToSpeech(line, v.voiceId, v.ttsProvider, undefined, { voiceType: v.voiceType })
      const url = await pollJobUrl(jobId, "audioUrl", () => mounted.current)
      if (!mounted.current) return
      if (url) setAudioUrl(url)
      else setError(tx("entity.voiceTimedOut"))
    } catch (e) {
      if (mounted.current) setError(previewErrorText(e, tx("entity.speechFailed")))
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  async function speakAndLipSync() {
    if (!v?.voiceId || !sourceImageUrl) return
    setBusy("lipsync"); setVideoUrl(null); setError(null)
    try {
      const tts = await textToSpeech(line, v.voiceId, v.ttsProvider, undefined, { voiceType: v.voiceType })
      const audio = await pollJobUrl(tts.jobId, "audioUrl", () => mounted.current)
      // User left mid-render — don't start a SECOND (lip-sync) job after unmount.
      if (!mounted.current) return
      if (!audio) { setError(tx("entity.voiceTimedOut")); return }
      const ls = await lipSyncApi(sourceImageUrl, audio)
      const url = await pollJobUrl(ls.jobId, "videoUrl", () => mounted.current)
      if (!mounted.current) return
      if (url) setVideoUrl(url)
      else setError(tx("entity.voiceTimedOut"))
    } catch (e) {
      if (mounted.current) setError(previewErrorText(e, tx("entity.lipSyncFailed")))
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const hasPortrait = !!sourceImageUrl

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
      <div className="flex gap-2">
        {(["browse", "design"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-[11px] px-3 py-1.5 rounded ${mode === m ? "bg-[#1a2744] text-[#3b82f6]" : "text-slate-400 hover:text-slate-200"}`}
          >
            {m === "browse" ? t("explore.browse") : t("entity.voiceDesignFromText")}
          </button>
        ))}
      </div>

      {mode === "browse" && (
        <VoiceBrowser
          value={v?.voiceId ?? ""}
          valueLabel={v?.voiceName}
          showCustomVoices
          onSelect={(voiceId, voiceName, voiceType, meta) =>
            setVoice({ voiceId, voiceName, voiceType, ttsProvider: meta?.recommendedProvider })
          }
        />
      )}

      {mode === "design" && <DesignAuditionPanel />}

      {v?.voiceId && (
        <div className="border border-[#1e293b] rounded p-3 space-y-2">
          <div className="text-[12px] text-slate-200">
            {v.voiceName} <span className="text-[10px] text-slate-500">· {t(VOICE_TYPE_KEYS[v.voiceType ?? "premade"])}</span>
          </div>
          {v.previewUrl && <audio src={v.previewUrl} controls className="w-full h-8" />}
          <textarea
            value={v.traits}
            onChange={(e) => setVoice({ traits: e.target.value })}
            rows={2}
            placeholder={t("entity.voiceTraitsPlaceholder")}
            className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
          />
          <div className="border-t border-[#1e293b] pt-2 space-y-2">
            <div className="text-[10px] text-[#9db4ff]">{t("entity.voiceTalk")}</div>
            <textarea
              value={line}
              onChange={(e) => setLine(e.target.value)}
              rows={2}
              className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
            />
            <div className="flex gap-2">
              <button
                disabled={busy !== null}
                onClick={speak}
                className="text-[11px] px-3 py-1.5 rounded bg-[#2a3b6e] text-[#cdd9ff] disabled:opacity-50"
              >
                {busy === "speak" ? t("entity.voiceSpeaking") : t("entity.voiceSpeak")}
              </button>
              <button
                disabled={busy !== null || !hasPortrait}
                title={!hasPortrait ? t("entity.approvePortraitFirst") : ""}
                onClick={speakAndLipSync}
                className="text-[11px] px-3 py-1.5 rounded bg-[#1a1e25] text-slate-300 disabled:opacity-50"
              >
                {busy === "lipsync" ? t("entity.voiceRendering") : t("entity.voiceSpeakLipSync")}
              </button>
            </div>
            {!hasPortrait && (
              <div className="text-[9px] text-slate-500">
                {t("entity.lipSyncNeedsPortrait")}
              </div>
            )}
            {error && <div className="text-[9px] text-red-400">{error}</div>}
            {audioUrl && <audio src={audioUrl} controls className="w-full" />}
            {videoUrl && <video src={videoUrl} controls className="w-full rounded" />}
          </div>
        </div>
      )}
    </div>
  )
}

const DESIGN_MIN_CHARS = 100

/** Design a voice from a text description and audition it (no persistence in
 *  this phase — "Save as voice" lands in Phase 4). `voiceDesignApi` requires the
 *  preview `text` to be ≥100 chars, so the textarea enforces it before enabling. */
function DesignAuditionPanel() {
  const t = useT()
  const [description, setDescription] = useState("")
  const [text, setText] = useState(
    "Hello there. This is a preview of the voice you are designing — read aloud so you can hear its tone, pacing, and character before you commit to it.",
  )
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tooShort = text.trim().length < DESIGN_MIN_CHARS

  // Same unmount-safety as the Talk preview — this panel disappears on studio
  // navigation while the audition poll may still be running.
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])

  async function audition() {
    if (!description.trim() || tooShort) return
    setBusy(true); setAudioUrl(null); setError(null)
    try {
      const { jobId } = await voiceDesignApi(text, description)
      const url = await pollJobUrl(jobId, "audioUrl", () => mounted.current)
      if (!mounted.current) return
      if (url) setAudioUrl(url)
      else setError(tx("entity.voiceTimedOut"))
    } catch (e) {
      if (mounted.current) setError(previewErrorText(e, tx("entity.auditionFailed")))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="border border-[#1e293b] rounded p-3 space-y-2">
      <div className="text-[10px] text-slate-400">{t("entity.voiceDesignIntro")}</div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder={t("entity.voiceDesignPlaceholder")}
        className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
      />
      <div className="text-[10px] text-slate-400">{t("entity.voicePreviewLine", { min: DESIGN_MIN_CHARS })}</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
      />
      <div className={`text-[9px] ${tooShort ? "text-amber-400" : "text-slate-500"}`}>
        {tooShort
          ? t("entity.voiceCharCountShort", { len: text.trim().length, min: DESIGN_MIN_CHARS })
          : t("entity.voiceCharCount", { len: text.trim().length, min: DESIGN_MIN_CHARS })}
      </div>
      <button
        disabled={!description.trim() || tooShort || busy}
        onClick={audition}
        className="text-[11px] px-3 py-1.5 rounded bg-[#2a3b6e] text-[#cdd9ff] disabled:opacity-50"
      >
        {busy ? t("entity.voiceAuditioning") : t("entity.voiceAudition")}
      </button>
      {error && <div className="text-[9px] text-red-400">{error}</div>}
      {audioUrl && <audio src={audioUrl} controls className="w-full" />}
    </div>
  )
}
