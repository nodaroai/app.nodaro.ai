"use client"

import { useMemo, useCallback, useEffect } from "react"
import { Plus, Trash2, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TagTextarea } from "./tag-textarea"
import { getLanguagesForModel, ALL_LANGUAGES, isV3Model } from "@/lib/audio-tags"
import { SUNO_SUGGESTION_ITEMS, SUNO_LYRICS_SUGGESTION_ITEMS, SUNO_STYLE_SUGGESTION_ITEMS } from "@/lib/suno-tags"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { VoiceBrowser } from "./voice-browser"
import { DEFAULT_DIALOGUE_VOICE } from "@/lib/tts-voices"
import type {
  TextToSpeechData,
  TextToAudioData,
  AudioIsolationData,
  SunoGenerateData,
  SunoCoverData,
  SunoExtendData,
  SunoLyricsData,
  SunoSeparateData,
  SunoMusicVideoData,
  SunoMashupData,
  SunoReplaceSectionData,
  SunoStyleBoostData,
  SunoAddInstrumentalData,
  SunoAddVocalsData,
  SunoConvertWavData,
  SunoUploadExtendData,
  TranscribeData,
  LipSyncData,
  TextToDialogueData,
  DialogueLine,
  VoiceChangerData,
  DubbingData,
  VoiceRemixData,
  VoiceDesignData,
  ForcedAlignmentData,
  GeneratedScript,
} from "@/types/nodes"
import { MappableField } from "./mappable-field"
import { PromptHelperButton } from "./prompt-helper-button"
import { getCachedCredits, prefetchModelCredits } from "@/hooks/use-model-credits"
import { REPLICATE_LIP_SYNC_PROVIDERS } from "@nodaro-shared/model-constants"
import type { ConfigProps } from "./types"

export function TextToSpeechConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<TextToSpeechData>) {
  const textSource = data.textSource || "connected"
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Text Source</Label>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => onUpdate({ textSource: "connected" })}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${textSource === "connected" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            From connected node
          </button>
          <button
            type="button"
            onClick={() => onUpdate({ textSource: "direct" })}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${textSource === "direct" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            Write directly
          </button>
        </div>
      </div>
      <MappableField field="provider" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="voice">
        <Select
          value={data.provider === "elevenlabs" ? "elevenlabs-v3" : (data.provider || "elevenlabs-v3")}
          onValueChange={(v) => onUpdate({ provider: v as TextToSpeechData["provider"] })}
        >
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="elevenlabs-multilingual">ElevenLabs Multilingual v2</SelectItem>
            <SelectItem value="elevenlabs-turbo">ElevenLabs Turbo v2.5 (fast)</SelectItem>
            <SelectItem value="elevenlabs-v3">ElevenLabs v3 (recommended)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {textSource === "direct" && (
        <div>
          <Label>Text</Label>
          <TagTextarea
            rows={4}
            value={data.directText || ""}
            onChange={(v) => onUpdate({ directText: v })}
            placeholder="Enter text to convert to speech..."
            provider={data.provider}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
          <p className="text-[10px] text-muted-foreground mt-1">Type [ or / for audio tags</p>
        </div>
      )}
      <div>
        <Label>Voice</Label>
        <VoiceBrowser
          value={data.voiceId || "Rachel"}
          valueLabel={data.voiceDisplayName || data.voiceLabel}
          onSelect={(id, name, voiceType) => {
            if (voiceType === "custom" || voiceType === "library") {
              onUpdate({ voiceId: id, voiceType: voiceType, voiceDisplayName: name, voiceLabel: name })
            } else {
              onUpdate({ voiceId: id, voiceType: "premade", voiceDisplayName: name, voiceLabel: name })
            }
          }}
          showCustomVoices
        />
      </div>
      <div>
        <Label>Language</Label>
        <Select
          value={data.languageCode || "auto"}
          onValueChange={(v) => onUpdate({ languageCode: v === "auto" ? "" : v })}
        >
          <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            {getLanguagesForModel(data.provider).map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="stability">Stability ({data.stability ?? 0.5})</Label>
        <Input id="stability" type="range" min={0} max={1} step={0.05} value={data.stability ?? 0.5} onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Variable</span><span>Stable</span></div>
      </div>
      {!isV3Model(data.provider) && (
        <>
          <div>
            <Label htmlFor="similarityBoost">Similarity ({data.similarityBoost ?? 0.75})</Label>
            <Input id="similarityBoost" type="range" min={0} max={1} step={0.05} value={data.similarityBoost ?? 0.75} onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })} className="h-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Low</span><span>High</span></div>
          </div>
          <div>
            <Label htmlFor="style">Style Exaggeration ({data.style ?? 0})</Label>
            <Input id="style" type="range" min={0} max={1} step={0.05} value={data.style ?? 0} onChange={(e) => onUpdate({ style: parseFloat(e.target.value) })} className="h-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>None</span><span>Exaggerated</span></div>
          </div>
          <div>
            <Label htmlFor="speed">Speed ({data.speed ?? 1})</Label>
            <Input id="speed" type="range" min={0.7} max={1.2} step={0.05} value={data.speed ?? 1} onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })} className="h-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0.7x</span><span>1.2x</span></div>
          </div>
        </>
      )}
    </div>
  )
}

