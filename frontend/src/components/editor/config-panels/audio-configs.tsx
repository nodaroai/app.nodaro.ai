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
  SunoVoiceData,
  SunoGenerateData,
  SunoCoverData,
  SunoExtendData,
  SunoLyricsData,
  SunoSeparateData,
  AudioSeparationData,
  AudioFxData,
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
  VoiceChangerProData,
  DubbingData,
  VoiceRemixData,
  VoiceDesignData,
  ForcedAlignmentData,
  GeneratedScript,
} from "@/types/nodes"
import { VOICE_CHANGER_MODELS } from "@nodaro/shared"
import { AUDIO_FX_PRESETS, AUDIO_FX_PRESET_LABELS, AUDIO_FX_REVERB_PRESETS } from "@nodaro/shared"
import type { AudioFxPreset } from "@nodaro/shared"
import { MappableField } from "./mappable-field"
import { PromptHelperButton } from "./prompt-helper-button"
import { SnippetMenuButton } from "./snippet-menu-button"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { PromptFieldFinalView, PromptFieldModeToggle } from "./prompt-field-final-view"
import { useFinalPromptSegments } from "./use-final-prompt-segments"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
import { ModelSelectOption } from "./model-select-option"
import { ModelDescriptionHint } from "./model-description-hint"
import { ProviderAudioTagWarning } from "./provider-audio-tag-warning"
import { ConnectedAudioSources } from "./connected-audio-sources"
import { FinalAudioPromptPreview } from "./final-audio-prompt-preview"
import { LIP_SYNC_MODELS, TTS_MODELS, SUNO_MODELS } from "./model-options"
import { REPLICATE_LIP_SYNC_PROVIDERS, FAL_LIP_SYNC_PROVIDERS, VIDEO_INPUT_LIP_SYNC_PROVIDERS, isPerSecondLipSyncProvider, getEffectiveSunoCustomMode, SUNO_ADD_TRACK_MODELS, SUNO_TEXT_MAX, getMaxSunoPromptChars, getMaxSunoStyleChars, getMaxTtsChars } from "@nodaro/shared"
import { PromptLengthCounter } from "./prompt-length-counter"
import { InjectedReferenceList } from "./injected-reference-list"
import { SeedanceReferenceTip } from "./seedance-reference-tip"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { removeMentionToken, makeRemoveWiredSource, appendSuppressedSlug } from "./injected-reference-helpers"
import { buildConnectedRefsFromSources } from "./connected-refs-builder"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowEdge } from "@/types/nodes"
import type { ConfigProps } from "./types"

// Hoisted to avoid creating a fresh empty array on every render — preserves
// referential equality so memoised children don't re-run.
const EMPTY_EDGES: ReadonlyArray<WorkflowEdge> = []
const SUNO_ADD_TRACK_MODEL_OPTIONS = SUNO_MODELS.filter(m => (SUNO_ADD_TRACK_MODELS as readonly string[]).includes(m.value))

