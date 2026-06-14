import { useEffect, useRef, useState } from "react"
import { VoiceBrowser } from "../config-panels/voice-browser"
import { textToSpeech, lipSyncApi, voiceDesignApi, getJobStatusLean } from "@/lib/api"
import { useCreateVoiceClone } from "@/hooks/use-voice-clones"
import type { VoiceClone } from "@/lib/api"
import type { CharacterVoice } from "@/types/nodes"

type Mode = "browse" | "clone" | "design"

/**
 * Shared voice resource — the entity-agnostic core of the studio Voice page.
 *
 * Extracted verbatim from `character-studio/pages/voice-page.tsx` so the
 * character AND creature studios share one ~300-line voice surface (Browse /
 * Clone / Design-audition modes, the selected-voice card, and the Talk panel
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
 *  carries `audioUrl` (AUDIO_TYPES finalize: text-to-speech / voice-clone) and
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
    if (job.status === "failed" || job.status === "cancelled") return null
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}

export function VoiceResource({ voice: v, onVoiceChange, sourceImageUrl }: VoiceResourceProps) {
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
      else setError("Timed out or failed.")
    } catch {
      if (mounted.current) setError("Speech failed — try again.")
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
      if (!audio) { setError("Timed out or failed."); return }
      const ls = await lipSyncApi(sourceImageUrl, audio)
      const url = await pollJobUrl(ls.jobId, "videoUrl", () => mounted.current)
      if (!mounted.current) return
      if (url) setVideoUrl(url)
      else setError("Timed out or failed.")
    } catch {
      if (mounted.current) setError("Lip-sync failed — try again.")
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  const hasPortrait = !!sourceImageUrl

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
      <div className="flex gap-2">
        {(["browse", "clone", "design"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`text-[11px] px-3 py-1.5 rounded ${mode === m ? "bg-[#1a2744] text-[#3b82f6]" : "text-slate-400 hover:text-slate-200"}`}
          >
            {m === "browse" ? "Browse" : m === "clone" ? "Clone from audio" : "Design from text"}
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

      {mode === "clone" && (
        <ClonePanel
          onCloned={(c) =>
            setVoice({ voiceId: c.elevenlabsVoiceId, voiceName: c.name, voiceType: "custom", previewUrl: c.previewUrl })
          }
        />
      )}

      {mode === "design" && <DesignAuditionPanel />}

      {v?.voiceId && (
        <div className="border border-[#1e293b] rounded p-3 space-y-2">
          <div className="text-[12px] text-slate-200">
            {v.voiceName} <span className="text-[10px] text-slate-500">· {v.voiceType ?? "premade"}</span>
          </div>
          {v.previewUrl && <audio src={v.previewUrl} controls className="w-full h-8" />}
          <textarea
            value={v.traits}
            onChange={(e) => setVoice({ traits: e.target.value })}
            rows={2}
            placeholder="deep, calm, British accent"
            className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
          />
          <div className="border-t border-[#1e293b] pt-2 space-y-2">
            <div className="text-[10px] text-[#9db4ff]">▶ Talk</div>
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
                {busy === "speak" ? "Speaking…" : "🔊 Speak"}
              </button>
              <button
                disabled={busy !== null || !hasPortrait}
                title={!hasPortrait ? "Approve a portrait on Profile first" : ""}
                onClick={speakAndLipSync}
                className="text-[11px] px-3 py-1.5 rounded bg-[#1a1e25] text-slate-300 disabled:opacity-50"
              >
                {busy === "lipsync" ? "Rendering…" : "🎬 Speak + lip-sync portrait"}
              </button>
            </div>
            {!hasPortrait && (
              <div className="text-[9px] text-slate-500">
                Lip-sync needs an approved portrait — set one on the Profile page first.
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

/** Clone a voice from an uploaded audio sample. Wraps `useCreateVoiceClone()`
 *  (`mutate({ name, file: Blob })`); on success hands the new `VoiceClone` back
 *  to the page, which stores it as the selected voice (voiceType: "custom").
 *  Recording (mic) is available in the Browse tab's VoiceBrowser. */
function ClonePanel({ onCloned }: { onCloned: (c: VoiceClone) => void }) {
  const create = useCreateVoiceClone()
  const [name, setName] = useState("")
  const [file, setFile] = useState<File | null>(null)

  async function submit() {
    if (!name.trim() || !file) return
    const clone = await create.mutateAsync({ name: name.trim(), file })
    onCloned(clone)
  }

  return (
    <div className="border border-[#1e293b] rounded p-3 space-y-2">
      <div className="text-[10px] text-slate-400">Clone a voice from a 30s–2min clean audio sample.</div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Voice name (e.g. Narrator)"
        className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
      />
      <input
        type="file"
        accept=".wav,.mp3,.webm,.m4a,audio/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-[11px] text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-[#2a3b6e] file:px-2 file:py-1 file:text-[11px] file:text-[#cdd9ff]"
      />
      <button
        disabled={!name.trim() || !file || create.isPending}
        onClick={submit}
        className="text-[11px] px-3 py-1.5 rounded bg-[#2a3b6e] text-[#cdd9ff] disabled:opacity-50"
      >
        {create.isPending ? "Cloning…" : "Create voice"}
      </button>
      {create.isError && <div className="text-[9px] text-red-400">Clone failed — try a longer, cleaner sample.</div>}
    </div>
  )
}

const DESIGN_MIN_CHARS = 100

/** Design a voice from a text description and audition it (no persistence in
 *  this phase — "Save as voice" lands in Phase 4). `voiceDesignApi` requires the
 *  preview `text` to be ≥100 chars, so the textarea enforces it before enabling. */
function DesignAuditionPanel() {
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
      else setError("Timed out or failed.")
    } catch {
      if (mounted.current) setError("Audition failed — try again.")
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="border border-[#1e293b] rounded p-3 space-y-2">
      <div className="text-[10px] text-slate-400">Describe a voice, then audition it. (Saving designed voices comes later.)</div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="A warm, gravelly old storyteller with a slight Irish lilt"
        className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
      />
      <div className="text-[10px] text-slate-400">Preview line (≥{DESIGN_MIN_CHARS} chars)</div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
      />
      <div className={`text-[9px] ${tooShort ? "text-amber-400" : "text-slate-500"}`}>
        {text.trim().length}/{DESIGN_MIN_CHARS} characters
        {tooShort ? " — add more so the preview is long enough" : ""}
      </div>
      <button
        disabled={!description.trim() || tooShort || busy}
        onClick={audition}
        className="text-[11px] px-3 py-1.5 rounded bg-[#2a3b6e] text-[#cdd9ff] disabled:opacity-50"
      >
        {busy ? "Auditioning…" : "🔊 Audition"}
      </button>
      {error && <div className="text-[9px] text-red-400">{error}</div>}
      {audioUrl && <audio src={audioUrl} controls className="w-full" />}
    </div>
  )
}