export function TextToAudioConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<TextToAudioData>) {
  const isSfx = data.provider === "elevenlabs-sfx"
  const maxPromptLen = isSfx ? 450 : 2000
  const minDuration = isSfx ? 0.5 : 1
  const maxDuration = isSfx ? 22 : 30

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="text-to-audio" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <TagTextarea
          rows={3}
          value={data.prompt}
          onChange={(v) => {
            if (v.length <= maxPromptLen) onUpdate({ prompt: v })
          }}
          placeholder={isSfx ? "Describe the sound effect (max 450 chars)..." : "Describe the sound effect (e.g. dog barking, rain on window)..."}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        {isSfx && (
          <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/{maxPromptLen}</p>
        )}
      </MappableField>
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "elevenlabs-sfx"}
          onValueChange={(v) => onUpdate({ provider: v as TextToAudioData["provider"] })}
        >
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {/* Replicate disabled */}
            {/* <SelectItem value="tangoflux">TangoFlux (default)</SelectItem> */}
            <SelectItem value="elevenlabs-sfx">ElevenLabs SFX v2</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="duration" label="Duration (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={minDuration}
          max={maxDuration}
          step={isSfx ? 0.5 : 1}
          value={data.duration ?? ""}
          onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
        />
      </MappableField>
      {isSfx && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Loop</label>
            <Select value={data.loop ? "true" : "false"} onValueChange={(v) => onUpdate({ loop: v === "true" })}>
              <SelectTrigger aria-label="Loop"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="false">Off</SelectItem>
                <SelectItem value="true">On (seamless loop)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Prompt Influence</label>
              <span className="text-xs text-muted-foreground">{(data.promptInfluence ?? 0.3).toFixed(1)}</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.1}
              value={data.promptInfluence ?? 0.3}
              onChange={(e) => onUpdate({ promptInfluence: parseFloat(e.target.value) })}
              className="w-full accent-[#ff0073]"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>More random</span><span>More faithful</span></div>
          </div>
        </>
      )}
    </div>
  )
}

export function SunoGenerateConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoGenerateData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<PromptHelperButton nodeType="suno-generate" currentPrompt={data.prompt || ""} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />}>
        <TagTextarea
          rows={3}
          value={data.prompt}
          onChange={(v) => { if (v.length <= 3000) onUpdate({ prompt: v }) }}
          placeholder="Describe the song... (type [ or / for tags)"
          maxLength={3000}
          customTags={SUNO_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/3000</p>
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoGenerateData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V4">Suno V4</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={4}
          value={data.lyrics ?? ""}
          onChange={(v) => { if (v.length <= 3000) onUpdate({ lyrics: v }) }}
          placeholder="Write custom lyrics... (type [ or / for metatags)"
          maxLength={3000}
          customTags={SUNO_LYRICS_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.style ?? ""}
          onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }}
          placeholder="e.g. pop, rock, jazz, lo-fi... (type [ or / for suggestions)"
          maxLength={500}
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativeStyle ?? ""}
          onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }}
          placeholder="Styles to avoid... (type [ or / for suggestions)"
          maxLength={500}
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}>
          <SelectTrigger aria-label="Vocal Gender (optional)"><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">Style Weight</label><span className="text-xs text-muted-foreground">{data.styleWeight ?? 0.5}</span></div>
        <input type="range" min={0} max={1} step={0.01} value={data.styleWeight ?? 0.5} onChange={(e) => onUpdate({ styleWeight: parseFloat(e.target.value) })} className="w-full accent-[#ff0073]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">Weirdness</label><span className="text-xs text-muted-foreground">{data.weirdnessConstraint ?? 0}</span></div>
        <input type="range" min={0} max={1} step={0.01} value={data.weirdnessConstraint ?? 0} onChange={(e) => onUpdate({ weirdnessConstraint: parseFloat(e.target.value) })} className="w-full accent-[#ff0073]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between"><label className="text-xs font-medium text-muted-foreground">Audio Weight</label><span className="text-xs text-muted-foreground">{data.audioWeight ?? 0.5}</span></div>
        <input type="range" min={0} max={1} step={0.01} value={data.audioWeight ?? 0.5} onChange={(e) => onUpdate({ audioWeight: parseFloat(e.target.value) })} className="w-full accent-[#ff0073]" />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-instrumental" checked={data.instrumental ?? false} onChange={(e) => onUpdate({ instrumental: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-instrumental" className="text-xs font-medium text-muted-foreground">Instrumental (no vocals)</label>
      </div>
      {((data.sunoTaskId as string | undefined) || (data.sunoTrackId as string | undefined)) && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Output IDs</label>
          {(data.sunoTaskId as string | undefined) && (
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] text-muted-foreground">Task ID</label>
              <div className="text-[11px] font-mono bg-muted/40 px-2 py-1 rounded break-all select-all">{data.sunoTaskId as string}</div>
            </div>
          )}
          {(data.sunoTrackId as string | undefined) && (
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] text-muted-foreground">Track ID</label>
              <div className="text-[11px] font-mono bg-muted/40 px-2 py-1 rounded break-all select-all">{data.sunoTrackId as string}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SunoCoverConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoCoverData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.prompt}
          onChange={(v) => { if (v.length <= 3000) onUpdate({ prompt: v }) }}
          placeholder="Describe the cover style... (type [ or / for tags)"
          maxLength={3000}
          customTags={SUNO_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/3000</p>
      </MappableField>
      <MappableField field="uploadUrl" label="Source Audio URL" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.uploadUrl ?? ""} onChange={(e) => onUpdate({ uploadUrl: e.target.value })} placeholder="URL of the audio to cover (or connect an audio node)" />
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoCoverData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V4">Suno V4</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Cover title" />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={4}
          value={data.lyrics ?? ""}
          onChange={(v) => { if (v.length <= 3000) onUpdate({ lyrics: v }) }}
          placeholder="Write custom lyrics for the cover... (type [ or / for metatags)"
          maxLength={3000}
          customTags={SUNO_LYRICS_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.style ?? ""}
          onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }}
          placeholder="e.g. pop, rock, jazz, lo-fi... (type [ or / for suggestions)"
          maxLength={500}
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativeStyle ?? ""}
          onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }}
          placeholder="Styles to avoid... (type [ or / for suggestions)"
          maxLength={500}
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}>
          <SelectTrigger aria-label="Vocal Gender (optional)"><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-cover-instrumental" checked={data.instrumental ?? false} onChange={(e) => onUpdate({ instrumental: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-cover-instrumental" className="text-xs font-medium text-muted-foreground">Instrumental (no vocals)</label>
      </div>
    </div>
  )
}