export function TextToSpeechConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<TextToSpeechData> & { nodeId?: string }) {
  const textSource = data.textSource || "connected"
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "directText")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.directText,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
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
            {TTS_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ProviderAudioTagWarning provider={data.provider} fieldValues={[data.directText]} />
      <ModelDescriptionHint modelId={data.provider === "elevenlabs" ? "elevenlabs-v3" : (data.provider || "elevenlabs-v3")} />
      {textSource === "direct" && (
        <MappableField field="directText" label="Text" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        </span>}>
          {promptFieldMode.mode === "final" ? (
            <PromptFieldFinalView
              segments={finalPrompt.promptSegments}
              plainText={finalPrompt.promptText}
              placeholder="Final prompt preview — empty"
              minHeightRem={4 * 1.5}
            />
          ) : (
            <>
              <TagTextarea
                rows={4}
                value={data.directText || ""}
                onChange={(v) => onUpdate({ directText: v })}
                placeholder="Enter text to convert to speech... (use {} to inject input)"
                tagMode="audio"
                provider={data.provider}
                nodeRefs={nodeRefs}
                displayMode={variableDisplayMode}
                refMap={refMap}
              />
              <PromptLengthCounter value={data.directText || ""} max={getMaxTtsChars(data.provider === "elevenlabs" ? "elevenlabs-v3" : (data.provider || "elevenlabs-v3"))} modelLabel={data.provider === "elevenlabs" ? "elevenlabs-v3" : (data.provider || "elevenlabs-v3")} noun="text" />
              <p className="text-[10px] text-muted-foreground mt-1">Type [ or / for audio tags</p>
            </>
          )}
        </MappableField>
      )}
      <div>
        <Label>Voice</Label>
        <VoiceBrowser
          value={data.voiceId || "Rachel"}
          valueLabel={data.voiceDisplayName || data.voiceLabel}
          onSelect={(id, name, voiceType, providerMeta) => {
            if (voiceType === "custom" || voiceType === "library") {
              // Preview-fidelity guard: a library voice picked while the node
              // is on a v2 model the voice ISN'T verified for would render
              // audibly different from its preview — snap to the voice's
              // verified provider. Explicit picks WITHIN the verified set are
              // respected, and v3 (the default) renders any voice unmodified.
              const current = data.provider === "elevenlabs" ? "elevenlabs-turbo" : data.provider
              const verified = providerMeta?.verifiedProviders ?? []
              const snap =
                voiceType === "library" &&
                providerMeta?.recommendedProvider &&
                (current === "elevenlabs-turbo" || current === "elevenlabs-multilingual") &&
                !verified.includes(current)
                  ? { provider: providerMeta.recommendedProvider }
                  : {}
              onUpdate({ voiceId: id, voiceType: voiceType, voiceDisplayName: name, voiceLabel: name, ...snap })
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

export function TextToAudioConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<TextToAudioData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  const isSfx = data.provider === "elevenlabs-sfx"
  const maxPromptLen = isSfx ? 450 : 2000
  const minDuration = isSfx ? 0.5 : 1
  const maxDuration = isSfx ? 22 : 30

  return (
    <div className="flex flex-col gap-3">
      <ConnectedAudioSources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? EMPTY_EDGES} />
      <FinalAudioPromptPreview
        consumerNodeId={nodeId}
        consumerType="text-to-audio"
        userPrompt={data.prompt}
        nodes={nodes}
        edges={edges ?? EMPTY_EDGES}
      />
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => { if (v.length <= maxPromptLen) onUpdate({ prompt: v }) }} target="prompt" media="audio" />
        <PromptHelperButton nodeType="text-to-audio" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => {
                if (v.length <= maxPromptLen) onUpdate({ prompt: v })
              }}
              placeholder={isSfx ? "Describe the sound effect (max 450 chars)..." : "Describe the sound effect (e.g. dog barking, rain on window)..."}
              tagMode="none"
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            {isSfx && (
              <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/{maxPromptLen}</p>
            )}
          </>
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

// Voice Persona node has no traditional fields — all setup happens in the
// node's setup modal. The config panel just summarizes what was configured
// and links back to the modal via the node card.
export function SunoVoiceConfig({ data }: ConfigProps<SunoVoiceData>) {
  const ready = Boolean(data.voiceId) && data.status === "success"
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          Voice Persona
        </div>
        <div className="font-semibold">
          {data.voiceName?.trim() || (ready ? "Untitled voice" : "Not configured")}
        </div>
        {data.style && (
          <div className="text-[11px] text-muted-foreground mt-0.5">{data.style}</div>
        )}
        {data.description && (
          <div className="text-[11px] text-muted-foreground mt-0.5">{data.description}</div>
        )}
        {data.voiceId && (
          <div className="text-[10px] font-mono text-muted-foreground/80 mt-2 break-all">
            ID: {data.voiceId}
          </div>
        )}
        {!ready && (
          <div className="text-[11px] text-muted-foreground mt-2">
            Click <span className="font-medium">Configure Voice</span> on the
            node to walk through the 3-step setup. Costs 20 credits.
          </div>
        )}
      </div>
      {data.errorMessage && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-500">
          {data.errorMessage}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        Wire this node's output into the <span className="font-medium">in</span> handle
        of Suno Generate / Cover / Extend to apply the persona to the generated track.
      </div>
    </div>
  )
}

export function SunoGenerateConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoGenerateData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <ConnectedAudioSources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? EMPTY_EDGES} />
      <FinalAudioPromptPreview
        consumerNodeId={nodeId}
        consumerType="suno-generate"
        userPrompt={data.prompt}
        userStyle={data.style}
        customMode={getEffectiveSunoCustomMode(data)}
        nodes={nodes}
        edges={edges ?? EMPTY_EDGES}
      />
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <PromptHelperButton nodeType="suno-generate" currentPrompt={data.prompt || ""} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }}
              placeholder="Describe the song... (type [ or / for tags)"
              maxLength={SUNO_TEXT_MAX}
              tagMode="suno"
              customTags={SUNO_SUGGESTION_ITEMS}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt} max={getMaxSunoPromptChars(data.model, getEffectiveSunoCustomMode(data))} modelLabel={data.model ?? "V5_5"} noun="prompt / lyrics" />
          </>
        )}
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoGenerateData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={4}
            value={data.lyrics ?? ""}
            onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ lyrics: v }) }}
            placeholder="Write custom lyrics... (type [ or / for metatags)"
            maxLength={SUNO_TEXT_MAX}
            tagMode="suno"
            customTags={SUNO_LYRICS_SUGGESTION_ITEMS}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
          <PromptLengthCounter value={data.lyrics ?? ""} max={getMaxSunoPromptChars(data.model, getEffectiveSunoCustomMode(data))} modelLabel={data.model ?? "V5_5"} noun="lyrics" />
        </>
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={2}
            value={data.style ?? ""}
            onChange={(v) => { if (v.length <= 1000) onUpdate({ style: v }) }}
            placeholder="e.g. pop, rock, jazz, lo-fi... (type [ or / for suggestions)"
            maxLength={1000}
            tagMode="suno"
            customTags={SUNO_STYLE_SUGGESTION_ITEMS}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
          <PromptLengthCounter value={data.style ?? ""} max={getMaxSunoStyleChars(data.model)} modelLabel={data.model ?? "V5_5"} noun="style" />
        </>
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativeStyle ?? ""}
          onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }}
          placeholder="Styles to avoid... (type [ or / for suggestions)"
          maxLength={500}
          tagMode="suno"
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

export function SunoCoverConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoCoverData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }}
              placeholder="Describe the cover style... (type [ or / for tags)"
              maxLength={SUNO_TEXT_MAX}
              tagMode="suno"
              customTags={SUNO_SUGGESTION_ITEMS}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt} max={getMaxSunoPromptChars(data.model, getEffectiveSunoCustomMode(data))} modelLabel={data.model ?? "V5_5"} noun="prompt / lyrics" />
          </>
        )}
      </MappableField>
      <MappableField field="uploadUrl" label="Source Audio URL" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.uploadUrl ?? ""} onChange={(e) => onUpdate({ uploadUrl: e.target.value })} placeholder="URL of the audio to cover (or connect an audio node)" />
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoCoverData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Cover title" />
      </MappableField>
      <MappableField field="lyrics" label="Lyrics (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={4}
            value={data.lyrics ?? ""}
            onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ lyrics: v }) }}
            placeholder="Write custom lyrics for the cover... (type [ or / for metatags)"
            maxLength={SUNO_TEXT_MAX}
            tagMode="suno"
            customTags={SUNO_LYRICS_SUGGESTION_ITEMS}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
          <PromptLengthCounter value={data.lyrics ?? ""} max={getMaxSunoPromptChars(data.model, getEffectiveSunoCustomMode(data))} modelLabel={data.model ?? "V5_5"} noun="lyrics" />
        </>
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={2}
            value={data.style ?? ""}
            onChange={(v) => { if (v.length <= 1000) onUpdate({ style: v }) }}
            placeholder="e.g. pop, rock, jazz, lo-fi... (type [ or / for suggestions)"
            maxLength={1000}
            tagMode="suno"
            customTags={SUNO_STYLE_SUGGESTION_ITEMS}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
          <PromptLengthCounter value={data.style ?? ""} max={getMaxSunoStyleChars(data.model)} modelLabel={data.model ?? "V5_5"} noun="style" />
        </>
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativeStyle ?? ""}
          onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }}
          placeholder="Styles to avoid... (type [ or / for suggestions)"
          maxLength={500}
          tagMode="suno"
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

