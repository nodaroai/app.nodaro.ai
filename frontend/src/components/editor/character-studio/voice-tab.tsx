import { VoiceBrowser } from "@/components/editor/config-panels/voice-browser"
import type { CharacterStudioState } from "./use-character-studio"

/**
 * Voice tab — reuses the existing ElevenLabs `VoiceBrowser` (search/preview/categories
 * for free) plus a free-form traits textarea. `showCustomVoices` is intentionally not
 * passed (defaults false): custom voice creation is not a Phase-1 studio feature.
 *
 * `state.staged.voice` is `CharacterVoice | null`. We store `null` when every field is
 * empty so the canvas node's "voice ✓" badge only lights up for a real selection.
 */
export function VoiceTab({ state }: { state: CharacterStudioState }) {
  const v = state.staged.voice
  const setVoice = (patch: Partial<{ voiceId: string; voiceName: string; traits: string }>) => {
    const base = v ?? { voiceId: "", voiceName: "", traits: "" }
    const next = { ...base, ...patch }
    state.patch({ voice: next.voiceId || next.voiceName || next.traits ? next : null })
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-lg">
      <div>
        <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-2">Voice</div>
        <VoiceBrowser
          value={v?.voiceId ?? ""}
          valueLabel={v?.voiceName}
          onSelect={(voiceId, voiceName) => setVoice({ voiceId, voiceName })}
        />
      </div>
      <div>
        <div className="text-[10px] text-slate-400 mb-1">Voice traits</div>
        <textarea
          value={v?.traits ?? ""}
          onChange={(e) => setVoice({ traits: e.target.value })}
          placeholder="deep, calm, British accent, slight rasp"
          rows={3}
          className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
        />
        <div className="text-[9px] text-slate-500 mt-1">Stored now; auto-injected into speech nodes in a later release.</div>
      </div>
    </div>
  )
}
