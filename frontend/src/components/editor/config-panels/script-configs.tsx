"use client"

import { useT, tx } from "@/lib/i18n"
import { useState, useRef, useEffect } from "react"
import { AdvancedModeToggle } from "./advanced-mode-toggle"
import { Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { TagTextarea } from "./tag-textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type {
  GenerateScriptData,
  GeneratedScript,
  ScriptScene,
  QACheckData,
  ImageToTextData,
  ImageCriticData,
  DescribeToPickerData,
} from "@/types/nodes"
import { IMAGE_CRITIC_MODES, STRUCTURED_VISION_MODELS, type ImageCriticMode } from "@nodaro/shared"
import { pickerFanoutTargets } from "@nodaro/prompts"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { pickerTypeLabel, ANALYZABLE_PICKER_HINT } from "@/lib/picker-labels"
import { LlmModelSelect } from "./llm-model-select"
import { ReasoningEffortSelect } from "./reasoning-effort-select"
import { MappableField } from "./mappable-field"
import { SnippetMenuButton } from "./snippet-menu-button"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { PromptFieldFinalView, PromptFieldModeToggle } from "./prompt-field-final-view"
import { useFinalPromptSegments } from "./use-final-prompt-segments"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
import type { ConfigProps } from "./types"

export function GenerateScriptConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode, nodes, edges, nodeId }: ConfigProps<GenerateScriptData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("text", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "styleGuide")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.styleGuide,
    promptField: "styleGuide",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })
  const [copied, setCopied] = useState(false)
  const script = data.generatedScript
  const results = data.generatedResults ?? []
  const activeIndex = data.activeResultIndex ?? 0

  function updateScene(sceneIndex: number, field: keyof ScriptScene, value: string | number) {
    if (!script) return
    const updatedScenes = script.scenes.map((s, i) =>
      i === sceneIndex ? { ...s, [field]: value } : s,
    )
    const updatedScript: GeneratedScript = { ...script, scenes: updatedScenes }
    const updatedResults = results.map((r, i) =>
      i === activeIndex ? { ...r, script: updatedScript } : r,
    )
    onUpdate({ generatedScript: updatedScript, generatedResults: updatedResults })
  }

  function handleCopyImagePrompts() {
    if (!script) return
    const text = script.scenes.map((s) => s.imagePrompt).join("\n\n")
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="generate-script"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="generate-script"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="generate-script"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />
      <MappableField field="sceneCount" label={t("scriptcfg.numberOfScenes")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={1}
          max={20}
          value={data.sceneCount ?? ""}
          onChange={(e) => onUpdate({ sceneCount: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </MappableField>
      <div>
        <Label>{t("scriptcfg.structure")}</Label>
        <Select
          value={data.structure}
          onValueChange={(v) => onUpdate({ structure: v as GenerateScriptData["structure"] })}
        >
          <SelectTrigger aria-label={t("scriptcfg.structure")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="freeform">{t("scriptcfg.structureFreeform")}</SelectItem>
            <SelectItem value="8-step">{t("scriptcfg.structure8Step")}</SelectItem>
            <SelectItem value="custom">{t("cfgshared.custom")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <MappableField field="styleGuide" label={t("scriptcfg.styleGuide")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.styleGuide || ""} onInsert={(v) => onUpdate({ styleGuide: v })} target="prompt" media="text" />
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
            value={data.styleGuide}
            onChange={(v) => onUpdate({ styleGuide: v })}
            placeholder={t("scriptcfg.phStyleGuide")}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>
      <MappableField field="tone" label={t("scriptcfg.tone")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder={t("scriptcfg.phTone")}
        />
      </MappableField>
      <MappableField field="targetLength" label={t("scriptcfg.targetLengthSeconds")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={10}
          max={600}
          value={data.targetLength ?? ""}
          onChange={(e) => onUpdate({ targetLength: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </MappableField>

      {script && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">{t("scriptcfg.generatedScript")}</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleCopyImagePrompts}
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? t("apiTok.copied") : t("scriptcfg.copyPrompts")}
              </Button>
            </div>

            <div>
              <Label className="text-xs">{t("scriptcfg.scriptTitle")}</Label>
              <Input
                value={script.title}
                onChange={(e) => {
                  const updatedScript = { ...script, title: e.target.value }
                  const updatedResults = results.map((r, i) =>
                    i === activeIndex ? { ...r, script: updatedScript } : r,
                  )
                  onUpdate({ generatedScript: updatedScript, generatedResults: updatedResults })
                }}
              />
            </div>

            <div className="text-xs text-muted-foreground">
              {t("scriptcfg.sceneCountSummary", { count: script.scenes.length, seconds: script.totalDuration })}
            </div>

            <Accordion type="single" collapsible className="w-full">
              {script.scenes.map((scene, i) => (
                <AccordionItem key={scene.sceneNumber} value={`scene-${i}`}>
                  <AccordionTrigger className="text-xs py-2 hover:no-underline">
                    <span className="text-start truncate pe-2">
                      {t("scriptcfg.sceneHeading", { n: scene.sceneNumber, action: scene.action.slice(0, 40) })}{scene.action.length > 40 ? "..." : ""}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-2 pt-1">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t("scriptcfg.visualDescription")}</Label>
                        <Textarea
                          rows={3}
                          className="text-xs"
                          value={scene.visualDescription}
                          onChange={(e) => updateScene(i, "visualDescription", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t("scriptcfg.sceneAction")}</Label>
                        <Textarea
                          rows={2}
                          className="text-xs"
                          value={scene.action}
                          onChange={(e) => updateScene(i, "action", e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">{t("scriptcfg.sceneMood")}</Label>
                          <Input
                            className="text-xs h-7"
                            value={Array.isArray(scene.mood) ? scene.mood.join(", ") : scene.mood}
                            onChange={(e) => updateScene(i, "mood", e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">{t("scriptcfg.durationS")}</Label>
                          <Input
                            type="number"
                            className="text-xs h-7"
                            min={1}
                            max={120}
                            value={scene.durationHint ?? ""}
                            onChange={(e) => updateScene(i, "durationHint", e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                          />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{t("scriptcfg.imagePromptForGenerate")}</Label>
                        <Textarea
                          rows={3}
                          className="text-xs"
                          value={scene.imagePrompt}
                          onChange={(e) => updateScene(i, "imagePrompt", e.target.value)}
                        />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </>
      )}
    </div>
  )
}

export function QACheckConfig({ data, onUpdate }: ConfigProps<QACheckData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="qa-check"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="qa-check"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="qa-check"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />
      <div>
        <Label>{t("scriptcfg.checkType")}</Label>
        <Select
          value={data.checkType}
          onValueChange={(v) => onUpdate({ checkType: v as QACheckData["checkType"] })}
        >
          <SelectTrigger aria-label={t("scriptcfg.checkType")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="content">{t("field.content")}</SelectItem>
            <SelectItem value="quality">{t("field.quality")}</SelectItem>
            <SelectItem value="consistency">{t("scriptcfg.qaConsistency")}</SelectItem>
            <SelectItem value="safety">{t("scriptcfg.qaSafety")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="threshold">{t("scriptcfg.threshold")}</Label>
        <Input
          id="threshold"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={data.threshold ?? ""}
          onChange={(e) => onUpdate({ threshold: e.target.value === "" ? undefined : parseFloat(e.target.value) })}
        />
      </div>
    </div>
  )
}

export function ImageCriticConfig({ data, onUpdate, nodes, edges, nodeRefs, refMap, variableDisplayMode, nodeId }: ConfigProps<ImageCriticData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("image", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "prompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.prompt,
    promptField: "prompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })
  const mode = data.mode ?? "realism"
  const usesPrompt = mode === "prompt-adherence" || mode === "all"

  const handleModeChange = (newMode: ImageCriticMode) => {
    // Stale-result guard: clear runtime fields when mode changes.
    onUpdate({
      mode: newMode,
      score: undefined,
      approved: undefined,
      feedback: undefined,
      details: undefined,
      currentJobId: undefined,
      executionStatus: "idle",
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{tx("field.mode")}</Label>
        <Select value={mode} onValueChange={(v) => handleModeChange(v as ImageCriticMode)}>
          <SelectTrigger aria-label={tx("field.mode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_CRITIC_MODES.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="image-critic-threshold">{t("scriptcfg.thresholdWithValue", { value: data.threshold ?? 0.7 })}</Label>
        <Input
          id="image-critic-threshold"
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={data.threshold ?? 0.7}
          onChange={(e) => {
            const t = e.target.value === "" ? undefined : parseFloat(e.target.value)
            const patch: Partial<ImageCriticData> = { threshold: t }
            if (typeof data.score === "number" && typeof t === "number") {
              patch.approved = data.score >= t
            }
            onUpdate(patch)
          }}
        />
      </div>

      {usesPrompt && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label>{tx("scriptcfg.promptOrWire")}</Label>
            <span className="inline-flex items-center gap-0.5">
              <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
              <SnippetMenuButton pool={promptSnippets} value={data.prompt || ""} onInsert={(v) => onUpdate({ prompt: v })} target="prompt" media="image" />
            </span>
          </div>
          {promptFieldMode.mode === "final" ? (
            <PromptFieldFinalView
              segments={finalPrompt.promptSegments}
              plainText={finalPrompt.promptText}
              placeholder={tx("audiocfg.phPromptPreviewEmpty")}
              minHeightRem={3 * 1.5}
            />
          ) : (
            <TagTextarea
              rows={3}
              value={data.prompt ?? ""}
              onChange={(v) => onUpdate({ prompt: v })}
              maxLength={8000}
              tagMode="none"
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
          )}
        </div>
      )}

      <LlmModelSelect
        feature="image-critic"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="image-critic"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="image-critic"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />
    </div>
  )
}

export function ImageToTextConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode, nodes, edges, nodeId }: ConfigProps<ImageToTextData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("text", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "customPrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.customPrompt,
    promptField: "customPrompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })
  const imageToTextData = data as ImageToTextData
  const results = imageToTextData.generatedResults ?? []
  const activeIndex = imageToTextData.activeResultIndex ?? 0
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current) } }, [])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("scriptcfg.detailLevel")}</Label>
        <Select
          value={imageToTextData.detailLevel ?? "detailed"}
          onValueChange={(v) => onUpdate({ detailLevel: v as ImageToTextData["detailLevel"] })}
        >
          <SelectTrigger aria-label={t("scriptcfg.detailLevel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="brief">{t("scriptcfg.detailBrief")}</SelectItem>
            <SelectItem value="detailed">{t("scriptcfg.detailDetailed")}</SelectItem>
            <SelectItem value="structured">{t("scriptcfg.detailStructured")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <LlmModelSelect
        feature="image-to-text"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="image-to-text"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="image-to-text"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />

      <div>
        <MappableField field="customPrompt" label={t("scriptcfg.customPromptOptional")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
          <span className="inline-flex items-center gap-0.5">
            <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
            <SnippetMenuButton pool={promptSnippets} value={imageToTextData.customPrompt || ""} onInsert={(v) => onUpdate({ customPrompt: v })} target="prompt" media="text" />
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
              value={imageToTextData.customPrompt ?? ""}
              onChange={(v) => onUpdate({ customPrompt: v })}
              placeholder={t("scriptcfg.phCustomPrompt")}
              rows={3}
              maxLength={2000}
              nodeRefs={nodeRefs}
              displayMode={variableDisplayMode}
              refMap={refMap}
              snippets={promptSnippets}
            />
          )}
        </MappableField>
        <p className="text-xs text-muted-foreground mt-1">
          {t("scriptcfg.customPromptHint")}
        </p>
      </div>

      {results.length > 1 && (
        <div>
          <Label>{t("scriptcfg.resultHistory")}</Label>
          <div className="flex gap-1 flex-wrap mt-1">
            {results.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`px-2 py-1 text-xs rounded ${
                  i === activeIndex
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                onClick={() =>
                  onUpdate({
                    activeResultIndex: i,
                    generatedText: results[i]?.text,
                  })
                }
              >
                #{i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {imageToTextData.generatedText && (
        <div>
          <div className="flex items-center justify-between">
            <Label>{t("nodecat.Output")}</Label>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-[10px] gap-1"
              onClick={() => {
                if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
                navigator.clipboard.writeText(imageToTextData.generatedText ?? "")
                setCopied(true)
                copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              {copied ? t("apiTok.copied") : t("apiTok.copy")}
            </Button>
          </div>
          <div className="mt-1 rounded-md bg-muted/30 p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto">
            {imageToTextData.generatedText}
          </div>
        </div>
      )}
    </div>
  )
}

export function DescribeToPickerConfig({ nodeId, data, onUpdate }: ConfigProps<DescribeToPickerData> & { nodeId?: string }) {
  const t = useT()
  const wiredPickers = useWorkflowStore(useShallow((s) => pickerFanoutTargets(nodeId ?? "", s.edges, s.nodes)))
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted-foreground">
        {wiredPickers.length > 0 ? (
          <>
            {t("scriptcfg.analyzingLabel")}{" "}
            <span className="text-foreground">{wiredPickers.map(pickerTypeLabel).join(" · ")}</span>
          </>
        ) : (
          t("scriptcfg.connectPickerHint", { types: ANALYZABLE_PICKER_HINT })
        )}
      </div>
      {/* Anthropic-only: the analyzer uses forced tool-use (Anthropic-direct only). */}
      <LlmModelSelect
        feature="describe-to-picker"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
        filter={(m) => STRUCTURED_VISION_MODELS.some((v) => v.id === m.id)}
      />
      <ReasoningEffortSelect
        feature="describe-to-picker"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="describe-to-picker"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />
      <div>
        <Label>{t("scriptcfg.extraGuidanceOptional")}</Label>
        <Textarea
          value={data.instructions ?? ""}
          onChange={(e) => onUpdate({ instructions: e.target.value })}
          placeholder={t("scriptcfg.phExtraGuidance")}
          rows={2}
          maxLength={2000}
          className="text-xs resize-none"
        />
      </div>
    </div>
  )
}