export function SunoExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoExtendData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="audioId" label="Audio ID (from Suno node)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.audioId ?? ""} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder="Suno track ID (auto-filled from connected node)" />
      </MappableField>
      <MappableField field="continueAt" label="Continue From (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} value={data.continueAt ?? 0} onChange={(e) => onUpdate({ continueAt: Number(e.target.value) })} placeholder="0" />
      </MappableField>
      <MappableField field="prompt" label="Extension Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt ?? ""}
              onChange={(v) => { if (v.length <= 5000) onUpdate({ prompt: v }) }}
              placeholder="Describe how the music should continue... (type [ or / for tags)"
              maxLength={5000}
              tagMode="suno"
              customTags={SUNO_SUGGESTION_ITEMS}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <PromptLengthCounter value={data.prompt ?? ""} max={getMaxSunoPromptChars(data.model, getEffectiveSunoCustomMode(data))} modelLabel={data.model ?? "V5_5"} noun="prompt / lyrics" />
          </>
        )}
      </MappableField>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoExtendData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={80} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Extended track title" />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={2}
            value={data.style ?? ""}
            onChange={(v) => { if (v.length <= 1000) onUpdate({ style: v }) }}
            placeholder="e.g. pop, rock, jazz... (type [ or / for suggestions)"
            maxLength={1000}
            tagMode="suno"
            customTags={SUNO_STYLE_SUGGESTION_ITEMS}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
          <PromptLengthCounter value={data.style ?? ""} max={getMaxSunoStyleChars(data.model)} modelLabel={data.model ?? "V5_5"} noun="style" />
        </>
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-extend-customParams" checked={data.defaultParamFlag ?? true} onChange={(e) => onUpdate({ defaultParamFlag: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-extend-customParams" className="text-xs font-medium text-muted-foreground">Use default parameters (uncheck to customize)</label>
      </div>
    </div>
  )
}

export function SunoLyricsConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoLyricsData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => { if (v.length <= 1000) onUpdate({ prompt: v }) }}
              placeholder="Describe the lyrics you want... (type [ or / for genre/mood suggestions)"
              maxLength={1000}
              tagMode="suno"
              customTags={SUNO_STYLE_SUGGESTION_ITEMS}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
            <p className="text-xs text-muted-foreground mt-1">{data.prompt.length}/1000</p>
          </>
        )}
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
          <WaveformAudioPlayer url={data.vocalUrl} variant="compact" className="w-full" />
        </div>
      )}
      {data.instrumentalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Instrumental</label>
          <WaveformAudioPlayer url={data.instrumentalUrl} variant="compact" className="w-full" />
        </div>
      )}
      {data.stems && Object.keys(data.stems).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Stems</label>
          {Object.entries(data.stems).map(([name, url]) => (
            <div key={name} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground capitalize">{name.replace(/_/g, " ")}</span>
              <WaveformAudioPlayer url={url} variant="compact" className="w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function AudioFxConfig({ data, onUpdate }: { readonly data: AudioFxData; readonly onUpdate: (updates: Partial<AudioFxData>) => void }) {
  const isCustom = data.preset === "custom"
  const isReverb = AUDIO_FX_REVERB_PRESETS.has(data.preset)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Effect</label>
        <Select value={data.preset} onValueChange={(v) => onUpdate({ preset: v as AudioFxData["preset"] })}>
          <SelectTrigger aria-label="Effect"><SelectValue /></SelectTrigger>
          <SelectContent>
            {AUDIO_FX_PRESETS.map((p) => (<SelectItem key={p} value={p}>{AUDIO_FX_PRESET_LABELS[p]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      {isReverb && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Wet / Dry mix: {data.mix ?? "auto"}</label>
          <Slider min={0} max={100} step={1} value={[data.mix ?? 30]} onValueChange={(vals) => onUpdate({ mix: vals[0] })} />
          <p className="text-[10px] text-muted-foreground">Higher = more room, less direct voice.</p>
        </div>
      )}
      {(isCustom || data.preset === "echo") && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Delay (ms): {data.delayMs ?? 250}</label>
            <Slider min={20} max={2000} step={10} value={[data.delayMs ?? 250]} onValueChange={(vals) => onUpdate({ delayMs: vals[0] })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Decay: {data.decay ?? 0.4}</label>
            <Slider min={0.1} max={0.9} step={0.05} value={[data.decay ?? 0.4]} onValueChange={(vals) => onUpdate({ decay: vals[0] })} />
          </div>
        </>
      )}
      {isCustom && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">EQ Low (dB): {data.eqLow ?? 0}</label>
            <Slider min={-20} max={20} step={1} value={[data.eqLow ?? 0]} onValueChange={(vals) => onUpdate({ eqLow: vals[0] })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">EQ High (dB): {data.eqHigh ?? 0}</label>
            <Slider min={-20} max={20} step={1} value={[data.eqHigh ?? 0]} onValueChange={(vals) => onUpdate({ eqHigh: vals[0] })} />
          </div>
        </>
      )}
    </div>
  )
}

export function AudioSeparationConfig({ data, onUpdate }: { readonly data: AudioSeparationData; readonly onUpdate: (updates: Partial<AudioSeparationData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Mode</label>
        <Select value={data.mode} onValueChange={(v) => onUpdate({ mode: v as AudioSeparationData["mode"] })}>
          <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="vocal_instrumental">Vocal / Instrumental</SelectItem>
            <SelectItem value="stems">Full stems</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Quality</label>
        <Select value={data.quality} onValueChange={(v) => onUpdate({ quality: v as AudioSeparationData["quality"] })}>
          <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto</SelectItem>
            <SelectItem value="fast">Fast</SelectItem>
            <SelectItem value="best">Best (slower)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {data.vocalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Vocals</label>
          <WaveformAudioPlayer url={data.vocalUrl} variant="compact" className="w-full" />
        </div>
      )}
      {data.instrumentalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Instrumental</label>
          <WaveformAudioPlayer url={data.instrumentalUrl} variant="compact" className="w-full" />
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
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoMashupData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <div className="flex items-center gap-2">
        <Checkbox id="mashup-custom-mode" checked={data.customMode} onCheckedChange={(v) => onUpdate({ customMode: !!v })} />
        <Label htmlFor="mashup-custom-mode" className="text-xs">Custom Mode</Label>
      </div>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
      <MappableField field="style" label="Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.style ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }} placeholder="e.g. pop, rock, jazz..." maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.negativeStyle ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }} placeholder="Styles to avoid..." maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
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

export function SunoReplaceSectionConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoReplaceSectionData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Replace a section of an existing track. Connect an audio source.</p>
      <MappableField field="infillStartS" label="Start Time (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} step={1} value={data.infillStartS ?? ""} onChange={(e) => onUpdate({ infillStartS: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="0" />
      </MappableField>
      <MappableField field="infillEndS" label="End Time (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} step={1} value={data.infillEndS ?? ""} onChange={(e) => onUpdate({ infillEndS: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="30" />
      </MappableField>
      <MappableField field="prompt" label="Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea rows={3} value={data.prompt ?? ""} onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }} placeholder="Describe the replacement..." maxLength={SUNO_TEXT_MAX} tagMode="suno" customTags={SUNO_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} snippets={promptSnippets} />
        )}
      </MappableField>
      <MappableField field="tags" label="Tags (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.tags ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ tags: v }) }} placeholder="Style tags..." maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="title" label="Title (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder="Song title" />
      </MappableField>
    </div>
  )
}

export function SunoStyleBoostConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeId }: ConfigProps<SunoStyleBoostData> & { nodeId?: string }) {
  const styleBoostSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "content")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.content,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: styleBoostSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Enhance and improve style text using Suno AI.</p>
      <MappableField field="content" label="Content" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={styleBoostSnippets} value={data.content || ""} onInsert={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ content: v }) }} target="prompt" media="audio" />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={4 * 1.5}
          />
        ) : (
          <>
            <Textarea rows={4} value={data.content ?? ""} onChange={(e) => { if (e.target.value.length <= SUNO_TEXT_MAX) onUpdate({ content: e.target.value }) }} placeholder="Enter style text to enhance..." maxLength={SUNO_TEXT_MAX} />
            <p className="text-xs text-muted-foreground mt-1">{(data.content ?? "").length}/{SUNO_TEXT_MAX}</p>
          </>
        )}
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
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoAddInstrumentalData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_ADD_TRACK_MODEL_OPTIONS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
    </div>
  )
}

