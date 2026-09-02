"use client"

import { useMemo, useCallback, useEffect } from "react"
import { findUpstreamSunoIds, type UpstreamSunoIds } from "@/lib/suno-ids"
import { Plus, Trash2, Wand2 } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TagTextarea } from "./tag-textarea"
import { getLanguagesForModel, ALL_LANGUAGES, isV3Model } from "@/lib/audio-tags"
import { SUNO_SUGGESTION_ITEMS, SUNO_LYRICS_SUGGESTION_ITEMS, SUNO_STYLE_SUGGESTION_ITEMS } from "@/lib/suno-tags"
import { SUNO_SLIDER_META } from "@/lib/suno-sliders"
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
import { VOICE_CHANGER_MODELS, DEFAULT_VOICE_CHANGER_MODEL, AUDIO_FX_PRESETS, AUDIO_FX_PRESET_LABELS, AUDIO_FX_REVERB_PRESETS, REPLICATE_LIP_SYNC_PROVIDERS, FAL_LIP_SYNC_PROVIDERS, VIDEO_INPUT_LIP_SYNC_PROVIDERS, isPerSecondLipSyncProvider, SUNO_ADD_TRACK_MODELS, SUNO_TEXT_MAX, getMaxSunoPromptChars, getMaxSunoStyleChars, getMaxTtsChars, sunoCreditType } from "@nodaro/shared"
import type { AudioFxPreset } from "@nodaro/shared"
import { getEffectiveSunoCustomMode } from "@nodaro/prompts"
import { MappableField } from "./mappable-field"
import { SunoField, isSunoFieldWired } from "./suno-field"
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
import { PromptLengthCounter } from "./prompt-length-counter"
import { SUNO_FIELD_EDIT_META, SunoFieldEditor } from "./suno-field-editor"
import { SunoFieldAiButton, isSunoAiField } from "@/components/nodes/suno-field-ai-button"
import { InjectedReferenceList } from "./injected-reference-list"
import { SeedanceReferenceTip } from "./seedance-reference-tip"
import { WaveformAudioPlayer } from "@/components/audio-player"
import { removeMentionToken, makeRemoveWiredSource, appendSuppressedSlug } from "./injected-reference-helpers"
import { buildConnectedRefsFromSources } from "./connected-refs-builder"
import { useT } from "@/lib/i18n"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { WorkflowEdge } from "@/types/nodes"
import type { ConfigProps } from "./types"

// Hoisted to avoid creating a fresh empty array on every render — preserves
// referential equality so memoised children don't re-run.
const EMPTY_EDGES: ReadonlyArray<WorkflowEdge> = []
const SUNO_ADD_TRACK_MODEL_OPTIONS = SUNO_MODELS.filter(m => (SUNO_ADD_TRACK_MODELS as readonly string[]).includes(m.value))

export function TextToSpeechConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<TextToSpeechData> & { nodeId?: string }) {
  const t = useT()
  const textSource = data.textSource || "connected"
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "directText")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.directText,
    promptField: "directText",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("audiocfg.textSource")}</Label>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            onClick={() => onUpdate({ textSource: "connected" })}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${textSource === "connected" ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"}`}
          >
            {t("audiocfg.fromConnectedNode")}
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
      <MappableField field="provider" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="voice">
        <Select
          value={data.provider === "elevenlabs" ? "elevenlabs-v3" : (data.provider || "elevenlabs-v3")}
          onValueChange={(v) => onUpdate({ provider: v as TextToSpeechData["provider"] })}
        >
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
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
        <MappableField field="directText" label={t("field.text")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        </span>}>
          {promptFieldMode.mode === "final" ? (
            <PromptFieldFinalView
              segments={finalPrompt.promptSegments}
              plainText={finalPrompt.promptText}
              placeholder={t("audiocfg.phPromptPreviewEmpty")}
              minHeightRem={4 * 1.5}
            />
          ) : (
            <>
              <TagTextarea
                rows={4}
                value={data.directText || ""}
                onChange={(v) => onUpdate({ directText: v })}
                placeholder={t("audiocfg.phEnterTts")}
                tagMode="audio"
                provider={data.provider}
                nodeRefs={nodeRefs}
                displayMode={variableDisplayMode}
                refMap={refMap}
              />
              <PromptLengthCounter value={data.directText || ""} max={getMaxTtsChars(data.provider === "elevenlabs" ? "elevenlabs-v3" : (data.provider || "elevenlabs-v3"))} modelLabel={data.provider === "elevenlabs" ? "elevenlabs-v3" : (data.provider || "elevenlabs-v3")} noun="text" />
              <p className="text-[10px] text-muted-foreground mt-1">{t("audiocfg.hintTypeTags")}</p>
            </>
          )}
        </MappableField>
      )}
      <div>
        <Label>{t("field.voice")}</Label>
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
        <Label>{t("field.language")}</Label>
        <Select
          value={data.languageCode || "auto"}
          onValueChange={(v) => onUpdate({ languageCode: v === "auto" ? "" : v })}
        >
          <SelectTrigger aria-label={t("field.language")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAutoDetect")}</SelectItem>
            {getLanguagesForModel(data.provider).map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="stability">{t("field.stability")} ({data.stability ?? 0.5})</Label>
        <Input id="stability" type="range" min={0} max={1} step={0.05} value={data.stability ?? 0.5} onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.variable")}</span><span>{t("audiocfg.stable")}</span></div>
      </div>
      {!isV3Model(data.provider) && (
        <>
          <div>
            <Label htmlFor="similarityBoost">{t("audiocfg.similarity")} ({data.similarityBoost ?? 0.75})</Label>
            <Input id="similarityBoost" type="range" min={0} max={1} step={0.05} value={data.similarityBoost ?? 0.75} onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })} className="h-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.low")}</span><span>{t("audiocfg.high")}</span></div>
          </div>
          <div>
            <Label htmlFor="style">{t("audiocfg.styleExaggeration")} ({data.style ?? 0})</Label>
            <Input id="style" type="range" min={0} max={1} step={0.05} value={data.style ?? 0} onChange={(e) => onUpdate({ style: parseFloat(e.target.value) })} className="h-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.none")}</span><span>{t("audiocfg.exaggerated")}</span></div>
          </div>
          <div>
            <Label htmlFor="speed">{t("audiocfg.speed")} ({data.speed ?? 1})</Label>
            <Input id="speed" type="range" min={0.7} max={1.2} step={0.05} value={data.speed ?? 1} onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })} className="h-2" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0.7x</span><span>1.2x</span></div>
          </div>
        </>
      )}
    </div>
  )
}