export function SunoExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoExtendData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="audioId" label="Audio ID (from Suno node)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.audioId ?? ""} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="Suno track ID (auto-filled from connected node)" />
      </MappableField>
      <MappableField field="continueAt" label="Continue From (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} value={data.continueAt ?? 0} onChange={(e) => onUpdate({ continueAt: Number(e.target.value) })} placeholder="0" />
      </MappableField>
      <MappableField field="prompt" label="Extension Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.prompt ?? ""}
          onChange={(v) => { if (v.length <= 5000) onUpdate({ prompt: v }) }}
          placeholder="Describe how the music should continue... (type [ or / for tags)"
          maxLength={5000}
          customTags={SUNO_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className="text-xs text-muted-foreground mt-1">{(data.prompt ?? "").length}/5000</p>
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoExtendData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V4">Suno V4</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={80} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Extended track title" />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.style ?? ""}
          onChange={(v) => { if (v.length <= 1000) onUpdate({ style: v }) }}
          placeholder="e.g. pop, rock, jazz... (type [ or / for suggestions)"
          maxLength={1000}
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-extend-customParams" checked={data.defaultParamFlag ?? true} onChange={(e) => onUpdate({ defaultParamFlag: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-extend-customParams" className="text-xs font-medium text-muted-foreground">Use default parameters (uncheck to customize)</label>
      </div>
    </div>
  )
}

export function SunoLyricsConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoLyricsData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.prompt}
          onChange={(v) => { if (v.length <= 1000) onUpdate({ prompt: v }) }}
          placeholder="Describe the lyrics you want... (type [ or / for genre/mood suggestions)"
          maxLength={1000}
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/1000</p>
      </MappableField>
      {data.generatedText && (
        <div className="rounded-md border bg-muted/30 p-2 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
          {data.generatedTitle && <p className="font-medium mb-1">{data.generatedTitle}</p>}
          {data.generatedText}
        </div>
      )}
    </div>
  )
}

export function SunoSeparateConfig({ data, onUpdate }: { readonly data: SunoSeparateData; readonly onUpdate: (updates: Partial<SunoSeparateData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Separation Type</label>
        <Select value={data.type} onValueChange={(v) => onUpdate({ type: v as SunoSeparateData["type"] })}>
          <SelectTrigger aria-label="Separation Type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="separate_vocal">Vocal / Instrumental</SelectItem>
            <SelectItem value="split_stem">12 Stems</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Task ID</label>
        <Input value={data.taskId} onChange={(e) => onUpdate({ taskId: e.target.value })} placeholder="Suno task ID" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio ID</label>
        <Input value={data.audioId} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="Suno audio ID" />
      </div>
      {data.vocalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Vocal</label>
          <audio src={data.vocalUrl} controls className="w-full h-8" preload="none" />
        </div>
      )}
      {data.instrumentalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Instrumental</label>
          <audio src={data.instrumentalUrl} controls className="w-full h-8" preload="none" />
        </div>
      )}
      {data.stems && Object.keys(data.stems).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Stems</label>
          {Object.entries(data.stems).map(([name, url]) => (
            <div key={name} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground capitalize">{name.replace(/_/g, " ")}</span>
              <audio src={url} controls className="w-full h-8" preload="none" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SunoMusicVideoConfig({ data, onUpdate }: { readonly data: SunoMusicVideoData; readonly onUpdate: (updates: Partial<SunoMusicVideoData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Task ID</label>
        <Input value={data.taskId} onChange={(e) => onUpdate({ taskId: e.target.value })} placeholder="From upstream Suno node" />
        <p className="text-[10px] text-muted-foreground mt-1">Auto-filled when connected to a Suno node</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audio ID</label>
        <Input value={data.audioId} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="From upstream Suno node" />
        <p className="text-[10px] text-muted-foreground mt-1">Auto-filled when connected to a Suno node</p>
      </div>
      {data.generatedVideoUrl && (
        <div className="rounded-md border overflow-hidden">
          <video src={data.generatedVideoUrl} controls className="w-full" />
        </div>
      )}
    </div>
  )
}

export function SunoMashupConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoMashupData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Combine two audio tracks into a mashup. Connect two audio sources to the left handles.</p>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoMashupData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V4">Suno V4</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex items-center gap-2">
        <Checkbox id="mashup-custom-mode" checked={data.customMode} onCheckedChange={(v) => onUpdate({ customMode: !!v })} />
        <Label htmlFor="mashup-custom-mode" className="text-xs">Custom Mode</Label>
      </div>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.style ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }} placeholder="e.g. pop, rock, jazz..." maxLength={500} customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.negativeStyle ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }} placeholder="Styles to avoid..." maxLength={500} customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? "" : v })}>
          <SelectTrigger aria-label="Vocal Gender"><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
    </div>
  )
}