export function SunoAddVocalsConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SunoAddVocalsData>) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Add vocals to an instrumental track. Connect an audio source.</p>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoAddVocalsData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_ADD_TRACK_MODEL_OPTIONS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
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

export function SunoUploadExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoUploadExtendData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">Extend a track from uploaded audio. Connect an audio source.</p>
      <MappableField field="model" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoUploadExtendData["model"] })}>
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <MappableField field="prompt" label="Prompt (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea rows={3} value={data.prompt ?? ""} onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }} placeholder="Describe the extension..." maxLength={SUNO_TEXT_MAX} tagMode="suno" customTags={SUNO_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} snippets={promptSnippets} />
        )}
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
        <TagTextarea rows={2} value={data.style ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }} placeholder="e.g. pop, rock, jazz..." maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="negativeStyle" label="Negative Style (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.negativeStyle ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }} placeholder="Styles to avoid..." maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
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

// Per-provider resolution option set for the Lip Sync node. OmniHuman 1.5 is
// 720/1080 only (no 480p), default 1080; Seedance 2 (-fast) adds 1080 to
// 480/720; other KIE avatars are 480/720. Drives both the dropdown and the
// fail-safe useEffect so a stale value snaps to a valid one on provider switch.
function lipSyncResolutionOptions(
  provider: string,
): { values: Array<"480p" | "720p" | "1080p">; def: "480p" | "720p" | "1080p" } {
  if (provider === "omnihuman-1-5") return { values: ["720p", "1080p"], def: "1080p" }
  if (provider === "seedance-2" || provider === "seedance-2-fast")
    return { values: ["480p", "720p", "1080p"], def: "720p" }
  return { values: ["480p", "720p"], def: "720p" }
}