export function TextToAudioConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<TextToAudioData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
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
      <MappableField field="prompt" label={t("node.prompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => { if (v.length <= maxPromptLen) onUpdate({ prompt: v }) }} target="prompt" media="audio" />
        <PromptHelperButton nodeType="text-to-audio" currentPrompt={data.prompt || ""} provider={data.provider} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
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
      <MappableField field="provider" label={t("field.provider")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select
          value={data.provider || "elevenlabs-sfx"}
          onValueChange={(v) => onUpdate({ provider: v as TextToAudioData["provider"] })}
        >
          <SelectTrigger aria-label={t("field.provider")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {/* Replicate disabled */}
            {/* <SelectItem value="tangoflux">TangoFlux (default)</SelectItem> */}
            <SelectItem value="elevenlabs-sfx">ElevenLabs SFX v2</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="duration" label={t("audiocfg.durationSeconds")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
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
            <label className="text-xs font-medium text-muted-foreground">{t("field.loop")}</label>
            <Select value={data.loop ? "true" : "false"} onValueChange={(v) => onUpdate({ loop: v === "true" })}>
              <SelectTrigger aria-label={t("field.loop")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="false">{t("audiocfg.off")}</SelectItem>
                <SelectItem value="true">{t("audiocfg.onSeamlessLoop")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.promptInfluence")}</label>
              <span className="text-xs text-muted-foreground">{(data.promptInfluence ?? 0.3).toFixed(1)}</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.1}
              value={data.promptInfluence ?? 0.3}
              onChange={(e) => onUpdate({ promptInfluence: parseFloat(e.target.value) })}
              className="w-full accent-[#ff0073]"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground"><span>{t("audiocfg.moreRandom")}</span><span>{t("audiocfg.moreFaithful")}</span></div>
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
  const t = useT()
  const ready = Boolean(data.voiceId) && data.status === "success"
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          {t("audiocfg.voicePersona")}
        </div>
        <div className="font-semibold">
          {data.voiceName?.trim() || (ready ? t("audiocfg.untitledVoice") : t("audiocfg.notConfigured"))}
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
            {t("audiocfg.svClickPre")}<span className="font-medium">{t("audiocfg.configureVoiceBtn")}</span>{t("audiocfg.svClickPost")}
          </div>
        )}
      </div>
      {data.errorMessage && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-[11px] text-red-500">
          {data.errorMessage}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {t("audiocfg.svWirePre")}<span className="font-medium">in</span>{t("audiocfg.svWirePost")}
      </div>
    </div>
  )
}

export function SunoGenerateConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoGenerateData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  // A Suno field is "wired" (read-only) per the SINGLE shared predicate: a live
  // edge into its handle (bare `prompt` for the prompt field, `field-<key>` for
  // the secondary fields) OR a legacy `fieldMappings[field]` entry. Using the same
  // `isSunoFieldWired` the AI button uses keeps read-only ⇔ button-hidden in lockstep.
  const sunoEdges = edges ?? EMPTY_EDGES
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
      <SunoField field="prompt" label={t("node.prompt")} wired={isSunoFieldWired("prompt", data, sunoEdges, nodeId)} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <PromptHelperButton nodeType="suno-generate" currentPrompt={data.prompt || ""} onAccept={(prompt, modelChange) => onUpdate({ prompt, ...(modelChange && { [modelChange.field]: modelChange.value }) })} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }}
              placeholder={t("audiocfg.phDescribeSong")}
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
      </SunoField>
      <MappableField field="model" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoGenerateData["model"] })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} creditId={sunoCreditType(m.value, "suno-generate")} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      {(data.model || "V5_5") === "V5_5" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.durationSecondsOptional")}</label>
          <Input
            type="number" min={10} max={360} step={1}
            value={data.duration ?? ""}
            onChange={(e) => onUpdate({ duration: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
            placeholder={t("audiocfg.phAuto")}
          />
          <p className="text-[10px] text-muted-foreground">
            10–360s, V5.5 only. Applies in custom mode (with style / title / lyrics set)
            {getEffectiveSunoCustomMode(data) ? "." : " — currently inactive, Suno picks the length."}
          </p>
        </div>
      )}
      {(["title", "lyrics", "style", "negativeStyle"] as const).map((f) => {
        const meta = SUNO_FIELD_EDIT_META[f]
        return (
          <SunoField key={f} field={meta.field} label={meta.label} wired={isSunoFieldWired(meta.field, data, sunoEdges, nodeId)} labelAction={isSunoAiField(meta.field) && nodeId ? <SunoFieldAiButton nodeId={nodeId} field={meta.field} /> : undefined}>
            <SunoFieldEditor meta={meta} data={data} onUpdate={onUpdate} nodeRefs={nodeRefs} refMap={refMap} variableDisplayMode={variableDisplayMode} />
          </SunoField>
        )
      })}
      <MappableField field="vocalGender" label={t("audiocfg.vocalGenderOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}>
          <SelectTrigger aria-label={t("audiocfg.vocalGenderOptional")}><SelectValue placeholder={t("audiocfg.phAuto")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAuto")}</SelectItem>
            <SelectItem value="male">{t("audiocfg.male")}</SelectItem>
            <SelectItem value="female">{t("audiocfg.female")}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      {SUNO_SLIDER_META.map((s) => (
        <div key={s.key} className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">{s.label}</label>
            <span className="text-xs text-muted-foreground">{(data[s.key] as number | undefined) ?? s.default}</span>
          </div>
          <input
            type="range" min={s.min} max={s.max} step={s.step}
            value={(data[s.key] as number | undefined) ?? s.default}
            onChange={(e) => onUpdate({ [s.key]: parseFloat(e.target.value) } as Partial<SunoGenerateData>)}
            className="w-full accent-[#ff0073]"
          />
          <p className="text-[10px] leading-tight text-muted-foreground/70">{s.description}</p>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-instrumental" checked={data.instrumental ?? false} onChange={(e) => onUpdate({ instrumental: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-instrumental" className="text-xs font-medium text-muted-foreground">{t("audiocfg.instrumentalNoVocals")}</label>
      </div>
      {((data.sunoTaskId as string | undefined) || (data.sunoTrackId as string | undefined)) && (
        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t("audiocfg.outputIds")}</label>
          {(data.sunoTaskId as string | undefined) && (
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] text-muted-foreground">{t("audiocfg.taskId")}</label>
              <div className="text-[11px] font-mono bg-muted/40 px-2 py-1 rounded break-all select-all">{data.sunoTaskId as string}</div>
            </div>
          )}
          {(data.sunoTrackId as string | undefined) && (
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px] text-muted-foreground">{t("audiocfg.trackId")}</label>
              <div className="text-[11px] font-mono bg-muted/40 px-2 py-1 rounded break-all select-all">{data.sunoTrackId as string}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SunoCoverConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoCoverData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label={t("node.prompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }}
              placeholder={t("audiocfg.phDescribeCover")}
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
      <MappableField field="uploadUrl" label={t("audiocfg.sourceAudioUrl")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.uploadUrl ?? ""} onChange={(e) => onUpdate({ uploadUrl: e.target.value })} placeholder={t("audiocfg.phCoverUrl")} />
      </MappableField>
      <MappableField field="model" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoCoverData["model"] })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} creditId={sunoCreditType(m.value, "suno-cover")} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <MappableField field="title" label={t("audiocfg.titleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder={t("audiocfg.phCoverTitle")} />
      </MappableField>
      <MappableField field="lyrics" label={t("audiocfg.lyricsOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={4}
            value={data.lyrics ?? ""}
            onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ lyrics: v }) }}
            placeholder={t("audiocfg.phWriteCoverLyrics")}
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
      <MappableField field="style" label={t("audiocfg.styleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={2}
            value={data.style ?? ""}
            onChange={(v) => { if (v.length <= 1000) onUpdate({ style: v }) }}
            placeholder={t("audiocfg.phGenreTags1")}
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
      <MappableField field="negativeStyle" label={t("audiocfg.negativeStyleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.negativeStyle ?? ""}
          onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }}
          placeholder={t("audiocfg.phStylesToAvoidTags")}
          maxLength={500}
          tagMode="suno"
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="vocalGender" label={t("audiocfg.vocalGenderOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? undefined : v })}>
          <SelectTrigger aria-label={t("audiocfg.vocalGenderOptional")}><SelectValue placeholder={t("audiocfg.phAuto")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAuto")}</SelectItem>
            <SelectItem value="male">{t("audiocfg.male")}</SelectItem>
            <SelectItem value="female">{t("audiocfg.female")}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="suno-cover-instrumental" checked={data.instrumental ?? false} onChange={(e) => onUpdate({ instrumental: e.target.checked })} className="accent-[#ff0073]" />
        <label htmlFor="suno-cover-instrumental" className="text-xs font-medium text-muted-foreground">{t("audiocfg.instrumentalNoVocals")}</label>
      </div>
    </div>
  )
}

export function SunoExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoExtendData> & { nodeId?: string }) {
  const t = useT()
  // The ids a connected Suno node will hand this node at run time — shown so a
  // wired node reads as configured, not empty (#819).
  const inherited = useMemo(() => findUpstreamSunoIds(nodeId, nodes, edges), [nodeId, nodes, edges])

  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="audioId" label={t("audiocfg.audioIdFromSuno")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.audioId ?? ""} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder={t("audiocfg.phSunoTrackId")} />
      </MappableField>
      <SunoInheritedHint what="track" manual={data.audioId} inherited={inherited?.trackId} sourceLabel={inherited?.sourceLabel} />
      <MappableField field="continueAt" label={t("audiocfg.continueFrom")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={1} value={data.continueAt ?? 0} onChange={(e) => onUpdate({ continueAt: Number(e.target.value) })} placeholder={t("audiocfg.continueAtPlaceholder")} />
      </MappableField>
      <MappableField field="prompt" label={t("audiocfg.extensionPrompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt ?? ""}
              onChange={(v) => { if (v.length <= 5000) onUpdate({ prompt: v }) }}
              placeholder={t("audiocfg.phDescribeContinue")}
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
      <MappableField field="model" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoExtendData["model"] })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} creditId={sunoCreditType(m.value, "suno-extend")} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <MappableField field="title" label={t("audiocfg.titleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={80} onChange={(e) => onUpdate({ title: e.target.value })} placeholder={t("audiocfg.phExtendedTitle")} />
      </MappableField>
      <MappableField field="style" label={t("audiocfg.styleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <>
          <TagTextarea
            rows={2}
            value={data.style ?? ""}
            onChange={(v) => { if (v.length <= 1000) onUpdate({ style: v }) }}
            placeholder={t("audiocfg.phGenreTags2")}
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
        <label htmlFor="suno-extend-customParams" className="text-xs font-medium text-muted-foreground">{t("audiocfg.useDefaultParamsUncheck")}</label>
      </div>
    </div>
  )
}

export function SunoLyricsConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoLyricsData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="prompt" label={t("node.prompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={3}
              value={data.prompt}
              onChange={(v) => { if (v.length <= 1000) onUpdate({ prompt: v }) }}
              placeholder={t("audiocfg.phDescribeLyrics")}
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

/**
 * Shared manual Task ID / Audio ID entry for Suno consumer nodes (separate /
 * music-video / replace-section / add-instrumental / add-vocals / convert-wav).
 * At run time a wired Suno connection wins over these fields (inputs-first in
 * both the FE run and the orchestrator); manual entry unlocks running against
 * a track from an earlier session without re-generating it.
 */
function SunoIdFields({ taskId, audioId, inherited, onUpdate }: {
  readonly taskId?: string
  readonly audioId?: string
  /** What a connected Suno node hands this node at run time (#819). */
  readonly inherited?: UpstreamSunoIds | null
  readonly onUpdate: (updates: { taskId?: string; audioId?: string }) => void
}) {
  const t = useT()
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.taskId")}</label>
        <Input value={taskId ?? ""} onChange={(e) => onUpdate({ taskId: e.target.value })} placeholder={inherited?.taskId ? t("audiocfg.inheritedValue", { value: inherited.taskId }) : t("audiocfg.phSunoTaskId")} aria-describedby={inherited?.taskId ? sunoInheritedHintId("task") : undefined} />
        <SunoInheritedHint what="task" manual={taskId} inherited={inherited?.taskId} sourceLabel={inherited?.sourceLabel} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.audioId")}</label>
        <Input value={audioId ?? ""} onChange={(e) => onUpdate({ audioId: e.target.value })} placeholder={inherited?.trackId ? t("audiocfg.inheritedValue", { value: inherited.trackId }) : t("audiocfg.phSunoAudioId")} aria-describedby={inherited?.trackId ? sunoInheritedHintId("track") : undefined} />
        <SunoInheritedHint what="track" manual={audioId} inherited={inherited?.trackId} sourceLabel={inherited?.sourceLabel} />
      </div>
      {!inherited && (
        <p className="text-[10px] text-muted-foreground">{t("audiocfg.resolvedFromSunoNode")}</p>
      )}
    </>
  )
}

/** The hint's DOM id — the manual field points at it via `aria-describedby`, since the inherited id otherwise lives only in a placeholder that vanishes on typing. One Suno panel is mounted at a time. */
function sunoInheritedHintId(what: "track" | "task"): string {
  return `suno-inherited-${what}`
}

/**
 * The id a connected Suno node hands this node, rendered under the manual
 * field. A wired Extend/Separate/… used to show an EMPTY required-looking
 * field while the run resolved the id fine (#819) — the only rational response
 * was to copy the id by hand. Precedence is unchanged and stated: a live
 * connection wins over the manual value.
 */
export function SunoInheritedHint({ what, manual, inherited, sourceLabel }: {
  readonly what: "track" | "task"
  readonly manual?: string
  readonly inherited?: string
  readonly sourceLabel?: string
}) {
  const t = useT()
  if (!inherited) return null
  const from = sourceLabel ? t("audiocfg.fromSource", { source: sourceLabel }) : t("audiocfg.fromConnectedNodeLower")
  return (
    <p id={sunoInheritedHintId(what)} className="text-[10px] text-muted-foreground" data-testid={`suno-inherited-${what}`}>
      {manual?.trim()
        ? <>{t("audiocfg.inheritedPrecedencePre", { what })} <span className="font-mono text-foreground/80">{inherited}</span> {t("audiocfg.inheritedPrecedencePost")}</>
        : <>{t("audiocfg.inheritedFromPre", { from })} <span className="font-mono text-foreground/80">{inherited}</span> {t("audiocfg.inheritedFromPost")}</>}
    </p>
  )
}

export function SunoSeparateConfig({ data, onUpdate, nodes, edges, nodeId }: ConfigProps<SunoSeparateData> & { nodeId?: string }) {
  const t = useT()
  // The ids a connected Suno node will hand this node at run time — shown so a
  // wired node reads as configured, not empty (#819).
  const inherited = useMemo(() => findUpstreamSunoIds(nodeId, nodes, edges), [nodeId, nodes, edges])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.separationType")}</label>
        <Select value={data.type} onValueChange={(v) => onUpdate({ type: v as SunoSeparateData["type"] })}>
          <SelectTrigger aria-label={t("audiocfg.separationType")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="separate_vocal">{t("audiocfg.vocalInstrumental")}</SelectItem>
            <SelectItem value="split_stem">{t("audiocfg.twelveStems")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <SunoIdFields taskId={data.taskId} audioId={data.audioId} inherited={inherited} onUpdate={onUpdate} />
      {data.vocalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.vocal")}</label>
          <WaveformAudioPlayer url={data.vocalUrl} variant="compact" className="w-full" />
        </div>
      )}
      {data.instrumentalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.instrumental")}</label>
          <WaveformAudioPlayer url={data.instrumentalUrl} variant="compact" className="w-full" />
        </div>
      )}
      {data.stems && Object.keys(data.stems).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.stems")}</label>
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
  const t = useT()
  const isCustom = data.preset === "custom"
  const isReverb = AUDIO_FX_REVERB_PRESETS.has(data.preset)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("field.effect")}</label>
        <Select value={data.preset} onValueChange={(v) => onUpdate({ preset: v as AudioFxData["preset"] })}>
          <SelectTrigger aria-label={t("field.effect")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {AUDIO_FX_PRESETS.map((p) => (<SelectItem key={p} value={p}>{AUDIO_FX_PRESET_LABELS[p]}</SelectItem>))}
          </SelectContent>
        </Select>
      </div>
      {isReverb && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.wetDryMix")}: {data.mix ?? "auto"}</label>
          <Slider min={0} max={100} step={1} value={[data.mix ?? 30]} onValueChange={(vals) => onUpdate({ mix: vals[0] })} />
          <p className="text-[10px] text-muted-foreground">{t("audiocfg.hintHigherRoom")}</p>
        </div>
      )}
      {(isCustom || data.preset === "echo") && (
        <>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.delayMs")}: {data.delayMs ?? 250}</label>
            <Slider min={20} max={2000} step={10} value={[data.delayMs ?? 250]} onValueChange={(vals) => onUpdate({ delayMs: vals[0] })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.decay")}: {data.decay ?? 0.4}</label>
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
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("field.mode")}</label>
        <Select value={data.mode} onValueChange={(v) => onUpdate({ mode: v as AudioSeparationData["mode"] })}>
          <SelectTrigger aria-label={t("field.mode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="vocal_instrumental">{t("audiocfg.vocalInstrumental")}</SelectItem>
            <SelectItem value="stems">{t("audiocfg.fullStems")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t("field.quality")}</label>
        <Select value={data.quality} onValueChange={(v) => onUpdate({ quality: v as AudioSeparationData["quality"] })}>
          <SelectTrigger aria-label={t("field.quality")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAuto")}</SelectItem>
            <SelectItem value="fast">{t("audiocfg.fast")}</SelectItem>
            <SelectItem value="best">{t("audiocfg.bestSlower")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {data.vocalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.vocals")}</label>
          <WaveformAudioPlayer url={data.vocalUrl} variant="compact" className="w-full" />
        </div>
      )}
      {data.instrumentalUrl && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{t("audiocfg.instrumental")}</label>
          <WaveformAudioPlayer url={data.instrumentalUrl} variant="compact" className="w-full" />
        </div>
      )}
    </div>
  )
}

export function SunoMusicVideoConfig({ data, onUpdate, nodes, edges, nodeId }: ConfigProps<SunoMusicVideoData> & { nodeId?: string }) {
  // The ids a connected Suno node will hand this node at run time — shown so a
  // wired node reads as configured, not empty (#819).
  const inherited = useMemo(() => findUpstreamSunoIds(nodeId, nodes, edges), [nodeId, nodes, edges])

  return (
    <div className="flex flex-col gap-3">
      <SunoIdFields taskId={data.taskId} audioId={data.audioId} inherited={inherited} onUpdate={onUpdate} />
      {data.generatedVideoUrl && (
        <div className="rounded-md border overflow-hidden">
          <video src={data.generatedVideoUrl} controls className="w-full" />
        </div>
      )}
    </div>
  )
}

export function SunoMashupConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<SunoMashupData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("audiocfg.hintMashup")}</p>
      <MappableField field="model" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoMashupData["model"] })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} creditId={sunoCreditType(m.value, "suno-mashup")} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <div className="flex items-center gap-2">
        <Checkbox id="mashup-custom-mode" checked={data.customMode} onCheckedChange={(v) => onUpdate({ customMode: !!v })} />
        <Label htmlFor="mashup-custom-mode" className="text-xs">{t("audiocfg.customMode")}</Label>
      </div>
      <MappableField field="title" label={t("audiocfg.titleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder={t("audiocfg.phSongTitle")} />
      </MappableField>
      <MappableField field="style" label={t("audiocfg.styleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.style ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }} placeholder={t("audiocfg.phGenreTags3")} maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="negativeStyle" label={t("audiocfg.negativeStyleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.negativeStyle ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }} placeholder={t("audiocfg.phStylesToAvoid")} maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="vocalGender" label={t("audiocfg.vocalGenderOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? "" : v })}>
          <SelectTrigger aria-label={t("audiocfg.vocalGender")}><SelectValue placeholder={t("audiocfg.phAuto")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAuto")}</SelectItem>
            <SelectItem value="male">{t("audiocfg.male")}</SelectItem>
            <SelectItem value="female">{t("audiocfg.female")}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
    </div>
  )
}

export function SunoReplaceSectionConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoReplaceSectionData> & { nodeId?: string }) {
  const t = useT()
  // The ids a connected Suno node will hand this node at run time — shown so a
  // wired node reads as configured, not empty (#819).
  const inherited = useMemo(() => findUpstreamSunoIds(nodeId, nodes, edges), [nodeId, nodes, edges])

  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("audiocfg.hintReplaceSection")}</p>
      <SunoIdFields taskId={data.taskId} audioId={data.audioId} inherited={inherited} onUpdate={onUpdate} />
      <MappableField field="infillStartS" label={t("audiocfg.startTime")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} step={1} value={data.infillStartS ?? ""} onChange={(e) => onUpdate({ infillStartS: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="0" />
      </MappableField>
      <MappableField field="infillEndS" label={t("audiocfg.endTime")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={0} step={1} value={data.infillEndS ?? ""} onChange={(e) => onUpdate({ infillEndS: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder="30" />
      </MappableField>
      <MappableField field="prompt" label={t("node.prompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea rows={3} value={data.prompt ?? ""} onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }} placeholder={t("audiocfg.phDescribeReplacement")} maxLength={SUNO_TEXT_MAX} tagMode="suno" customTags={SUNO_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} snippets={promptSnippets} />
        )}
      </MappableField>
      <MappableField field="tags" label={t("audiocfg.tagsOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.tags ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ tags: v }) }} placeholder={t("audiocfg.phStyleTags")} maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="title" label={t("audiocfg.titleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder={t("audiocfg.phSongTitle")} />
      </MappableField>
      <MappableField field="fullLyrics" label={t("audiocfg.fullLyricsPostEdit")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={4} value={data.fullLyrics ?? ""} onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ fullLyrics: v }) }} placeholder={t("audiocfg.phFullLyrics")} maxLength={SUNO_TEXT_MAX} tagMode="suno" customTags={SUNO_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="negativeTags" label={t("audiocfg.negativeTagsOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.negativeTags ?? ""} maxLength={500} onChange={(e) => onUpdate({ negativeTags: e.target.value })} placeholder={t("audiocfg.phStylesToAvoidRock")} />
      </MappableField>
    </div>
  )
}

export function SunoStyleBoostConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoStyleBoostData> & { nodeId?: string }) {
  const t = useT()
  const styleBoostSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "content")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.content,
    promptField: "content",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: styleBoostSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("audiocfg.hintEnhanceStyle")}</p>
      <MappableField field="content" label={t("field.content")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
        <SnippetMenuButton pool={styleBoostSnippets} value={data.content || ""} onInsert={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ content: v }) }} target="prompt" media="audio" />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={4 * 1.5}
          />
        ) : (
          <>
            <TagTextarea
              rows={4}
              value={data.content ?? ""}
              onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ content: v }) }}
              placeholder={t("audiocfg.phEnhanceStyle")}
              maxLength={SUNO_TEXT_MAX}
              tagMode="suno"
              customTags={SUNO_STYLE_SUGGESTION_ITEMS}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={styleBoostSnippets}
            />
            <p className="text-xs text-muted-foreground mt-1">{(data.content ?? "").length}/{SUNO_TEXT_MAX}</p>
          </>
        )}
      </MappableField>
      {data.generatedText && (
        <div>
          <Label>{t("audiocfg.result")}</Label>
          <div className="rounded-md border bg-muted/30 p-2 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap">
            {data.generatedText}
          </div>
        </div>
      )}
    </div>
  )
}

export function SunoAddInstrumentalConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeId }: ConfigProps<SunoAddInstrumentalData> & { nodeId?: string }) {
  const t = useT()
  // The ids a connected Suno node will hand this node at run time — shown so a
  // wired node reads as configured, not empty (#819).
  const inherited = useMemo(() => findUpstreamSunoIds(nodeId, nodes, edges), [nodeId, nodes, edges])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("audiocfg.hintAddInstrumental")}</p>
      <SunoIdFields taskId={data.taskId} audioId={data.audioId} inherited={inherited} onUpdate={onUpdate} />
      <MappableField field="model" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoAddInstrumentalData["model"] })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_ADD_TRACK_MODEL_OPTIONS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} creditId={sunoCreditType(m.value, "suno-add-instrumental")} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
    </div>
  )
}

export function SunoAddVocalsConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeId }: ConfigProps<SunoAddVocalsData> & { nodeId?: string }) {
  const t = useT()
  // The ids a connected Suno node will hand this node at run time — shown so a
  // wired node reads as configured, not empty (#819).
  const inherited = useMemo(() => findUpstreamSunoIds(nodeId, nodes, edges), [nodeId, nodes, edges])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("audiocfg.hintAddVocals")}</p>
      <SunoIdFields taskId={data.taskId} audioId={data.audioId} inherited={inherited} onUpdate={onUpdate} />
      <MappableField field="model" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoAddVocalsData["model"] })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_ADD_TRACK_MODEL_OPTIONS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} creditId={sunoCreditType(m.value, "suno-add-vocals")} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
    </div>
  )
}