export function SunoReplaceSectionConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoReplaceSectionData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Replace a section of an existing track. Connect an audio source.</p>
      <MappableField field="infillStartS" label="Start Time (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} step={1} value={data.infillStartS ?? ""} onChange={(e) => onUpdate({ infillStartS: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="0" />
      </MappableField>
      <MappableField field="infillEndS" label="End Time (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} step={1} value={data.infillEndS ?? ""} onChange={(e) => onUpdate({ infillEndS: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="30" />
      </MappableField>
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={3} value={data.prompt ?? ""} onChange={(v) => { if (v.length <= 3000) onUpdate({ prompt: v }) }} placeholder="Describe the replacement..." maxLength={3000} customTags={SUNO_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="tags" label="Tags (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.tags ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ tags: v }) }} placeholder="Style tags..." maxLength={500} customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
    </div>
  )
}

export function SunoStyleBoostConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs }: ConfigProps<SunoStyleBoostData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Enhance and improve style text using Suno AI.</p>
      <MappableField field="content" label="Content" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea rows={4} value={data.content ?? ""} onChange={(e) => { if (e.target.value.length <= 3000) onUpdate({ content: e.target.value }) }} placeholder="Enter style text to enhance..." maxLength={3000} />
        <p className="text-xs text-muted-foreground mt-1">{(data.content ?? "").length}/3000</p>
      </MappableField>
      {data.generatedText && (
        <div>
          <Label>Result</Label>
          <div className="rounded-md border bg-muted/30 p-2 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
            {data.generatedText}
          </div>
        </div>
      )}
    </div>
  )
}

export function SunoAddInstrumentalConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoAddInstrumentalData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Add instrumental accompaniment to a track. Connect an audio source.</p>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoAddInstrumentalData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
    </div>
  )
}

export function SunoAddVocalsConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoAddVocalsData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Add vocals to an instrumental track. Connect an audio source.</p>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoAddVocalsData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
    </div>
  )
}

export function SunoConvertWavConfig({ data }: { readonly data: SunoConvertWavData; readonly onUpdate: (updates: Partial<SunoConvertWavData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Convert a Suno track to WAV format. Connect an audio source.</p>
      <p className="text-[10px] text-muted-foreground">No additional settings required. The connected audio will be converted to high-quality WAV.</p>
    </div>
  )
}

export function SunoUploadExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoUploadExtendData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Extend a track from uploaded audio. Connect an audio source.</p>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5"} onValueChange={(v) => onUpdate({ model: v as SunoUploadExtendData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="V4">Suno V4</SelectItem>
            <SelectItem value="V4_5">Suno V4.5</SelectItem>
            <SelectItem value="V4_5ALL">Suno V4.5 All</SelectItem>
            <SelectItem value="V4_5PLUS">Suno V4.5 Plus</SelectItem>
            <SelectItem value="V5">Suno V5 (latest)</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="prompt" label="Prompt (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={3} value={data.prompt ?? ""} onChange={(v) => { if (v.length <= 3000) onUpdate({ prompt: v }) }} placeholder="Describe the extension..." maxLength={3000} customTags={SUNO_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="continueAt" label="Continue At (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} step={1} value={data.continueAt ?? ""} onChange={(e) => onUpdate({ continueAt: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="0" />
      </MappableField>
      <div className="flex items-center gap-2">
        <Checkbox id="upload-extend-default" checked={data.defaultParamFlag} onCheckedChange={(v) => onUpdate({ defaultParamFlag: !!v })} />
        <Label htmlFor="upload-extend-default" className="text-xs">Use Default Parameters</Label>
      </div>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.style ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }} placeholder="e.g. pop, rock, jazz..." maxLength={500} customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.negativeStyle ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }} placeholder="Styles to avoid..." maxLength={500} customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="vocalGender" label="Vocal Gender (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? "" : v })}>
          <SelectTrigger aria-label="Vocal Gender"><SelectValue placeholder="Auto" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
    </div>
  )
}