export function LipSyncConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, nodeId }: ConfigProps<LipSyncData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  const provider = data.provider || "kling-avatar"
  // KIE providers (Kling Avatar / InfiniTalk / Seedance) expose the resolution
  // lever. Replicate AND fal providers do NOT — both must be excluded here so a
  // fal provider (sync-lipsync-v3) doesn't wrongly render the KIE resolution
  // dropdown and write a stale `data.resolution` the route's Zod enum rejects.
  const isKie =
    !REPLICATE_LIP_SYNC_PROVIDERS.has(provider as never) &&
    !FAL_LIP_SYNC_PROVIDERS.has(provider as never)
  // Per-provider resolution shape (values + default). See lipSyncResolutionOptions.
  const resOpts = lipSyncResolutionOptions(provider)

  // Volcengine is KIE-hosted but VIDEO-input dubbing — no resolution lever and
  // no motion prompt. The image-input KIE talking-head set (kling-avatar*,
  // infinitalk, seedance*, omnihuman-1-5) is `isKie` minus the video-input
  // providers (data-driven via the shared set) — gates the resolution dropdown,
  // motion prompt, and KIE help text so they stay hidden for Volcengine and any
  // future KIE video-input dubbing model.
  const imageInputKie =
    isKie && !VIDEO_INPUT_LIP_SYNC_PROVIDERS.has(provider as never)
  const isVolcengine = provider === "volcengine-lipsync"

  // Fail-safe: only image-input KIE providers expose the resolution lever. When
  // the user switches to a Replicate/fal provider, to Volcengine (video-input,
  // no resolution), or the cached resolution isn't valid for the current
  // provider, clear/snap so the lip-sync route's Zod enum never sees a stale value.
  useEffect(() => {
    if (!imageInputKie) {
      if (data.resolution !== undefined) onUpdate({ resolution: undefined })
      return
    }
    if (data.resolution && !resOpts.values.includes(data.resolution)) {
      onUpdate({ resolution: resOpts.def as LipSyncData["resolution"] })
    }
  }, [provider]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label="Provider" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={provider} onValueChange={(v) => onUpdate({ provider: v as LipSyncData["provider"] })}>
          <SelectTrigger aria-label="Provider"><SelectValue /></SelectTrigger>
          <SelectContent>
            {LIP_SYNC_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} perSecond={isPerSecondLipSyncProvider(m.value)} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={provider} />

      {/* Resolution — image-input KIE providers only (per-provider option set) */}
      {imageInputKie && (
        <MappableField field="resolution" label="Resolution" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select value={data.resolution || resOpts.def} onValueChange={(v) => onUpdate({ resolution: v as LipSyncData["resolution"] })}>
            <SelectTrigger aria-label="Resolution"><SelectValue /></SelectTrigger>
            <SelectContent>
              {resOpts.values.map((r) => (
                <SelectItem key={r} value={r}>{r === resOpts.def ? `${r} (default)` : r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MappableField>
      )}

      {/* Motion Prompt — image-input KIE providers only (Kling Avatar / InfiniTalk / Seedance) */}
      {imageInputKie && (
        <MappableField field="prompt" label="Motion Prompt (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
          <span className="inline-flex items-center gap-0.5">
            <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
            <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="audio" />
          </span>
        }>
          {promptFieldMode.mode === "final" ? (
            <PromptFieldFinalView
              segments={finalPrompt.promptSegments}
              plainText={finalPrompt.promptText}
              placeholder="Final prompt preview — empty"
              minHeightRem={2 * 1.5}
            />
          ) : (
            <Textarea rows={2} value={data.prompt ?? ""} onChange={(e) => onUpdate({ prompt: e.target.value })} placeholder="Optional: describe head/expression motions..." />
          )}
        </MappableField>
      )}

      {/* Unified injected-references list — surfaces wired character canonicals
          + @-mention variants (resolved from the motion prompt) so the user can
          see and reorder the actual references the API will receive. Skipped
          entirely when no refs are wired (empty-state suppression). */}
      <InjectedReferenceList
        connectedReferences={buildConnectedRefsFromSources(sources)}
        prompt={data.prompt || ""}
        referenceOrder={data.referenceOrder}
        suppressedCanonicalCharacterIds={data.suppressedCanonicalCharacterIds}
        onUpdateReferenceOrder={(order) => onUpdate({ referenceOrder: order })}
        onRemoveWiredSource={
          nodeId
            ? makeRemoveWiredSource(
                nodeId,
                edges ?? [],
                useWorkflowStore.getState().deleteEdge,
              )
            : undefined
        }
        onRemoveMention={(token) => onUpdate({ prompt: removeMentionToken(data.prompt || "", token) })}
        onSuppressCanonical={(slug) =>
          onUpdate({ suppressedCanonicalCharacterIds: appendSuppressedSlug(data.suppressedCanonicalCharacterIds, slug) })
        }
        label="Injected references"
      />
      <SeedanceReferenceTip provider={provider} />

      {/* OmniHuman 1.5 — fast mode + seed (prompt + resolution are above) */}
      {provider === "omnihuman-1-5" && (
        <>
          <div className="flex items-center justify-between">
            <Label>Fast Mode</Label>
            <Switch checked={data.fastMode ?? false} onCheckedChange={(v) => onUpdate({ fastMode: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Trade some quality for faster generation</p>
          <div>
            <Label>Seed</Label>
            <Input
              type="number"
              value={data.seed ?? -1}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                onUpdate({ seed: Number.isNaN(n) ? -1 : n })
              }}
              placeholder="-1 = random"
            />
            <p className="text-xs text-muted-foreground mt-1">Same seed + inputs → near-identical result. -1 = random.</p>
          </div>
        </>
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

      {/* HeyGen Lipsync Precision params */}
      {provider === "heygen-lipsync-precision" && (
        <>
          <div className="flex items-center justify-between">
            <Label>Dynamic Duration</Label>
            <Switch checked={data.enableDynamicDuration !== false} onCheckedChange={(v) => onUpdate({ enableDynamicDuration: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Adjust the output length to match the new audio (recommended)</p>
          <div className="flex items-center justify-between">
            <Label>Remove Music Track</Label>
            <Switch checked={data.disableMusicTrack ?? false} onCheckedChange={(v) => onUpdate({ disableMusicTrack: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Strip background music from the source video</p>
          <div className="flex items-center justify-between">
            <Label>Speech Enhancement</Label>
            <Switch checked={data.enableSpeechEnhancement ?? false} onCheckedChange={(v) => onUpdate({ enableSpeechEnhancement: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Improve speech clarity in the output</p>
        </>
      )}

      {/* Sync Mode — sync.so family (Lipsync 2 Pro on Replicate + Sync Lipsync
          v3 on fal). Both accept the same 5-value enum and bind data.syncMode. */}
      {(provider === "lipsync-2-pro" || provider === "sync-lipsync-v3") && (
        <div>
          <Label>Sync Mode</Label>
          {/* Default to each model's native API default: cut_off for fal's
              sync v3, loop for sync.so Lipsync 2 Pro (Replicate). */}
          <Select value={data.syncMode ?? (provider === "sync-lipsync-v3" ? "cut_off" : "loop")} onValueChange={(v) => onUpdate({ syncMode: v as LipSyncData["syncMode"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="loop">Loop</SelectItem>
              <SelectItem value="bounce">Bounce</SelectItem>
              <SelectItem value="cut_off">Cut off</SelectItem>
              <SelectItem value="silence">Silence</SelectItem>
              <SelectItem value="remap">Remap</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Behavior when audio and video durations differ</p>
        </div>
      )}

      {/* Lipsync 2 Pro-only params (fal's Sync Lipsync v3 only takes sync_mode) */}
      {provider === "lipsync-2-pro" && (
        <>
          <div>
            <Label>Temperature ({(data.temperature ?? 0.5).toFixed(1)})</Label>
            <Slider min={0} max={1} step={0.1} value={[data.temperature ?? 0.5]} onValueChange={(vals) => onUpdate({ temperature: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">How expressive the lip sync can be (0–1)</p>
          </div>
          <div className="flex items-center justify-between">
            <Label>Active Speaker Detection</Label>
            <Switch checked={data.activeSpeaker ?? false} onCheckedChange={(v) => onUpdate({ activeSpeaker: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Lip-sync whoever is speaking in the clip</p>
        </>
      )}

      {/* Video-Retalking has no configurable params */}
      {provider === "video-retalking" && (
        <p className="text-xs text-muted-foreground">
          Connect a talking-head video and audio track. Includes built-in face enhancement.
        </p>
      )}

      {/* Volcengine video-to-video dubbing — mode-conditional controls. Lite =
          single-speaker frontal (loop levers); Basic = complex scenes + the
          multi-speaker scene-detection differentiator. */}
      {isVolcengine && (
        <>
          <div>
            <Label>Mode</Label>
            <Select value={data.mode ?? "lite"} onValueChange={(v) => onUpdate({ mode: v as "lite" | "basic" })}>
              <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lite">Lite — single speaker, frontal (faster)</SelectItem>
                <SelectItem value="basic">Basic — complex scenes, multi-speaker</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>Separate vocals (denoise)</Label>
            <Switch checked={data.separateVocal ?? false} onCheckedChange={(v) => onUpdate({ separateVocal: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Strip background noise from the driving audio</p>

          {/* Basic mode only — multi-speaker scene detection + speaker ID */}
          {(data.mode ?? "lite") === "basic" && (
            <>
              <div className="flex items-center justify-between">
                <Label>Scene detection + speaker ID</Label>
                <Switch checked={data.openScenedet ?? false} onCheckedChange={(v) => onUpdate({ openScenedet: v })} />
              </div>
              <p className="text-xs text-muted-foreground -mt-1">Segment scene cuts and identify who is speaking (multi-speaker clips)</p>
            </>
          )}

          {/* Lite mode only — loop the video when the audio runs longer */}
          {(data.mode ?? "lite") === "lite" && (
            <>
              <div className="flex items-center justify-between">
                <Label>Loop video if audio is longer</Label>
                <Switch checked={data.alignAudio !== false} onCheckedChange={(v) => onUpdate({ alignAudio: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Reverse loop (ping-pong)</Label>
                <Switch checked={data.alignAudioReverse ?? false} onCheckedChange={(v) => onUpdate({ alignAudioReverse: v })} disabled={data.alignAudio === false} />
              </div>
              <p className="text-xs text-muted-foreground -mt-1">Reverse loop requires looping to be on</p>
            </>
          )}

          <div>
            <Label>Template start time (seconds)</Label>
            <Input type="number" min={0} value={data.templStartSeconds ?? 0} onChange={(e) => onUpdate({ templStartSeconds: parseFloat(e.target.value) || 0 })} />
            <p className="text-xs text-muted-foreground mt-1">Where in the source video to start driving the lips (advanced)</p>
          </div>
        </>
      )}

      {/* Help text per provider category */}
      {imageInputKie && (
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
      {provider === "heygen-lipsync-precision" && (
        <p className="text-xs text-muted-foreground">
          Connect a video and an audio track to replace/dub the speech with high-accuracy avatar-inference lip sync. Billed per second of output.
        </p>
      )}
      {provider === "lipsync-2-pro" && (
        <p className="text-xs text-muted-foreground">
          Connect a video (.mp4) and an audio track (.wav) for studio-grade lip sync. Billed per second of output.
        </p>
      )}
      {provider === "sync-lipsync-v3" && (
        <p className="text-xs text-muted-foreground">
          Connect a video and an audio track to dub the footage with sync.so v3 (fal.ai). Billed per second of output.
        </p>
      )}
      {isVolcengine && (
        <p className="text-xs text-muted-foreground">
          Connect a video and an audio track to dub the footage (Volcengine). Output length follows the audio. Billed per second; ~2 credits/second.
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
              tagMode="audio"
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
        <Label htmlFor="vc-model">Model</Label>
        <Select
          value={data.model || "eleven_english_sts_v2"}
          onValueChange={(v) => onUpdate({ model: v as VoiceChangerData["model"] })}
        >
          <SelectTrigger id="vc-model" aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VOICE_CHANGER_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {VOICE_CHANGER_MODELS.find((m) => m.value === (data.model || "eleven_english_sts_v2"))?.desc}
        </p>
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
      <div>
        <Label htmlFor="vc-style">Style Exaggeration ({data.style ?? 0})</Label>
        <Input id="vc-style" type="range" min={0} max={1} step={0.05} value={data.style ?? 0} onChange={(e) => onUpdate({ style: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>None</span><span>Exaggerated</span></div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Amplifies the source's delivery. Keep at 0 unless you want more drama — higher values add latency and can reduce stability.
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="vc-speaker-boost">Speaker Boost</Label>
          <Switch id="vc-speaker-boost" checked={data.useSpeakerBoost ?? true} onCheckedChange={(c: boolean) => onUpdate({ useSpeakerBoost: c })} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Amplifies similarity to the target voice (uses more compute, slight latency). On by default.
        </p>
      </div>
      <div>
        <Label htmlFor="vc-seed">Seed</Label>
        <Input
          id="vc-seed"
          type="number"
          min={0}
          max={4294967295}
          placeholder="Random"
          value={data.seed ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === "") { onUpdate({ seed: undefined }); return }
            const n = parseInt(raw, 10)
            if (Number.isFinite(n)) onUpdate({ seed: n })
          }}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Fix for reproducible output (same seed + same input + same settings). Leave blank for random.
        </p>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="vc-remove-bg"
            checked={data.removeBackgroundNoise ?? false}
            onCheckedChange={(v: boolean) => onUpdate({ removeBackgroundNoise: v })}
          />
          <Label htmlFor="vc-remove-bg">Remove Background Noise</Label>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 ml-6">
          Off: keep the music / SFX bed under the new voice. On: clean, voice-only output.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Replaces the voice with the selected one while preserving emotion, cadence, and timing.
        Wire <span className="font-medium">audio</span> in for audio out, or <span className="font-medium">video</span> in
        to revoice a whole talking clip (you get the video back plus the new audio track).
        If both are wired, video wins and the audio input is ignored.
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
      <div className="flex items-center gap-2">
        <Checkbox id="dubbing-native-voice" checked={data.disableVoiceCloning ?? false} onCheckedChange={(v) => onUpdate({ disableVoiceCloning: !!v })} />
        <Label htmlFor="dubbing-native-voice" className="text-xs">Native voice (don&apos;t clone the original speaker)</Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        By default the dub CLONES the original speaker — they speak the target language with their own voice and accent. Check this to use a similar native-sounding voice instead.
      </p>
      <div className="flex items-center gap-2">
        <Checkbox id="dubbing-drop-bg" checked={data.dropBackgroundAudio ?? false} onCheckedChange={(v) => onUpdate({ dropBackgroundAudio: !!v })} />
        <Label htmlFor="dubbing-drop-bg" className="text-xs">Drop background audio (speech-only sources)</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        Translates speech to the target language. Connect an audio source to the input.
      </p>
    </div>
  )
}

export function VoiceRemixConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<VoiceRemixData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "voiceDescription")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.voiceDescription,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <ConnectedAudioSources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? EMPTY_EDGES} />
      <FinalAudioPromptPreview
        consumerNodeId={nodeId}
        consumerType="voice-remix"
        userVoiceDescription={data.voiceDescription}
        nodes={nodes}
        edges={edges ?? EMPTY_EDGES}
      />
      <MappableField field="voiceDescription" label="Voice Description" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.voiceDescription || ""} onInsert={(v) => onUpdate({ voiceDescription: v })} target="prompt" media="audio" />
        </span>
      }>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea
            rows={3}
            value={data.voiceDescription || ""}
            onChange={(v) => onUpdate({ voiceDescription: v })}
            placeholder="Describe the voice you want (e.g. 'A warm, deep male voice with a British accent')"
            tagMode="none"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>
      <MappableField field="text" label="Preview Text" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.text || ""}
          onChange={(v) => onUpdate({ text: v })}
          placeholder="Text to preview the generated voice with..."
          tagMode="none"
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

export function VoiceDesignConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<VoiceDesignData> & { nodeId?: string }) {
  const ttsProvider = VOICE_DESIGN_MODEL_TO_TTS_PROVIDER[data.model || "eleven_ttv_v3"] || "elevenlabs-v3"
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "voiceDescription")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.voiceDescription,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <ConnectedAudioSources consumerNodeId={nodeId} nodes={nodes} edges={edges ?? EMPTY_EDGES} />
      <FinalAudioPromptPreview
        consumerNodeId={nodeId}
        consumerType="voice-design"
        userVoiceDescription={data.voiceDescription}
        nodes={nodes}
        edges={edges ?? EMPTY_EDGES}
      />
      <MappableField field="voiceDescription" label="Voice Description" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.voiceDescription || ""} onInsert={(v) => onUpdate({ voiceDescription: v })} target="prompt" media="audio" />
        </span>
      }>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={3 * 1.5}
          />
        ) : (
          <Textarea
            rows={3}
            value={data.voiceDescription || ""}
            onChange={(e) => onUpdate({ voiceDescription: e.target.value })}
            placeholder="Describe the voice you want (e.g. 'A warm, deep male voice with a British accent')"
          />
        )}
      </MappableField>
      <MappableField field="text" label="Preview Text (100-1000 chars)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.text || ""}
          onChange={(v) => { if (v.length <= 1000) onUpdate({ text: v }) }}
          placeholder="Text to preview the generated voice with (min 100 characters, type [ for audio tags)..."
          maxLength={1000}
          tagMode="audio"
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
      <ProviderAudioTagWarning provider={ttsProvider} fieldValues={[data.text]} />
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

export function ForcedAlignmentConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ForcedAlignmentData> & { nodeId?: string }) {
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "transcript")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.transcript,
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="transcript" label="Transcript" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder="Final prompt preview — empty"
            minHeightRem={5 * 1.5}
          />
        ) : (
          <TagTextarea
            rows={5}
            value={data.transcript || ""}
            onChange={(v) => onUpdate({ transcript: v })}
            placeholder="Enter the transcript to align with the audio..."
            tagMode="none"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>
      <p className="text-xs text-muted-foreground">
        Aligns audio with a transcript to produce word-level timestamps. Connect an audio source to the input.
      </p>
    </div>
  )
}

/** Sentinel for the "no Voice FX" Select option. Distinct from every
 *  AudioFxPreset id so picking it can't be mistaken for a real preset; chosen ⇒
 *  `voiceFx` is cleared to undefined (the default = no effect). */
const VOICE_FX_NONE = "__none__"

export function VoiceChangerProConfig({ data, onUpdate }: ConfigProps<VoiceChangerProData>) {
  const voices = data.orderedVoices ?? []
  const addVoice = (voiceId: string, voiceLabel: string, voiceType: "premade" | "custom" | "library") =>
    onUpdate({ orderedVoices: [...voices, { voiceId, voiceLabel, voiceType }] })
  const removeVoice = (i: number) =>
    onUpdate({ orderedVoices: voices.filter((_, idx) => idx !== i) })
  const move = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= voices.length) return
    const next = [...voices]
    ;[next[i], next[j]] = [next[j], next[i]]
    onUpdate({ orderedVoices: next })
  }
  // Immutably patch one voice entry's per-voice settings (copy array + entry).
  const updateVoice = (i: number, patch: Partial<VoiceChangerProData["orderedVoices"][number]>) => {
    const next = voices.map((v, idx) => (idx === i ? { ...v, ...patch } : v))
    onUpdate({ orderedVoices: next })
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Speakers are detected automatically. Voice 1 recasts the first speaker to talk, voice 2 the
        second, and so on. Speakers past the end of this list keep their original voice.
      </p>
      <div>
        <Label>Add a voice</Label>
        <VoiceBrowser
          value=""
          onSelect={(id, name, voiceType) => addVoice(id, name, voiceType ?? "premade")}
          showCustomVoices
        />
      </div>
      <div className="flex flex-col gap-1">
        {voices.map((v, i) => (
          <div key={`${v.voiceId}-${i}`} className="rounded border">
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="text-xs text-muted-foreground w-16">Speaker {i + 1}</span>
              <span className="text-sm flex-1 truncate">{v.voiceLabel}</span>
              <button aria-label="Move up" onClick={() => move(i, -1)} className="text-xs px-1">↑</button>
              <button aria-label="Move down" onClick={() => move(i, 1)} className="text-xs px-1">↓</button>
              <button aria-label="Remove voice" onClick={() => removeVoice(i)} className="text-xs px-1">✕</button>
            </div>
            <details className="border-t px-2 py-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">Voice settings</summary>
              <div className="flex flex-col gap-2 pt-2">
                <div>
                  <Label htmlFor={`stability-${i}`}>Stability ({v.stability ?? 0.5})</Label>
                  <Input id={`stability-${i}`} type="range" min={0} max={1} step={0.05} value={v.stability ?? 0.5} onChange={(e) => updateVoice(i, { stability: parseFloat(e.target.value) })} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Variable</span><span>Stable</span></div>
                </div>
                <div>
                  <Label htmlFor={`similarity-${i}`}>Similarity ({v.similarityBoost ?? 0.75})</Label>
                  <Input id={`similarity-${i}`} type="range" min={0} max={1} step={0.05} value={v.similarityBoost ?? 0.75} onChange={(e) => updateVoice(i, { similarityBoost: parseFloat(e.target.value) })} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>Low</span><span>High</span></div>
                </div>
                <div>
                  <Label htmlFor={`style-${i}`}>Style Exaggeration ({v.style ?? 0})</Label>
                  <Input id={`style-${i}`} type="range" min={0} max={1} step={0.05} value={v.style ?? 0} onChange={(e) => updateVoice(i, { style: parseFloat(e.target.value) })} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>None</span><span>Exaggerated</span></div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`speaker-boost-${i}`}>Speaker Boost</Label>
                    <Switch id={`speaker-boost-${i}`} checked={v.useSpeakerBoost ?? true} onCheckedChange={(c) => updateVoice(i, { useSpeakerBoost: c })} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Boosts the recast&apos;s fidelity to the target voice (slightly higher latency).
                  </p>
                </div>
                <div>
                  <Label htmlFor={`volume-mode-${i}`}>Volume</Label>
                  <Select
                    value={v.volumeMode ?? "match"}
                    onValueChange={(mode) => updateVoice(i, { volumeMode: mode as NonNullable<VoiceChangerProData["orderedVoices"][number]["volumeMode"]> })}
                  >
                    <SelectTrigger id={`volume-mode-${i}`} aria-label={`Volume mode for speaker ${i + 1}`} className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="match">Match source</SelectItem>
                      <SelectItem value="normalize">Normalize</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                  {(v.volumeMode ?? "match") === "manual" && (
                    <div className="mt-2">
                      <Label htmlFor={`volume-${i}`}>Volume ({v.volume ?? 100}%)</Label>
                      <Input id={`volume-${i}`} type="range" min={0} max={200} step={5} value={v.volume ?? 100} onChange={(e) => updateVoice(i, { volume: parseFloat(e.target.value) })} className="h-2" />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0%</span><span>200%</span></div>
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor={`seed-${i}`}>Seed</Label>
                  <Input
                    id={`seed-${i}`}
                    type="number"
                    min={0}
                    max={4294967295}
                    step={1}
                    inputMode="numeric"
                    placeholder="random"
                    value={v.seed ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      // Empty/blank clears the seed (random); only a parseable
                      // integer is stored — never coerce blank to 0.
                      if (raw === "") {
                        updateVoice(i, { seed: undefined })
                        return
                      }
                      const n = Number.parseInt(raw, 10)
                      if (Number.isFinite(n)) updateVoice(i, { seed: n })
                    }}
                    className="h-8"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Leave blank for a random seed.</p>
                </div>
              </div>
            </details>
          </div>
        ))}
      </div>
      <div>
        <Label>Model</Label>
        <Select
          value={data.model ?? "eleven_english_sts_v2"}
          onValueChange={(v) => onUpdate({ model: v as VoiceChangerProData["model"] })}
        >
          <SelectTrigger aria-label="Model"><SelectValue /></SelectTrigger>
          <SelectContent>
            {VOICE_CHANGER_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Separation quality</Label>
        <Select
          value={data.separationQuality ?? "fast"}
          onValueChange={(v) => onUpdate({ separationQuality: v as NonNullable<VoiceChangerProData["separationQuality"]> })}
        >
          <SelectTrigger aria-label="Separation quality"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">Fast — preserves more of the voice</SelectItem>
            <SelectItem value="best">Quality — finer separation</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <Label>Preserve background music</Label>
        <Switch checked={data.preserveBackground ?? true} onCheckedChange={(v) => onUpdate({ preserveBackground: v })} />
      </div>
      {data.preserveBackground !== false && (
        <div>
          <Label htmlFor="music-volume-mode">Music volume</Label>
          <Select
            value={data.musicVolumeMode ?? "match"}
            onValueChange={(mode) => onUpdate({ musicVolumeMode: mode as NonNullable<VoiceChangerProData["musicVolumeMode"]> })}
          >
            <SelectTrigger id="music-volume-mode" aria-label="Music volume mode" className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="match">Match source</SelectItem>
              <SelectItem value="normalize">Normalize</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
          {(data.musicVolumeMode ?? "match") === "manual" && (
            <div className="mt-2">
              <Label htmlFor="music-volume">Music level ({data.musicVolume ?? 100}%)</Label>
              <Input id="music-volume" type="range" min={0} max={200} step={5} value={data.musicVolume ?? 100} onChange={(e) => onUpdate({ musicVolume: parseFloat(e.target.value) })} className="h-2" />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0%</span><span>200%</span></div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Sets the preserved background music level relative to the recast voices.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded border p-2">
        <Label htmlFor="voice-fx-preset">Voice FX</Label>
        <Select
          value={data.voiceFx?.preset ?? VOICE_FX_NONE}
          onValueChange={(v) => {
            if (v === VOICE_FX_NONE) {
              onUpdate({ voiceFx: undefined })
              return
            }
            onUpdate({ voiceFx: { ...data.voiceFx, preset: v as AudioFxPreset } })
          }}
        >
          <SelectTrigger id="voice-fx-preset" aria-label="Voice FX"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={VOICE_FX_NONE}>None</SelectItem>
            {AUDIO_FX_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>{AUDIO_FX_PRESET_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data.voiceFx && AUDIO_FX_REVERB_PRESETS.has(data.voiceFx.preset) && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="voice-fx-mix">Wet / Dry mix: {data.voiceFx.wetDryMix ?? "auto"}</Label>
            <Slider id="voice-fx-mix" min={0} max={100} step={1} value={[data.voiceFx.wetDryMix ?? 30]} onValueChange={(vals) => onUpdate({ voiceFx: { ...data.voiceFx!, wetDryMix: vals[0] } })} />
          </div>
        )}
        {data.voiceFx && (data.voiceFx.preset === "echo" || data.voiceFx.preset === "custom") && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="voice-fx-delay">Delay (ms): {data.voiceFx.delayMs ?? 250}</Label>
              <Slider id="voice-fx-delay" min={20} max={2000} step={10} value={[data.voiceFx.delayMs ?? 250]} onValueChange={(vals) => onUpdate({ voiceFx: { ...data.voiceFx!, delayMs: vals[0] } })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="voice-fx-decay">Decay: {data.voiceFx.decay ?? 0.4}</Label>
              <Slider id="voice-fx-decay" min={0} max={1} step={0.05} value={[data.voiceFx.decay ?? 0.4]} onValueChange={(vals) => onUpdate({ voiceFx: { ...data.voiceFx!, decay: vals[0] } })} />
            </div>
          </>
        )}
        <p className="text-[11px] text-muted-foreground">
          Adds reverb/echo to the recast voices before the background music is mixed back.
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label>Remove background noise</Label>
          <Switch checked={data.removeBackgroundNoise ?? false} onCheckedChange={(v) => onUpdate({ removeBackgroundNoise: v })} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Under evaluation — vocals are isolated automatically; this may be unnecessary.
        </p>
      </div>
    </div>
  )
}