export function SunoConvertWavConfig({ data, onUpdate, nodes, edges, nodeId }: ConfigProps<SunoConvertWavData> & { nodeId?: string }) {
  const t = useT()
  // The ids a connected Suno node will hand this node at run time — shown so a
  // wired node reads as configured, not empty (#819).
  const inherited = useMemo(() => findUpstreamSunoIds(nodeId, nodes, edges), [nodeId, nodes, edges])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("audiocfg.hintConvertWav")}</p>
      <SunoIdFields taskId={data.taskId} audioId={data.audioId} inherited={inherited} onUpdate={onUpdate} />
    </div>
  )
}

export function SunoUploadExtendConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<SunoUploadExtendData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t("audiocfg.hintExtendUploaded")}</p>
      <MappableField field="model" label={t("field.model")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.model || "V5_5"} onValueChange={(v) => onUpdate({ model: v as SunoUploadExtendData["model"] })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SUNO_MODELS.map((m) => (
              <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} creditId={sunoCreditType(m.value, "suno-upload-extend")} />
            ))}
          </SelectContent>
        </Select>
      </MappableField>
      <ModelDescriptionHint modelId={data.model} />
      <MappableField field="prompt" label={t("audiocfg.promptOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea rows={3} value={data.prompt ?? ""} onChange={(v) => { if (v.length <= SUNO_TEXT_MAX) onUpdate({ prompt: v }) }} placeholder={t("audiocfg.phDescribeExtension")} maxLength={SUNO_TEXT_MAX} tagMode="suno" customTags={SUNO_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} snippets={promptSnippets} />
        )}
      </MappableField>
      <MappableField field="continueAt" label={t("audiocfg.continueAt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input type="number" min={1} step={1} value={data.continueAt ?? ""} onChange={(e) => onUpdate({ continueAt: e.target.value === "" ? undefined : parseFloat(e.target.value) })} placeholder={t("audiocfg.continueAtPlaceholder")} />
      </MappableField>
      <div className="flex items-center gap-2">
        <Checkbox id="upload-extend-default" checked={data.defaultParamFlag} onCheckedChange={(v) => onUpdate({ defaultParamFlag: !!v })} />
        <Label htmlFor="upload-extend-default" className="text-xs">{t("audiocfg.useDefaultParams")}</Label>
      </div>
      <MappableField field="title" label={t("audiocfg.titleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input value={data.title ?? ""} maxLength={200} onChange={(e) => onUpdate({ title: e.target.value })} placeholder={t("audiocfg.phSongTitle")} />
      </MappableField>
      <MappableField field="style" label={t("audiocfg.styleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.style ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ style: v }) }} placeholder={t("audiocfg.phGenreTags3")} maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="negativeStyle" label={t("audiocfg.negativeStyleOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea rows={2} value={data.negativeStyle ?? ""} onChange={(v) => { if (v.length <= 500) onUpdate({ negativeStyle: v }) }} placeholder={t("audiocfg.phStylesToAvoid")} maxLength={500} tagMode="suno" customTags={SUNO_STYLE_SUGGESTION_ITEMS} nodeRefs={nodeRefs} displayMode={variableDisplayMode} refMap={refMap} />
      </MappableField>
      <MappableField field="vocalGender" label={t("audiocfg.vocalGenderOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "auto" ? "" : v })}>
          <SelectTrigger aria-label={t("audiocfg.vocalGender")}><SelectValue placeholder={t("audiocfg.phAuto")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAuto")}</SelectItem>
            <SelectItem value="male">{t("audiocfg.male")}</SelectItem>
            <SelectItem value="female">{t("audiocfg.female")}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
    </div>
  )
}

export function TranscribeConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs }: ConfigProps<TranscribeData>) {
  const t = useT()
  // Persist the UI's default (step-12b fail-safe pattern): the Select SHOWS
  // elevenlabs-stt when provider is undefined, but the backend defaults an
  // absent provider to whisper — so an untouched node ran a different lane
  // than the panel displayed (surfaced by the #761 review, worse once all
  // three lanes became selectable). Writing the shown default makes the
  // stored data match the pixels.
  useEffect(() => {
    if (data.provider === undefined) onUpdate({ provider: "elevenlabs-stt" })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.provider])
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="provider" label={t("field.provider")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.provider || "elevenlabs-stt"} onValueChange={(v) => onUpdate({ provider: v as TranscribeData["provider"] })}>
          <SelectTrigger aria-label={t("field.provider")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {/* All three backend lanes are selectable again (#761): the two
                whisper lanes run on a Replicate key locally and — like
                elevenlabs-stt — through the nodaro.ai connection on keyless
                installs (the cloud holds keys for both). They were commented
                out as dead code while no lane could serve them. */}
            <SelectItem value="elevenlabs-stt">{t("audiocfg.providerElevenLabsStt")}</SelectItem>
            <SelectItem value="whisper">{t("audiocfg.providerWhisper")}</SelectItem>
            <SelectItem value="incredibly-fast-whisper">{t("audiocfg.providerIncrediblyFastWhisper")}</SelectItem>
          </SelectContent>
        </Select>
      </MappableField>
      <MappableField field="language" label={t("field.language")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={data.language || "auto"} onValueChange={(v) => onUpdate({ language: v })}>
          <SelectTrigger aria-label={t("field.language")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("langname.autoDetect")}</SelectItem>
            <SelectItem value="en">{t("langname.en")}</SelectItem>
            <SelectItem value="he">{t("langname.he")}</SelectItem>
            <SelectItem value="es">{t("langname.es")}</SelectItem>
            <SelectItem value="fr">{t("langname.fr")}</SelectItem>
            <SelectItem value="de">{t("langname.de")}</SelectItem>
            <SelectItem value="it">{t("langname.it")}</SelectItem>
            <SelectItem value="pt">{t("langname.pt")}</SelectItem>
            <SelectItem value="ja">{t("langname.ja")}</SelectItem>
            <SelectItem value="zh">{t("langname.zh")}</SelectItem>
            <SelectItem value="ko">{t("langname.ko")}</SelectItem>
            <SelectItem value="ar">{t("langname.ar")}</SelectItem>
            <SelectItem value="ru">{t("langname.ru")}</SelectItem>
            <SelectItem value="hi">{t("langname.hi")}</SelectItem>
            <SelectItem value="nl">{t("langname.nl")}</SelectItem>
            <SelectItem value="tr">{t("langname.tr")}</SelectItem>
            <SelectItem value="pl">{t("langname.pl")}</SelectItem>
            <SelectItem value="sv">{t("langname.sv")}</SelectItem>
            <SelectItem value="th">{t("langname.th")}</SelectItem>
            <SelectItem value="vi">{t("langname.vi")}</SelectItem>
            <SelectItem value="uk">{t("langname.uk")}</SelectItem>
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
            <Label htmlFor="diarize">{t("audiocfg.speakerDiarization")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="tagAudioEvents"
              checked={data.tagAudioEvents ?? false}
              onCheckedChange={(v: boolean) => onUpdate({ tagAudioEvents: v })}
            />
            <Label htmlFor="tagAudioEvents">{t("audiocfg.tagAudioEvents")}</Label>
          </div>
        </>
      )}
    </div>
  )
}

// Per-provider resolution option set for the Lip Sync node. OmniHuman 1.5 is
// 720/1080 only (no 480p), default 1080; the full Seedance 2 adds 1080 to
// 480/720; seedance-2-fast / -mini and other KIE avatars are 480/720 only
// (fast has NO 1080p SKU — KIE pricing page verified 2026-06-25). Drives both
// the dropdown and the fail-safe useEffect so a stale value snaps to a valid
// one on provider switch.
function lipSyncResolutionOptions(
  provider: string,
): { values: Array<"480p" | "720p" | "1080p">; def: "480p" | "720p" | "1080p" } {
  if (provider === "omnihuman-1-5") return { values: ["720p", "1080p"], def: "1080p" }
  if (provider === "seedance-2")
    return { values: ["480p", "720p", "1080p"], def: "720p" }
  return { values: ["480p", "720p"], def: "720p" }
}

export function LipSyncConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<LipSyncData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
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
      <MappableField field="provider" label={t("field.provider")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Select value={provider} onValueChange={(v) => onUpdate({ provider: v as LipSyncData["provider"] })}>
          <SelectTrigger aria-label={t("field.provider")}><SelectValue /></SelectTrigger>
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
        <MappableField field="resolution" label={t("field.resolution")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <Select value={data.resolution || resOpts.def} onValueChange={(v) => onUpdate({ resolution: v as LipSyncData["resolution"] })}>
            <SelectTrigger aria-label={t("field.resolution")}><SelectValue /></SelectTrigger>
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
        <MappableField field="prompt" label={t("audiocfg.motionPromptOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
          <span className="inline-flex items-center gap-0.5">
            <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
            <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="audio" />
          </span>
        }>
          {promptFieldMode.mode === "final" ? (
            <PromptFieldFinalView
              segments={finalPrompt.promptSegments}
              plainText={finalPrompt.promptText}
              placeholder={t("audiocfg.phPromptPreviewEmpty")}
              minHeightRem={2 * 1.5}
            />
          ) : (
            <TagTextarea
              rows={2}
              value={data.prompt ?? ""}
              onChange={(v) => onUpdate({ prompt: v })}
              placeholder={t("audiocfg.phMotions")}
              tagMode="none"
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
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
        label={t("field.injectedReferences")}
      />
      <SeedanceReferenceTip provider={provider} />

      {/* OmniHuman 1.5 — fast mode + seed (prompt + resolution are above) */}
      {provider === "omnihuman-1-5" && (
        <>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.fastMode")}</Label>
            <Switch checked={data.fastMode ?? false} onCheckedChange={(v) => onUpdate({ fastMode: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintTradeQuality")}</p>
          <div>
            <Label>{t("field.seed")}</Label>
            <Input
              type="number"
              value={data.seed ?? -1}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                onUpdate({ seed: Number.isNaN(n) ? -1 : n })
              }}
              placeholder={t("audiocfg.phNegOneRandom")}
            />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintSameSeed")}</p>
          </div>
        </>
      )}

      {/* LatentSync params */}
      {provider === "latentsync" && (
        <>
          <div>
            <Label>{t("field.guidanceScale")} ({data.guidanceScale ?? 2})</Label>
            <Slider min={1} max={3} step={0.1} value={[data.guidanceScale ?? 2]} onValueChange={(vals) => onUpdate({ guidanceScale: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintHigherSync")}</p>
          </div>
          <div>
            <Label>{t("audiocfg.inferenceSteps")} ({data.inferenceSteps ?? 20})</Label>
            <Slider min={20} max={50} step={1} value={[data.inferenceSteps ?? 20]} onValueChange={(vals) => onUpdate({ inferenceSteps: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintMoreSteps")}</p>
          </div>
          <div>
            <Label>{t("field.seed")}</Label>
            <Input type="number" value={data.seed ?? 0} onChange={(e) => onUpdate({ seed: parseInt(e.target.value) || 0 })} placeholder={t("audiocfg.phZeroRandom")} />
          </div>
        </>
      )}

      {/* Wav2Lip params */}
      {provider === "wav2lip" && (
        <>
          <div>
            <Label>{t("audiocfg.facePadding")}</Label>
            <Input value={data.pads ?? "0 10 0 0"} onChange={(e) => onUpdate({ pads: e.target.value })} placeholder={t("audiocfg.phPadding")} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintFacePadding")}</p>
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.smooth")}</Label>
            <Switch checked={data.smooth !== false} onCheckedChange={(v) => onUpdate({ smooth: v })} />
          </div>
          <div>
            <Label>{t("field.fps")}</Label>
            <Input type="number" value={data.fps ?? 25} onChange={(e) => onUpdate({ fps: parseInt(e.target.value) || 25 })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintStaticImageOnly")}</p>
          </div>
          <div>
            <Label>{t("audiocfg.resizeFactor")}</Label>
            <Input type="number" min={1} max={4} value={data.resizeFactor ?? 1} onChange={(e) => onUpdate({ resizeFactor: parseInt(e.target.value) || 1 })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintResizeFactor")}</p>
          </div>
        </>
      )}

      {/* SadTalker params */}
      {provider === "sadtalker" && (
        <>
          <div>
            <Label>{t("audiocfg.faceEnhancer")}</Label>
            <Select value={data.enhancer ?? "gfpgan"} onValueChange={(v) => onUpdate({ enhancer: v as "gfpgan" | "RestoreFormer" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gfpgan">GFPGAN</SelectItem>
                <SelectItem value="RestoreFormer">RestoreFormer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("audiocfg.preprocess")}</Label>
            <Select value={data.preprocess ?? "full"} onValueChange={(v) => onUpdate({ preprocess: v as "crop" | "resize" | "full" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="crop">{t("audiocfg.crop")}</SelectItem>
                <SelectItem value="resize">{t("audiocfg.resize")}</SelectItem>
                <SelectItem value="full">{t("audiocfg.full")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.stillMode")}</Label>
            <Switch checked={data.still ?? false} onCheckedChange={(v) => onUpdate({ still: v })} />
          </div>
          <div>
            <Label>{t("audiocfg.poseStyle")} ({data.poseStyle ?? 0})</Label>
            <Slider min={0} max={45} step={1} value={[data.poseStyle ?? 0]} onValueChange={(vals) => onUpdate({ poseStyle: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintHeadMovement")}</p>
          </div>
          <div>
            <Label>{t("audiocfg.expressionScale")} ({data.expressionScale ?? 1})</Label>
            <Slider min={0} max={3} step={0.1} value={[data.expressionScale ?? 1]} onValueChange={(vals) => onUpdate({ expressionScale: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintExpressionStrength")}</p>
          </div>
        </>
      )}

      {/* HeyGen Lipsync Precision params */}
      {provider === "heygen-lipsync-precision" && (
        <>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.dynamicDuration")}</Label>
            <Switch checked={data.enableDynamicDuration !== false} onCheckedChange={(v) => onUpdate({ enableDynamicDuration: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintAdjustLength")}</p>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.removeMusicTrack")}</Label>
            <Switch checked={data.disableMusicTrack ?? false} onCheckedChange={(v) => onUpdate({ disableMusicTrack: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintStripMusic")}</p>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.speechEnhancement")}</Label>
            <Switch checked={data.enableSpeechEnhancement ?? false} onCheckedChange={(v) => onUpdate({ enableSpeechEnhancement: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintImproveClarity")}</p>
        </>
      )}

      {/* Sync Mode — sync.so family (Lipsync 2 Pro on Replicate + Sync Lipsync
          v3 on fal). Both accept the same 5-value enum and bind data.syncMode. */}
      {(provider === "lipsync-2-pro" || provider === "sync-lipsync-v3") && (
        <div>
          <Label>{t("audiocfg.syncMode")}</Label>
          {/* Default to each model's native API default: cut_off for fal's
              sync v3, loop for sync.so Lipsync 2 Pro (Replicate). */}
          <Select value={data.syncMode ?? (provider === "sync-lipsync-v3" ? "cut_off" : "loop")} onValueChange={(v) => onUpdate({ syncMode: v as LipSyncData["syncMode"] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="loop">{t("field.loop")}</SelectItem>
              <SelectItem value="bounce">{t("audiocfg.bounce")}</SelectItem>
              <SelectItem value="cut_off">{t("audiocfg.cutOff")}</SelectItem>
              <SelectItem value="silence">{t("audiocfg.silence")}</SelectItem>
              <SelectItem value="remap">{t("audiocfg.remap")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintDurationDiffer")}</p>
        </div>
      )}

      {/* Lipsync 2 Pro-only params (fal's Sync Lipsync v3 only takes sync_mode) */}
      {provider === "lipsync-2-pro" && (
        <>
          <div>
            <Label>{t("audiocfg.temperature")} ({(data.temperature ?? 0.5).toFixed(1)})</Label>
            <Slider min={0} max={1} step={0.1} value={[data.temperature ?? 0.5]} onValueChange={(vals) => onUpdate({ temperature: vals[0] })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintExpressiveLipSync")}</p>
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.activeSpeakerDetection")}</Label>
            <Switch checked={data.activeSpeaker ?? false} onCheckedChange={(v) => onUpdate({ activeSpeaker: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintLipSyncSpeaker")}</p>
        </>
      )}

      {/* Video-Retalking has no configurable params */}
      {provider === "video-retalking" && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descTalkingHeadFaceEnh")}
        </p>
      )}

      {/* Volcengine video-to-video dubbing — mode-conditional controls. Lite =
          single-speaker frontal (loop levers); Basic = complex scenes + the
          multi-speaker scene-detection differentiator. */}
      {isVolcengine && (
        <>
          <div>
            <Label>{t("field.mode")}</Label>
            <Select value={data.mode ?? "lite"} onValueChange={(v) => onUpdate({ mode: v as "lite" | "basic" })}>
              <SelectTrigger aria-label={t("field.mode")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lite">{t("audiocfg.modeLite")}</SelectItem>
                <SelectItem value="basic">{t("audiocfg.modeBasic")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <Label>{t("audiocfg.separateVocals")}</Label>
            <Switch checked={data.separateVocal ?? false} onCheckedChange={(v) => onUpdate({ separateVocal: v })} />
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintStripNoise")}</p>

          {/* Basic mode only — multi-speaker scene detection + speaker ID */}
          {(data.mode ?? "lite") === "basic" && (
            <>
              <div className="flex items-center justify-between">
                <Label>{t("audiocfg.sceneDetectionSpeakerId")}</Label>
                <Switch checked={data.openScenedet ?? false} onCheckedChange={(v) => onUpdate({ openScenedet: v })} />
              </div>
              <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintSegmentScenes")}</p>
            </>
          )}

          {/* Lite mode only — loop the video when the audio runs longer */}
          {(data.mode ?? "lite") === "lite" && (
            <>
              <div className="flex items-center justify-between">
                <Label>{t("audiocfg.loopIfAudioLonger")}</Label>
                <Switch checked={data.alignAudio !== false} onCheckedChange={(v) => onUpdate({ alignAudio: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>{t("audiocfg.reverseLoop")}</Label>
                <Switch checked={data.alignAudioReverse ?? false} onCheckedChange={(v) => onUpdate({ alignAudioReverse: v })} disabled={data.alignAudio === false} />
              </div>
              <p className="text-xs text-muted-foreground -mt-1">{t("audiocfg.hintReverseLoopReq")}</p>
            </>
          )}

          <div>
            <Label>{t("audiocfg.templateStartTime")}</Label>
            <Input type="number" min={0} value={data.templStartSeconds ?? 0} onChange={(e) => onUpdate({ templStartSeconds: parseFloat(e.target.value) || 0 })} />
            <p className="text-xs text-muted-foreground mt-1">{t("audiocfg.hintLipStart")}</p>
          </div>
        </>
      )}

      {/* Help text per provider category */}
      {imageInputKie && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descPortraitTalkingHead")}
        </p>
      )}
      {provider === "latentsync" && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descSingingDiffusion")}
        </p>
      )}
      {provider === "wav2lip" && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descFastCheapLipSync")}
        </p>
      )}
      {provider === "sadtalker" && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descPortraitNaturalMotion")}
        </p>
      )}
      {provider === "heygen-lipsync-precision" && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descAvatarInference")}
        </p>
      )}
      {provider === "lipsync-2-pro" && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descStudioGrade")}
        </p>
      )}
      {provider === "sync-lipsync-v3" && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descSyncSo")}
        </p>
      )}
      {isVolcengine && (
        <p className="text-xs text-muted-foreground">
          {t("audiocfg.descVolcengine")}
        </p>
      )}
    </div>
  )
}

export function AudioIsolationConfig({ data, onUpdate, nodeRefs }: ConfigProps<AudioIsolationData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("configPanel.label")}</Label>
        <Input
          value={data.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={t("audiocfg.phVoiceExtractor")}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("audiocfg.descVoiceExtractor")}
      </p>
    </div>
  )
}

export function TextToDialogueConfig({ data, onUpdate, sources, nodeRefs, refMap, variableDisplayMode }: ConfigProps<TextToDialogueData>) {
  const t = useT()
  const dialogue = data.dialogue ?? [{ id: "1", text: "", voice: DEFAULT_DIALOGUE_VOICE }]
  const totalChars = dialogue.reduce((sum, l) => sum + l.text.length, 0)
  // Shared cap — the same getter the route's Zod refine reads, so the counter
  // can't drift from what the backend accepts (three copies drifted before).
  const maxChars = getMaxTtsChars("elevenlabs-dialogue")
  // Probed ElevenLabs hard limit: an 11th unique voice → 400 max_voices_exceeded.
  const uniqueVoices = new Set(dialogue.filter((l) => l.voice).map((l) => l.voice)).size

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
        <Label>{t("audiocfg.dialogueLines")}</Label>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${uniqueVoices > 10 ? "text-red-500" : "text-muted-foreground"}`} title={t("audiocfg.hintDialogueVoiceCap")}>
            {t("audiocfg.dialogueVoiceCount", { count: uniqueVoices })}
          </span>
          <span className={`text-xs ${totalChars > maxChars ? "text-red-500" : "text-muted-foreground"}`}>
            {totalChars}/{maxChars}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-2">{t("audiocfg.hintDialogueRecommended")}</p>

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
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={t("audiocfg.removeDialogueLine")} onClick={() => removeLine(i)}>
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
        <Label>{t("field.stability")}</Label>
        <Select
          value={String(data.stability ?? 0.5)}
          onValueChange={(v) => onUpdate({ stability: parseFloat(v) })}
        >
          <SelectTrigger aria-label={t("field.stability")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">{t("audiocfg.mostVariable")}</SelectItem>
            <SelectItem value="0.5">{t("audiocfg.balanced05")}</SelectItem>
            <SelectItem value="1">{t("audiocfg.mostStable")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>{t("field.language")}</Label>
        <Select
          value={data.languageCode || "auto"}
          onValueChange={(v) => onUpdate({ languageCode: v === "auto" ? "" : v })}
        >
          <SelectTrigger aria-label={t("field.language")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAutoDetect")}</SelectItem>
            {ALL_LANGUAGES.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="dlg-seed">{t("field.seed")}</Label>
        <Input
          id="dlg-seed"
          type="number"
          min={0}
          max={4294967295}
          placeholder={t("audiocfg.phRandom")}
          value={data.seed ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === "") { onUpdate({ seed: undefined }); return }
            const n = parseInt(raw, 10)
            if (Number.isFinite(n)) onUpdate({ seed: n })
          }}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("audiocfg.hintSeedReproducible")}
        </p>
      </div>

      <div>
        <Label>{t("audiocfg.textNormalization")}</Label>
        <Select
          value={data.applyTextNormalization ?? "auto"}
          onValueChange={(v) => onUpdate({ applyTextNormalization: v === "auto" ? undefined : (v as TextToDialogueData["applyTextNormalization"]) })}
        >
          <SelectTrigger aria-label={t("audiocfg.textNormalization")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.normalizationAuto")}</SelectItem>
            <SelectItem value="on">{t("audiocfg.normalizationOn")}</SelectItem>
            <SelectItem value="off">{t("audiocfg.normalizationOff")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("audiocfg.hintTextNormalization")}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("audiocfg.descTextToDialogue")}
      </p>
    </div>
  )
}

export function VoiceChangerConfig({ data, onUpdate, nodeRefs }: ConfigProps<VoiceChangerData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("field.voice")}</Label>
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
        <Label htmlFor="vc-model">{t("field.model")}</Label>
        <Select
          value={data.model || DEFAULT_VOICE_CHANGER_MODEL}
          onValueChange={(v) => onUpdate({ model: v as VoiceChangerData["model"] })}
        >
          <SelectTrigger id="vc-model" aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {VOICE_CHANGER_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {VOICE_CHANGER_MODELS.find((m) => m.value === (data.model || DEFAULT_VOICE_CHANGER_MODEL))?.desc}
        </p>
      </div>
      <div>
        <Label htmlFor="vc-stability">{t("field.stability")} ({data.stability ?? 0.5})</Label>
        <Input id="vc-stability" type="range" min={0} max={1} step={0.05} value={data.stability ?? 0.5} onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.variable")}</span><span>{t("audiocfg.stable")}</span></div>
      </div>
      <div>
        <Label htmlFor="vc-similarity">{t("audiocfg.similarity")} ({data.similarityBoost ?? 0.75})</Label>
        <Input id="vc-similarity" type="range" min={0} max={1} step={0.05} value={data.similarityBoost ?? 0.75} onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.low")}</span><span>{t("audiocfg.high")}</span></div>
      </div>
      <div>
        <Label htmlFor="vc-style">{t("audiocfg.styleExaggeration")} ({data.style ?? 0})</Label>
        <Input id="vc-style" type="range" min={0} max={1} step={0.05} value={data.style ?? 0} onChange={(e) => onUpdate({ style: parseFloat(e.target.value) })} className="h-2" />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.none")}</span><span>{t("audiocfg.exaggerated")}</span></div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("audiocfg.hintSpeakerBoostDesc")}
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="vc-speaker-boost">{t("field.speakerBoost")}</Label>
          <Switch id="vc-speaker-boost" checked={data.useSpeakerBoost ?? true} onCheckedChange={(c: boolean) => onUpdate({ useSpeakerBoost: c })} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("audiocfg.hintSimilarityBoostDesc")}
        </p>
      </div>
      <div>
        <Label htmlFor="vc-seed">{t("field.seed")}</Label>
        <Input
          id="vc-seed"
          type="number"
          min={0}
          max={4294967295}
          placeholder={t("audiocfg.phRandom")}
          value={data.seed ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim()
            if (raw === "") { onUpdate({ seed: undefined }); return }
            const n = parseInt(raw, 10)
            if (Number.isFinite(n)) onUpdate({ seed: n })
          }}
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("audiocfg.hintSeedReproducible")}
        </p>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="vc-remove-bg"
            checked={data.removeBackgroundNoise ?? false}
            onCheckedChange={(v: boolean) => onUpdate({ removeBackgroundNoise: v })}
          />
          <Label htmlFor="vc-remove-bg">{t("audiocfg.removeBackgroundNoise")}</Label>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 ml-6">
          {t("audiocfg.hintRevoiceOffOn")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("audiocfg.hintRevoicePre")}<span className="font-medium">{t("audiocfg.optAudio")}</span>{t("audiocfg.hintRevoiceMid")}<span className="font-medium">{t("audiocfg.optVideo")}</span>{t("audiocfg.hintRevoicePost")}
      </p>
    </div>
  )
}

// DubbingConfig moved to ./dubbing-config.tsx (file-size cap + the full-surface
// upgrade: video mode, source links, dub windows, per-minute pricing).
export { DubbingConfig } from "./dubbing-config"

export function VoiceRemixConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<VoiceRemixData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "voiceDescription")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.voiceDescription,
    promptField: "voiceDescription",
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
      <MappableField field="voiceDescription" label={t("audiocfg.voiceDescription")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.voiceDescription || ""} onInsert={(v) => onUpdate({ voiceDescription: v })} target="prompt" media="audio" />
        </span>
      }>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea
            rows={3}
            value={data.voiceDescription || ""}
            onChange={(v) => onUpdate({ voiceDescription: v })}
            placeholder={t("audiocfg.phDescribeVoice")}
            tagMode="none"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>
      <MappableField field="text" label={t("audiocfg.previewText")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={2}
          value={data.text || ""}
          onChange={(v) => onUpdate({ text: v })}
          placeholder={t("audiocfg.phPreviewVoice")}
          tagMode="none"
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <p className="text-xs text-muted-foreground">
        {t("audiocfg.descVoiceDesign")}
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
  const t = useT()
  const ttsProvider = VOICE_DESIGN_MODEL_TO_TTS_PROVIDER[data.model || "eleven_ttv_v3"] || "elevenlabs-v3"
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "voiceDescription")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.voiceDescription,
    promptField: "voiceDescription",
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
      <MappableField field="voiceDescription" label={t("audiocfg.voiceDescription")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.voiceDescription || ""} onInsert={(v) => onUpdate({ voiceDescription: v })} target="prompt" media="audio" />
        </span>
      }>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea
            rows={3}
            value={data.voiceDescription || ""}
            onChange={(v) => onUpdate({ voiceDescription: v })}
            placeholder={t("audiocfg.phDescribeVoice")}
            tagMode="none"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>
      <MappableField field="text" label={t("audiocfg.previewTextRange")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.text || ""}
          onChange={(v) => { if (v.length <= 1000) onUpdate({ text: v }) }}
          placeholder={t("audiocfg.phPreviewVoiceMin")}
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
        <Label>{t("field.model")}</Label>
        <Select value={data.model || "eleven_ttv_v3"} onValueChange={(v) => onUpdate({ model: v })}>
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="eleven_multilingual_ttv_v2">ElevenLabs Multilingual v2</SelectItem>
            <SelectItem value="eleven_ttv_v3">ElevenLabs v3 (recommended)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ProviderAudioTagWarning provider={ttsProvider} fieldValues={[data.text]} />
      <div>
        <Label>{t("audiocfg.loudness")}: {data.loudness?.toFixed(1) ?? "0.0"}</Label>
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
          <span>{t("audiocfg.quiet")}</span>
          <span>{t("audiocfg.loud")}</span>
        </div>
      </div>
      <div>
        <Label>{t("field.guidanceScale")}: {data.guidanceScale ?? 5}</Label>
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
          <span>{t("audiocfg.creative")}</span>
          <span>{t("audiocfg.strict")}</span>
        </div>
      </div>
      <div>
        <Label>{t("field.seedOptional")}</Label>
        <Input
          type="number"
          value={data.seed ?? ""}
          onChange={(e) => onUpdate({ seed: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder={t("audiocfg.phRandom")}
        />
      </div>
      <div>
        <Label>{t("field.qualityOptional")}</Label>
        <Input
          type="number"
          value={data.quality ?? ""}
          onChange={(e) => onUpdate({ quality: e.target.value ? parseFloat(e.target.value) : undefined })}
          placeholder={t("audiocfg.phQualityDefault")}
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="should-enhance"
          checked={data.shouldEnhance ?? false}
          onCheckedChange={(v) => onUpdate({ shouldEnhance: !!v })}
        />
        <Label htmlFor="should-enhance" className="cursor-pointer">{t("audiocfg.enhanceAudioQuality")}</Label>
      </div>
      {data.generatedVoiceId && (
        <div className="rounded-md bg-muted/50 p-2">
          <Label className="text-[10px] text-muted-foreground">{t("audiocfg.generatedVoiceId")}</Label>
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
  const t = useT()
  const promptSnippets = useSnippetPool("audio", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "transcript")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.transcript,
    promptField: "transcript",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? EMPTY_EDGES,
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <MappableField field="transcript" label={t("audiocfg.transcript")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
      </span>}>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("audiocfg.phPromptPreviewEmpty")}
            minHeightRem={5 * 1.5}
          />
        ) : (
          <TagTextarea
            rows={5}
            value={data.transcript || ""}
            onChange={(v) => onUpdate({ transcript: v })}
            placeholder={t("audiocfg.phEnterTranscript")}
            tagMode="none"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>
      <p className="text-xs text-muted-foreground">
        {t("audiocfg.descForcedAlign")}
      </p>
    </div>
  )
}

/** Sentinel for the "no Voice FX" Select option. Distinct from every
 *  AudioFxPreset id so picking it can't be mistaken for a real preset; chosen ⇒
 *  `voiceFx` is cleared to undefined (the default = no effect). */
const VOICE_FX_NONE = "__none__"

export function VoiceChangerProConfig({ data, onUpdate }: ConfigProps<VoiceChangerProData>) {
  const t = useT()
  const voices = data.orderedVoices ?? []
  const addVoice = (voiceId: string, voiceLabel: string, voiceType: "premade" | "custom" | "library") =>
    onUpdate({ orderedVoices: [...voices, { voiceId, voiceLabel, voiceType }] })
  // Append a keep-slot — a null entry meaning "keep this speaker's original
  // voice" (cloud-plugins orderedVoices keep-slot contract).
  const addKeepSlot = () => onUpdate({ orderedVoices: [...voices, null] })
  // Replace the entry at i with a whole new value (copy the array) — the
  // position-preserving primitive both keep-slot conversions share.
  const replaceAt = (i: number, value: VoiceChangerProData["orderedVoices"][number]) =>
    onUpdate({ orderedVoices: voices.map((v, idx) => (idx === i ? value : v)) })
  // Convert the voice at i to a keep-slot in place. Per-voice settings are
  // intentionally discarded — a keep-slot has nothing to configure.
  const keepAt = (i: number) => replaceAt(i, null)
  // Fill the keep-slot at i with a picked voice, preserving its position.
  const setVoiceAt = (i: number, voiceId: string, voiceLabel: string, voiceType: "premade" | "custom" | "library") =>
    replaceAt(i, { voiceId, voiceLabel, voiceType })
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
  // Never invoked for a null "keep original" slot — its row hides the
  // settings drawer that calls this, per the render guard below.
  const updateVoice = (i: number, patch: Partial<NonNullable<VoiceChangerProData["orderedVoices"][number]>>) => {
    const next = voices.map((v, idx) => (idx === i ? { ...v, ...patch } : v))
    onUpdate({ orderedVoices: next })
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("audiocfg.descRecast1")}
        {t("audiocfg.descRecast2")}
      </p>
      <div>
        <Label>{t("audiocfg.addVoice")}</Label>
        <VoiceBrowser
          value=""
          onSelect={(id, name, voiceType) => addVoice(id, name, voiceType ?? "premade")}
          showCustomVoices
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-1 h-7 w-full text-xs text-muted-foreground"
          aria-label={t("audiocfg.addKeepOriginalSlot")}
          onClick={addKeepSlot}
        >
          <Plus className="h-3 w-3 mr-1" /> Keep original — don&apos;t recast this speaker
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        {voices.map((v, i) => (
          // A null entry means "keep this speaker's original voice"
          // (cloud-plugins orderedVoices keep-slot contract) — it has no
          // per-voice settings to tune, so the details drawer below is
          // skipped entirely for it.
          <div key={v ? `${v.voiceId}-${i}` : `keep-${i}`} className="rounded border">
            <div className="flex items-center gap-2 px-2 py-1">
              <span className="text-xs text-muted-foreground w-16">{t("audiocfg.speakerN", { n: i + 1 })}</span>
              {v ? (
                <span className="text-sm flex-1 truncate">{v.voiceLabel}</span>
              ) : (
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <span className="text-sm text-muted-foreground truncate">{t("audiocfg.keepOriginal")}</span>
                  <VoiceBrowser
                    value=""
                    valueLabel="Choose voice…"
                    compact
                    showCustomVoices
                    triggerAriaLabel={`Choose voice for speaker ${i + 1}`}
                    onSelect={(id, name, voiceType) => setVoiceAt(i, id, name, voiceType ?? "premade")}
                  />
                </div>
              )}
              {v && (
                <button
                  aria-label={`Keep original for speaker ${i + 1}`}
                  title={t("audiocfg.keepOriginalVoiceTitle")}
                  onClick={() => keepAt(i)}
                  className="text-[10px] px-1 text-muted-foreground hover:text-foreground"
                >
                  Keep
                </button>
              )}
              <button aria-label={t("audiocfg.moveUp")} onClick={() => move(i, -1)} className="text-xs px-1">↑</button>
              <button aria-label={t("audiocfg.moveDown")} onClick={() => move(i, 1)} className="text-xs px-1">↓</button>
              <button aria-label={t("audiocfg.removeVoice")} onClick={() => removeVoice(i)} className="text-xs px-1">✕</button>
            </div>
            {v && (
            <details className="border-t px-2 py-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground select-none">{t("audiocfg.voiceSettings")}</summary>
              <div className="flex flex-col gap-2 pt-2">
                <div>
                  <Label>{t("audiocfg.vcpEngine")}</Label>
                  <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label={t("audiocfg.vcpEngine")}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={(v.engine ?? "sts") === "sts"}
                      className={`h-7 rounded-md border text-xs ${(v.engine ?? "sts") === "sts" ? "border-[#ff0073] text-foreground" : "border-border text-muted-foreground"}`}
                      onClick={() => updateVoice(i, { engine: undefined })}
                    >
                      {t("audiocfg.engineRecast")}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={v.engine === "v3"}
                      className={`h-7 rounded-md border text-xs ${v.engine === "v3" ? "border-[#ff0073] text-foreground" : "border-border text-muted-foreground"}`}
                      onClick={() => updateVoice(i, { engine: "v3", stability: v.stability === 0 || v.stability === 0.5 || v.stability === 1 ? v.stability : 0.5 })}
                    >
                      {t("audiocfg.engineRespeak")}
                    </button>
                  </div>
                  {v.engine === "v3" && (
                    <p className="text-[10px] text-amber-600 mt-1">{t("audiocfg.hintRespeakWarning")}</p>
                  )}
                </div>
                {v.engine === "v3" ? (
                  <div>
                    <Label>{t("field.stability")}</Label>
                    <Select
                      value={String(v.stability ?? 0.5)}
                      onValueChange={(val) => updateVoice(i, { stability: parseFloat(val) })}
                    >
                      <SelectTrigger aria-label={t("field.stability")}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">{t("audiocfg.mostVariable")}</SelectItem>
                        <SelectItem value="0.5">{t("audiocfg.balanced05")}</SelectItem>
                        <SelectItem value="1">{t("audiocfg.mostStable")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                <div>
                  <Label htmlFor={`stability-${i}`}>{t("field.stability")} ({v.stability ?? 0.5})</Label>
                  <Input id={`stability-${i}`} type="range" min={0} max={1} step={0.05} value={v.stability ?? 0.5} onChange={(e) => updateVoice(i, { stability: parseFloat(e.target.value) })} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.variable")}</span><span>{t("audiocfg.stable")}</span></div>
                </div>
                )}
                {/* STS-only levers — the v3 re-speak lane ignores all three
                    (documented in the wire contract), so hide them rather
                    than render dead controls. */}
                {(v.engine ?? "sts") === "sts" && (<>
                <div>
                  <Label htmlFor={`similarity-${i}`}>{t("audiocfg.similarity")} ({v.similarityBoost ?? 0.75})</Label>
                  <Input id={`similarity-${i}`} type="range" min={0} max={1} step={0.05} value={v.similarityBoost ?? 0.75} onChange={(e) => updateVoice(i, { similarityBoost: parseFloat(e.target.value) })} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.low")}</span><span>{t("audiocfg.high")}</span></div>
                </div>
                <div>
                  <Label htmlFor={`style-${i}`}>{t("audiocfg.styleExaggeration")} ({v.style ?? 0})</Label>
                  <Input id={`style-${i}`} type="range" min={0} max={1} step={0.05} value={v.style ?? 0} onChange={(e) => updateVoice(i, { style: parseFloat(e.target.value) })} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.none")}</span><span>{t("audiocfg.exaggerated")}</span></div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`speaker-boost-${i}`}>{t("field.speakerBoost")}</Label>
                    <Switch id={`speaker-boost-${i}`} checked={v.useSpeakerBoost ?? true} onCheckedChange={(c) => updateVoice(i, { useSpeakerBoost: c })} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Boosts the recast&apos;s fidelity to the target voice (slightly higher latency).
                  </p>
                </div>
                </>)}
                <div>
                  <Label htmlFor={`volume-mode-${i}`}>{t("field.volume")}</Label>
                  <Select
                    value={v.volumeMode ?? "match"}
                    onValueChange={(mode) => updateVoice(i, { volumeMode: mode as NonNullable<VoiceChangerProData["orderedVoices"][number]>["volumeMode"] })}
                  >
                    <SelectTrigger id={`volume-mode-${i}`} aria-label={`Volume mode for speaker ${i + 1}`} className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="match">{t("audiocfg.matchSource")}</SelectItem>
                      <SelectItem value="normalize">{t("audiocfg.normalize")}</SelectItem>
                      <SelectItem value="manual">{t("audiocfg.manual")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {(v.volumeMode ?? "match") === "manual" && (
                    <div className="mt-2">
                      <Label htmlFor={`volume-${i}`}>{t("field.volume")} ({v.volume ?? 100}%)</Label>
                      <Input id={`volume-${i}`} type="range" min={0} max={200} step={5} value={v.volume ?? 100} onChange={(e) => updateVoice(i, { volume: parseFloat(e.target.value) })} className="h-2" />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0%</span><span>200%</span></div>
                    </div>
                  )}
                </div>
                <div>
                  <Label htmlFor={`seed-${i}`}>{t("field.seed")}</Label>
                  <Input
                    id={`seed-${i}`}
                    type="number"
                    min={0}
                    max={4294967295}
                    step={1}
                    inputMode="numeric"
                    placeholder={t("audiocfg.phRandomLower")}
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
                  <p className="text-[10px] text-muted-foreground mt-0.5">{t("audiocfg.hintBlankRandomSeed")}</p>
                </div>
              </div>
            </details>
            )}
          </div>
        ))}
      </div>
      <div>
        <Label>{t("field.model")}</Label>
        <Select
          value={data.model ?? DEFAULT_VOICE_CHANGER_MODEL}
          onValueChange={(v) => onUpdate({ model: v as VoiceChangerProData["model"] })}
        >
          <SelectTrigger aria-label={t("field.model")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {VOICE_CHANGER_MODELS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("audiocfg.separationQuality")}</Label>
        <Select
          value={data.separationQuality ?? "fast"}
          onValueChange={(v) => onUpdate({ separationQuality: v as NonNullable<VoiceChangerProData["separationQuality"]> })}
        >
          <SelectTrigger aria-label={t("audiocfg.separationQuality")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="fast">{t("audiocfg.qualityFast")}</SelectItem>
            <SelectItem value="best">{t("audiocfg.qualityBest")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between">
        <Label>{t("audiocfg.preserveBackgroundMusic")}</Label>
        <Switch checked={data.preserveBackground ?? true} onCheckedChange={(v) => onUpdate({ preserveBackground: v })} />
      </div>
      {data.preserveBackground !== false && (
        <div>
          <Label htmlFor="music-volume-mode">{t("audiocfg.musicVolume")}</Label>
          <Select
            value={data.musicVolumeMode ?? "match"}
            onValueChange={(mode) => onUpdate({ musicVolumeMode: mode as NonNullable<VoiceChangerProData["musicVolumeMode"]> })}
          >
            <SelectTrigger id="music-volume-mode" aria-label={t("audiocfg.musicVolumeMode")} className="h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="match">{t("audiocfg.matchSource")}</SelectItem>
              <SelectItem value="normalize">{t("audiocfg.normalize")}</SelectItem>
              <SelectItem value="manual">{t("audiocfg.manual")}</SelectItem>
            </SelectContent>
          </Select>
          {(data.musicVolumeMode ?? "match") === "manual" && (
            <div className="mt-2">
              <Label htmlFor="music-volume">{t("audiocfg.musicLevel")} ({data.musicVolume ?? 100}%)</Label>
              <Input id="music-volume" type="range" min={0} max={200} step={5} value={data.musicVolume ?? 100} onChange={(e) => onUpdate({ musicVolume: parseFloat(e.target.value) })} className="h-2" />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0%</span><span>200%</span></div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {t("audiocfg.hintPreservedMusicLevel")}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded border p-2">
        <Label htmlFor="voice-fx-preset">{t("audiocfg.voiceFx")}</Label>
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
          <SelectTrigger id="voice-fx-preset" aria-label={t("audiocfg.voiceFx")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={VOICE_FX_NONE}>{t("audiocfg.none")}</SelectItem>
            {AUDIO_FX_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>{AUDIO_FX_PRESET_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data.voiceFx && AUDIO_FX_REVERB_PRESETS.has(data.voiceFx.preset) && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="voice-fx-mix">{t("audiocfg.wetDryMix")}: {data.voiceFx.wetDryMix ?? "auto"}</Label>
            <Slider id="voice-fx-mix" min={0} max={100} step={1} value={[data.voiceFx.wetDryMix ?? 30]} onValueChange={(vals) => onUpdate({ voiceFx: { ...data.voiceFx!, wetDryMix: vals[0] } })} />
          </div>
        )}
        {data.voiceFx && (data.voiceFx.preset === "echo" || data.voiceFx.preset === "custom") && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="voice-fx-delay">{t("audiocfg.delayMs")}: {data.voiceFx.delayMs ?? 250}</Label>
              <Slider id="voice-fx-delay" min={20} max={2000} step={10} value={[data.voiceFx.delayMs ?? 250]} onValueChange={(vals) => onUpdate({ voiceFx: { ...data.voiceFx!, delayMs: vals[0] } })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="voice-fx-decay">{t("audiocfg.decay")}: {data.voiceFx.decay ?? 0.4}</Label>
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
          <Label>{t("audiocfg.removeBackgroundNoiseLower")}</Label>
          <Switch checked={data.removeBackgroundNoise ?? false} onCheckedChange={(v) => onUpdate({ removeBackgroundNoise: v })} />
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Under evaluation — vocals are isolated automatically; this may be unnecessary.
        </p>
      </div>
    </div>
  )
}