export function TranscribeConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs }: ConfigProps<TranscribeData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.provider || "elevenlabs-stt"} onValueChange={(v) => onUpdate({ provider: v as TranscribeData["provider"] })}>
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {/* Replicate disabled */}
            {/* <SelectItem value="whisper">Whisper (default)</SelectItem> */}
            {/* <SelectItem value="incredibly-fast-whisper">Incredibly Fast Whisper</SelectItem> */}
            <SelectItem value="elevenlabs-stt">ElevenLabs STT</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="language" label="Language" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.language || "auto"} onValueChange={(v) => onUpdate({ language: v })}>
          <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto Detect</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="he">Hebrew</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="it">Italian</SelectItem>
            <SelectItem value="pt">Portuguese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ko">Korean</SelectItem>
            <SelectItem value="ar">Arabic</SelectItem>
            <SelectItem value="ru">Russian</SelectItem>
            <SelectItem value="hi">Hindi</SelectItem>
            <SelectItem value="nl">Dutch</SelectItem>
            <SelectItem value="tr">Turkish</SelectItem>
            <SelectItem value="pl">Polish</SelectItem>
            <SelectItem value="sv">Swedish</SelectItem>
            <SelectItem value="th">Thai</SelectItem>
            <SelectItem value="vi">Vietnamese</SelectItem>
            <SelectItem value="uk">Ukrainian</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {data.provider === "elevenlabs-stt" && (
        <>
          <div className="flex items-center gap-2">
            <Checkbox
              id="diarize"
              checked={data.diarize ?? false}
              onCheckedChange={(v: boolean) => onUpdate({ diarize: v })}
            />
            <Label htmlFor="diarize">Speaker Diarization</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="tagAudioEvents"
              checked={data.tagAudioEvents ?? false}
              onCheckedChange={(v: boolean) => onUpdate({ tagAudioEvents: v })}
            />
            <Label htmlFor="tagAudioEvents">Tag Audio Events</Label>
          </div>
        </>
      )}
    </div>
  )
}

export function LipSyncConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs }: ConfigProps<LipSyncData>) {
  useEffect(() => {
    prefetchModelCredits([
      "kling-avatar", "kling-avatar-pro", "infinitalk", "infinitalk:480p",
      "latentsync", "wav2lip", "video-retalking", "sadtalker",
    ])
  }, [])

  const provider = data.provider || "kling-avatar"
  const isKie = !REPLICATE_LIP_SYNC_PROVIDERS.has(provider as never)

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={provider} onValueChange={(v) => onUpdate({ provider: v as LipSyncData["provider"] })}>
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="infinitalk">{`Infinitalk (${getCachedCredits("infinitalk:480p") ?? 11}–${getCachedCredits("infinitalk") ?? 42} CR)`}</SelectItem>
            <SelectItem value="kling-avatar">{`Kling Avatar (${getCachedCredits("kling-avatar") ?? 28} CR)`}</SelectItem>
            <SelectItem value="kling-avatar-pro">{`Kling Avatar Pro (${getCachedCredits("kling-avatar-pro") ?? 56} CR)`}</SelectItem>
            <SelectItem value="latentsync">{`LatentSync (${getCachedCredits("latentsync") ?? 5} CR)`}</SelectItem>
            <SelectItem value="sadtalker">{`SadTalker (${getCachedCredits("sadtalker") ?? 9} CR)`}</SelectItem>
            <SelectItem value="video-retalking">{`Video-Retalking (${getCachedCredits("video-retalking") ?? 20} CR)`}</SelectItem>
            <SelectItem value="wav2lip">{`Wav2Lip (${getCachedCredits("wav2lip") ?? 1} CR)`}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>

      {/* Resolution — KIE providers only */}
      {isKie && (
        <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select value={data.resolution || "720p"} onValueChange={(v) => onUpdate({ resolution: v as LipSyncData["resolution"] })}>
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="480p">480p</SelectItem>
              <SelectItem value="720p">720p (default)</SelectItem>
            </SelectContent>
          </Select>
        </MappableField>
      )}

      {/* Motion Prompt — KIE providers only */}
      {isKie && (
        <MappableField field="prompt" label="Motion Prompt (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Textarea rows={2} value={data.prompt ?? ""} onChange={(e) => onUpdate({ prompt: e.target.value })} placeholder="Optional: describe head/expression motions..." />
        </MappableField>
      )}

      {/* LatentSync params */}
      {provider === "latentsync" && (
        <>
          <div>
            <Label>Guidance Scale ({data.guidanceScale ?? 2})</Label>
            <Slider min={1} max={3} step={0.1} value={[data.guidanceScale ?? 2]} onValueChange={(vals) => onUpdate({ guidanceScale: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">Higher = better sync but may cause distortion</p>
          </div>
          <div>
            <Label>Inference Steps ({data.inferenceSteps ?? 20})</Label>
            <Slider min={20} max={50} step={1} value={[data.inferenceSteps ?? 20]} onValueChange={(vals) => onUpdate({ inferenceSteps: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">More steps = higher quality, slower</p>
          </div>
          <div>
            <Label>Seed</Label>
            <Input type="number" value={data.seed ?? 0} onChange={(e) => onUpdate({ seed: parseInt(e.target.value) || 0 })} placeholder="0 = random" />
          </div>
        </>
      )}

      {/* Wav2Lip params */}
      {provider === "wav2lip" && (
        <>
          <div>
            <Label>Face Padding</Label>
            <Input value={data.pads ?? "0 10 0 0"} onChange={(e) => onUpdate({ pads: e.target.value })} placeholder="top bottom left right" />
            <p className="text-xs text-muted-foreground mt-1">Padding for detected face bounding box</p>
          </div>
          <div className="flex items-center justify-between">
            <Label>Smooth</Label>
            <Switch checked={data.smooth !== false} onCheckedChange={(v) => onUpdate({ smooth: v })} />
          </div>
          <div>
            <Label>FPS</Label>
            <Input type="number" value={data.fps ?? 25} onChange={(e) => onUpdate({ fps: parseInt(e.target.value) || 25 })} />
            <p className="text-xs text-muted-foreground mt-1">Only applies when input is a static image</p>
          </div>
          <div>
            <Label>Resize Factor</Label>
            <Input type="number" min={1} max={4} value={data.resizeFactor ?? 1} onChange={(e) => onUpdate({ resizeFactor: parseInt(e.target.value) || 1 })} />
            <p className="text-xs text-muted-foreground mt-1">Reduce resolution by this factor</p>
          </div>
        </>
      )}

      {/* SadTalker params */}
      {provider === "sadtalker" && (
        <>
          <div>
            <Label>Face Enhancer</Label>
            <Select value={data.enhancer ?? "gfpgan"} onValueChange={(v) => onUpdate({ enhancer: v as "gfpgan" | "RestoreFormer" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gfpgan">GFPGAN</SelectItem>
                <SelectItem value="RestoreFormer">RestoreFormer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Preprocess</Label>
            <Select value={data.preprocess ?? "full"} onValueChange={(v) => onUpdate({ preprocess: v as "crop" | "resize" | "full" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="crop">Crop</SelectItem>
                <SelectItem value="resize">Resize</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Still Mode</Label>
            <Switch checked={data.still ?? false} onCheckedChange={(v) => onUpdate({ still: v })} />
          </div>
          <div>
            <Label>Pose Style ({data.poseStyle ?? 0})</Label>
            <Slider min={0} max={45} step={1} value={[data.poseStyle ?? 0]} onValueChange={(vals) => onUpdate({ poseStyle: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">Head movement pattern (0-45)</p>
          </div>
          <div>
            <Label>Expression Scale ({data.expressionScale ?? 1})</Label>
            <Slider min={0} max={3} step={0.1} value={[data.expressionScale ?? 1]} onValueChange={(vals) => onUpdate({ expressionScale: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">Expression motion strength</p>
          </div>
        </>
      )}

      {/* Video-Retalking has no configurable params */}
      {provider === "video-retalking" && (
        <p className="text-xs text-muted-foreground">
          Connect a talking-head video and audio track. Includes built-in face enhancement.
        </p>
      )}

      {/* Help text per provider category */}
      {isKie && (
        <p className="text-xs text-muted-foreground">
          Connect a portrait image and an audio track (speech/voiceover) to generate a talking head video.
        </p>
      )}
      {provider === "latentsync" && (
        <p className="text-xs text-muted-foreground">
          Connect a video and audio track. Best for singing — uses diffusion for high-quality lip sync.
        </p>
      )}
      {provider === "wav2lip" && (
        <p className="text-xs text-muted-foreground">
          Connect a video or image and audio track. Fast and cheap lip sync.
        </p>
      )}
      {provider === "sadtalker" && (
        <p className="text-xs text-muted-foreground">
          Connect a portrait image and audio to generate a talking head with natural motion.
        </p>
      )}
    </div>
  )
}

export function AudioIsolationConfig({ data, onUpdate, nodeRefs }: ConfigProps<AudioIsolationData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Label</Label>
        <Input
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Voice Extractor"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Removes background noise and extracts clean voice from any audio input. Connect an audio source (Upload Audio, Text to Speech, etc.) to the input.
      </p>
    </div>
  )
}

export function TextToDialogueConfig({ data, onUpdate, sources, nodeRefs, refMap, variableDisplayMode }: ConfigProps<TextToDialogueData>) {
  const dialogue = data.dialogue ?? [{ id: "1", text: "", voice: DEFAULT_DIALOGUE_VOICE }]
  const totalChars = dialogue.reduce((sum, l) => sum + l.text.length, 0)

  const scriptSource = sources.find(
    (s) => s.type === "generate-script" && s.sourceHandle === "dialogue"
  )
  const scriptDialogue = useMemo(() => {
    if (!scriptSource?.nodeData) return []
    const sd = scriptSource.nodeData as Record<string, unknown>
    const results = sd.generatedResults as Array<{ script: unknown }> | undefined
    const activeIndex = (sd.activeResultIndex as number | undefined) ?? 0
    const script = (results?.[activeIndex]?.script ?? sd.generatedScript) as GeneratedScript | undefined
    if (!script?.scenes) return []
    const lines: Array<{ speaker: string; text: string }> = []
    for (const scene of script.scenes) {
      if (scene.dialogue) {
        for (const d of scene.dialogue) {
          lines.push({ speaker: d.speaker, text: d.text })
        }
      }
    }
    return lines
  }, [scriptSource?.nodeData])

  const fillFromScript = useCallback(() => {
    if (!scriptDialogue.length) return
    const newDialogue: DialogueLine[] = scriptDialogue.map((d) => ({
      id: crypto.randomUUID(),
      text: d.text,
      voice: DEFAULT_DIALOGUE_VOICE,
      voiceLabel: d.speaker,
    }))
    onUpdate({ dialogue: newDialogue })
    toast.success(`Filled ${newDialogue.length} dialogue lines from script`)
  }, [scriptDialogue, onUpdate])

  function updateLine(index: number, updates: Partial<DialogueLine>) {
    const newDialogue = dialogue.map((line, i) =>
      i === index ? { ...line, ...updates } : line
    )
    onUpdate({ dialogue: newDialogue })
  }

  function addLine() {
    const newId = String(Date.now())
    onUpdate({ dialogue: [...dialogue, { id: newId, text: "", voice: DEFAULT_DIALOGUE_VOICE }] })
  }

  function removeLine(index: number) {
    if (dialogue.length <= 1) return
    onUpdate({ dialogue: dialogue.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Dialogue Lines</Label>
        <span className={`text-xs ${totalChars > 5000 ? "text-red-500" : "text-muted-foreground"}`}>
          {totalChars}/5000
        </span>
      </div>

      {scriptDialogue.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs gap-1.5"
          onClick={fillFromScript}
        >
          <Wand2 className="w-3.5 h-3.5" />
          Fill {scriptDialogue.length} Lines from Script
        </Button>
      )}

      <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
        {dialogue.map((line, i) => (
          <div key={line.id} className="flex flex-col gap-1 p-2 rounded-md border border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <VoiceBrowser
                compact
                showCustomVoices
                value={line.voice}
                valueLabel={line.voiceLabel}
                onSelect={(id, name) => updateLine(i, { voice: id, voiceLabel: name })}
              />
              {dialogue.length > 1 && (
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Remove dialogue line" onClick={() => removeLine(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            <TagTextarea
              rows={2}
              value={line.text}
              onChange={(v) => updateLine(i, { text: v })}
              placeholder={`Line ${i + 1}... (type [ or / for audio tags)`}
              className="text-sm"
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
            />
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addLine} className="w-full">
        <Plus className="h-3 w-3 mr-1" /> Add Line
      </Button>

      <div>
        <Label>Stability</Label>
        <Select
          value={String(data.stability ?? 0.5)}
          onValueChange={(v) => onUpdate({ stability: parseFloat(v) })}
        >
          <SelectTrigger aria-label="Stability"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Most Variable (0)</SelectItem>
            <SelectItem value="0.5">Balanced (0.5)</SelectItem>
            <SelectItem value="1">Most Stable (1.0)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Language</Label>
        <Select
          value={data.languageCode || "auto"}
          onValueChange={(v) => onUpdate({ languageCode: v === "auto" ? "" : v })}
        >
          <SelectTrigger aria-label="Language"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            {ALL_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        Multi-speaker dialogue using ElevenLabs voices. Each line is spoken by the selected voice. All lines are combined into a single audio output.
      </p>
    </div>
  )
}

export function VoiceChangerConfig({ data, onUpdate, nodeRefs }: ConfigProps<VoiceChangerData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Voice</Label>
        <VoiceBrowser
          value={data.voiceId || "Rachel"}
          valueLabel={data.voiceLabel}
          onSelect={(id, name, voiceType) => {
            if (voiceType === "custom" || voiceType === "library") {
              onUpdate({ voiceId: id, voiceType: voiceType, voiceLabel: name })
            } else {
              onUpdate({ voiceId: id, voiceType: "premade", voiceLabel: name })
            }
          }}
          showCustomVoices
        />
      </div>
      <div>
        <Label htmlFor="vc-stability">Stability ({data.stability ?? 0.5})</Label>
        <Input id="vc-stability" type="range" min={0} max={1} step={0.05} value={data.stability ?? 0.5} onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Variable</span><span>Stable</span></div>
      </div>
      <div>
        <Label htmlFor="vc-similarity">Similarity ({data.similarityBoost ?? 0.75})</Label>
        <Input id="vc-similarity" type="range" min={0} max={1} step={0.05} value={data.similarityBoost ?? 0.75} onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Low</span><span>High</span></div>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="vc-remove-bg"
          checked={data.removeBackgroundNoise ?? false}
          onCheckedChange={(v: boolean) => onUpdate({ removeBackgroundNoise: v })}
        />
        <Label htmlFor="vc-remove-bg">Remove Background Noise</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Changes the voice of audio input to the selected voice while preserving emotion and delivery.
      </p>
    </div>
  )
}

export function DubbingConfig({ data, onUpdate, nodeRefs }: ConfigProps<DubbingData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Target Language</Label>
        <Select
          value={data.targetLanguage || "es"}
          onValueChange={(v) => onUpdate({ targetLanguage: v })}
        >
          <SelectTrigger aria-label="Target Language"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ALL_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Source Language (optional)</Label>
        <Select
          value={data.sourceLanguage || "auto"}
          onValueChange={(v) => onUpdate({ sourceLanguage: v === "auto" ? undefined : v })}
        >
          <SelectTrigger aria-label="Source Language (optional)"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect</SelectItem>
            {ALL_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Number of Speakers (optional)</Label>
        <Input
          type="number"
          min={1}
          max={10}
          value={data.numSpeakers ?? ""}
          onChange={(e) => onUpdate({ numSpeakers: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder="Auto-detect"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Translates speech to the target language while preserving speaker identity. Connect an audio source to the input.
      </p>
    </div>
  )
}

export function VoiceRemixConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<VoiceRemixData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="voiceDescription" label="Voice Description" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.voiceDescription || ""}
          onChange={(v) => onUpdate({ voiceDescription: v })}
          placeholder="Describe the voice you want (e.g. 'A warm, deep male voice with a British accent')"
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="text" label="Preview Text" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.text || ""}
          onChange={(v) => onUpdate({ text: v })}
          placeholder="Text to preview the generated voice with..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <p className="text-xs text-muted-foreground">
        Generates a new voice from a natural language description and creates an audio preview with the specified text.
      </p>
    </div>
  )
}

// Map voice design model IDs to TTS provider IDs for TagTextarea audio tag support
const VOICE_DESIGN_MODEL_TO_TTS_PROVIDER: Record<string, string> = {
  "eleven_ttv_v3": "elevenlabs-v3",
  "eleven_multilingual_ttv_v2": "elevenlabs-multilingual",
}

export function VoiceDesignConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<VoiceDesignData>) {
  const ttsProvider = VOICE_DESIGN_MODEL_TO_TTS_PROVIDER[data.model || "eleven_ttv_v3"] || "elevenlabs-v3"
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="voiceDescription" label="Voice Description" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Textarea
          rows={3}
          value={data.voiceDescription || ""}
          onChange={(e) => onUpdate({ voiceDescription: e.target.value })}
          placeholder="Describe the voice you want (e.g. 'A warm, deep male voice with a British accent')"
        />
      </MappableField>
      <MappableField field="text" label="Preview Text (100-1000 chars)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.text || ""}
          onChange={(v) => { if (v.length <= 1000) onUpdate({ text: v }) }}
          placeholder="Text to preview the generated voice with (min 100 characters, type [ for audio tags)..."
          maxLength={1000}
          provider={ttsProvider}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
        {data.text && data.text.length < 100 && (
          <p className="text-[10px] text-amber-500 mt-0.5">{data.text.length}/100 characters (minimum 100 required)</p>
        )}
      </MappableField>
      <div>
        <Label>Model</Label>
        <Select value={data.model || "eleven_ttv_v3"} onValueChange={(v) => onUpdate({ model: v })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="eleven_multilingual_ttv_v2">ElevenLabs Multilingual v2</SelectItem>
            <SelectItem value="eleven_ttv_v3">ElevenLabs v3 (recommended)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Loudness: {data.loudness?.toFixed(1) ?? "0.0"}</Label>
        <Input
          type="range"
          min={-1}
          max={1}
          step={0.1}
          value={data.loudness ?? 0}
          onChange={(e) => onUpdate({ loudness: parseFloat(e.target.value) })}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Quiet</span>
          <span>Loud</span>
        </div>
      </div>
      <div>
        <Label>Guidance Scale: {data.guidanceScale ?? 5}</Label>
        <Input
          type="range"
          min={0}
          max={100}
          step={1}
          value={data.guidanceScale ?? 5}
          onChange={(e) => onUpdate({ guidanceScale: parseInt(e.target.value) })}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Creative</span>
          <span>Strict</span>
        </div>
      </div>
      <div>
        <Label>Seed (optional)</Label>
        <Input
          type="number"
          value={data.seed ?? ""}
          onChange={(e) => onUpdate({ seed: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder="Random"
        />
      </div>
      <div>
        <Label>Quality (optional)</Label>
        <Input
          type="number"
          value={data.quality ?? ""}
          onChange={(e) => onUpdate({ quality: e.target.value ? parseFloat(e.target.value) : undefined })}
          placeholder="Default — higher = better quality, less variety"
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="should-enhance"
          checked={data.shouldEnhance ?? false}
          onCheckedChange={(v) => onUpdate({ shouldEnhance: !!v })}
        />
        <Label htmlFor="should-enhance" className="cursor-pointer">Enhance audio quality</Label>
      </div>
      {data.generatedVoiceId && (
        <div className="rounded-md bg-muted/50 p-2">
          <Label className="text-[10px] text-muted-foreground">Generated Voice ID</Label>
          <p className="text-xs font-mono break-all select-all">{data.generatedVoiceId}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Designs a new voice using full controls (model, loudness, guidance, quality). Outputs audio preview and a reusable voice ID.
      </p>
    </div>
  )
}

export function ForcedAlignmentConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<ForcedAlignmentData>) {
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="transcript" label="Transcript" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={5}
          value={data.transcript || ""}
          onChange={(v) => onUpdate({ transcript: v })}
          placeholder="Enter the transcript to align with the audio..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <p className="text-xs text-muted-foreground">
        Aligns audio with a transcript to produce word-level timestamps. Connect an audio source to the input.
      </p>
    </div>
  )
}
