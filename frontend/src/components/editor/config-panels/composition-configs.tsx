"use client"

import { useState, useMemo, Suspense } from "react"
import { AdvancedModeToggle } from "./advanced-mode-toggle"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Sparkles, Trash2, Info } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TagTextarea } from "./tag-textarea"
import { SnippetMenuButton } from "./snippet-menu-button"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { PromptFieldFinalView, PromptFieldModeToggle } from "./prompt-field-final-view"
import { useFinalPromptSegments } from "./use-final-prompt-segments"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
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
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CompositePreview } from "../composite-preview"
import type {
  VideoComposerData,
  AfterEffectsData,
  LottieOverlayData,
  ThreeDTitleData,
  MotionGraphicsData,
  CompositeData,
  CompositeLayerConfig,
  RenderVideoData,
} from "@/types/nodes"
import { LlmModelSelect } from "./llm-model-select"
import { ReasoningEffortSelect } from "./reasoning-effort-select"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { motionGraphicsFeature } from "@nodaro/shared"
import {
  useMediaOrder,
  MediaOrderList,
  VideoSettingsAccordion,
  SceneGraphPreviewInline,
} from "./composition-shared"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { COMPOSITION_RATIOS } from "./model-options"
import { LottieSlotControls } from "./lottie-slot-controls"

export function VideoComposerConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<VideoComposerData>) {
  const t = useT()
  const { sensors, orderedIds, orderedSources, handleDragEnd } = useMediaOrder(sources, data.assetOrder, onUpdate)

  return (
    <div className="flex flex-col gap-3">
      <MediaOrderList sensors={sensors} orderedIds={orderedIds} orderedSources={orderedSources} onDragEnd={handleDragEnd} />

      <LlmModelSelect
        feature="scene-graph-ai"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="scene-graph-ai"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="scene-graph-ai"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />

      <MappableField field="compositionPrompt" label={t("cfgext.compCompositionPrompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          placeholder={t("cfgext.compPhCompositionPrompt")}
          value={data.compositionPrompt ?? ""}
          onChange={(v) => onUpdate({ compositionPrompt: v })}
          rows={3}
          className="text-sm"
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>

      {data.sceneGraph && (
        <>
          <Separator />
          <SceneGraphPreviewInline
            sceneGraph={data.sceneGraph}
            fps={data.fps}
            onUpdate={(sg) => onUpdate({ sceneGraph: sg })}
          />
        </>
      )}

      <VideoSettingsAccordion
        aspectRatio={data.aspectRatio}
        fps={data.fps}
        durationSeconds={data.durationSeconds}
        backgroundColor={data.backgroundColor}
        onUpdate={onUpdate}
        idPrefix="composer"
      />
    </div>
  )
}

const LazyAfterEffectsPreview = lazy(() => import("@/components/editor/after-effects-preview").then(m => ({ default: m.AfterEffectsPreview })))
const LazyAfterEffectsPlayerPreview = lazy(() => import("@/components/editor/after-effects-player-preview").then(m => ({ default: m.AfterEffectsPlayerPreview })))

export function AfterEffectsConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<AfterEffectsData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="after-effects"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="after-effects"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="after-effects"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />

      <MappableField field="effectPrompt" label={t("cfgext.compEffectPrompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          placeholder={t("cfgext.compPhEffectPrompt")}
          value={data.effectPrompt ?? ""}
          onChange={(v) => onUpdate({ effectPrompt: v })}
          rows={3}
          className="text-sm"
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>

      {data.effectPlan && (
        <>
          <Separator />
          {(data.effectPlan as Record<string, unknown>).sourceVideo && (
            <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("cfgext.compLoadingPlayer")}</div>}>
              <LazyAfterEffectsPlayerPreview
                effectPlan={data.effectPlan}
                fps={data.fps}
              />
            </Suspense>
          )}
          <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("proccfg.loadingPreview")}</div>}>
            <LazyAfterEffectsPreview
              effectPlan={data.effectPlan}
              fps={data.fps}
              onUpdate={(ep) => onUpdate({ effectPlan: ep })}
            />
          </Suspense>
        </>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">{t("settings.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="ae-fps" className="mb-1.5 block text-xs">{t("field.fps")}</Label>
                  <Select value={String(data.fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
                    <SelectTrigger id="ae-fps" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="ae-duration" className="mb-1.5 block text-xs">{t("scriptcfg.durationS")}</Label>
                  <Input
                    id="ae-duration"
                    type="number"
                    min={1}
                    max={300}
                    value={data.durationSeconds ?? ""}
                    onChange={(e) => onUpdate({ durationSeconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

const LazyLottieOverlayPreview = lazy(() => import("@/components/editor/lottie-overlay-preview").then(m => ({ default: m.LottieOverlayPreview })))

export function LottieOverlayConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<LottieOverlayData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="lottie-overlay"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="lottie-overlay"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="lottie-overlay"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />

      <MappableField field="overlayPrompt" label={t("cfgext.compOverlayPrompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          placeholder={t("cfgext.compPhOverlayPrompt")}
          value={data.overlayPrompt ?? ""}
          onChange={(v) => onUpdate({ overlayPrompt: v })}
          rows={3}
          className="text-sm"
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>

      {data.overlayPlan && (
        <>
          <Separator />
          <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("proccfg.loadingPreview")}</div>}>
            <LazyLottieOverlayPreview
              overlayPlan={data.overlayPlan}
              fps={data.fps}
              onUpdate={(op) => onUpdate({ overlayPlan: op })}
            />
          </Suspense>
        </>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">{t("settings.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lo-fps" className="mb-1.5 block text-xs">{t("field.fps")}</Label>
                  <Select value={String(data.fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
                    <SelectTrigger id="lo-fps" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="lo-duration" className="mb-1.5 block text-xs">{t("scriptcfg.durationS")}</Label>
                  <Input
                    id="lo-duration"
                    type="number"
                    min={1}
                    max={300}
                    value={data.durationSeconds ?? ""}
                    onChange={(e) => onUpdate({ durationSeconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

const LazyThreeDTitlePreview = lazy(() => import("@/components/editor/three-d-title-preview").then(m => ({ default: m.ThreeDTitlePreview })))

export function ThreeDTitleConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode, nodes, edges, nodeId }: ConfigProps<ThreeDTitleData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("text", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "titlePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.titlePrompt,
    promptField: "titlePrompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="3d-title"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature="3d-title"
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature="3d-title"
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />

      <MappableField field="titlePrompt" label={t("cfgext.compTitlePrompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.titlePrompt || ""} onInsert={(v) => onUpdate({ titlePrompt: v })} target="prompt" media="text" />
        </span>
      }>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("imgcfg.promptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea
            placeholder={t("cfgext.compPh3dTitlePrompt")}
            value={data.titlePrompt ?? ""}
            onChange={(v) => onUpdate({ titlePrompt: v })}
            rows={3}
            className="text-sm"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>

      {data.titlePlan && (
        <>
          <Separator />
          <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("proccfg.loadingPreview")}</div>}>
            <LazyThreeDTitlePreview
              titlePlan={data.titlePlan}
              fps={data.fps}
              onUpdate={(tp) => onUpdate({ titlePlan: tp })}
            />
          </Suspense>
        </>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">{t("settings.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="3d-fps" className="mb-1.5 block text-xs">{t("field.fps")}</Label>
                  <Select value={String(data.fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
                    <SelectTrigger id="3d-fps" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="3d-duration" className="mb-1.5 block text-xs">{t("scriptcfg.durationS")}</Label>
                  <Input
                    id="3d-duration"
                    type="number"
                    min={1}
                    max={60}
                    value={data.durationSeconds ?? ""}
                    onChange={(e) => onUpdate({ durationSeconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">{t("field.aspectRatio")}</Label>
                <AspectRatioSelector
                  options={COMPOSITION_RATIOS}
                  value={data.aspectRatio}
                  onValueChange={(v) => onUpdate({ aspectRatio: v as ThreeDTitleData["aspectRatio"] })}
                />
              </div>
              <div>
                <Label htmlFor="3d-bgcolor" className="mb-1.5 block text-xs">{t("proccfg.backgroundColor")}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    id="3d-bgcolor"
                    value={data.backgroundColor ?? "#000000"}
                    onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                    className="h-8 w-8 rounded border border-[var(--border-primary)] cursor-pointer"
                  />
                  <Input
                    value={data.backgroundColor ?? "#000000"}
                    onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

const LazyMotionGraphicsPreview = lazy(() => import("@/components/editor/motion-graphics-preview").then(m => ({ default: m.MotionGraphicsPreview })))
const LazyMotionGraphicsPlayerPreview = lazy(() => import("@/components/editor/motion-graphics-player-preview").then(m => ({ default: m.MotionGraphicsPlayerPreview })))
const LazyLottieGraphicPlayerPreview = lazy(() => import("@/components/editor/lottie-graphic-player-preview").then(m => ({ default: m.LottieGraphicPlayerPreview })))

export function MotionGraphicsConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode, nodes, edges, nodeId }: ConfigProps<MotionGraphicsData> & { nodeId?: string }) {
  const t = useT()
  // The guide names a node the user has to wire up — same localized name the
  // canvas and the connect dialog show, not the raw English default.
  const localizeNode = useLocalizeNodeLabel()
  const [showInfo, setShowInfo] = useState(false)
  const promptSnippets = useSnippetPool("video", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "motionPrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.motionPrompt,
    promptField: "motionPrompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="mg-engine" className="mb-1.5 block text-xs">{t("cfgext.compEngine")}</Label>
        <Select value={data.engine ?? "elements"} onValueChange={(v) => onUpdate({ engine: v as MotionGraphicsData["engine"] })}>
          <SelectTrigger id="mg-engine" aria-label={t("cfgext.compEngine")} className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="elements">{t("cfgext.compEngineClassic")}</SelectItem>
            <SelectItem value="lottie">{t("cfgext.compEngineLottie")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <LlmModelSelect
        feature={motionGraphicsFeature(data.engine)}
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature={motionGraphicsFeature(data.engine)}
        modelId={data.llmModel}
        advanced={data.advancedMode}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
      <AdvancedModeToggle
        feature={motionGraphicsFeature(data.engine)}
        modelId={data.llmModel}
        value={data.advancedMode}
        temperature={data.temperature}
        maxTokens={data.maxTokens}
        onChange={onUpdate}
      />

      <MappableField field="motionPrompt" label={t("cfgext.compMotionGraphicsPrompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.motionPrompt || ""} onInsert={(v) => onUpdate({ motionPrompt: v })} target="prompt" media="video" />
        </span>
      }>
        <div className="flex items-center justify-end mb-1.5">
          <button
            type="button"
            onClick={() => setShowInfo(!showInfo)}
            className={`p-1 rounded-md transition-colors ${showInfo ? "bg-[#ff0073]/10 text-[#ff0073]" : "text-muted-foreground hover:text-[var(--text-primary)] hover:bg-muted/50"}`}
            title={t("cfgext.compPromptGuide")}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>

        {showInfo && (
          <div className="mb-2 p-3 rounded-md bg-muted/30 border border-[var(--border-primary)] text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-[var(--text-primary)]">{t("cfgext.compGuideWhatCanYouCreate")}</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><span className="text-[var(--text-primary)]">{t("cfgext.compGuideLowerThirds")}</span>{" — "}{t("cfgext.compGuideLowerThirdsDesc")}</li>
              <li><span className="text-[var(--text-primary)]">{t("cfgext.compGuideTitleCards")}</span>{" — "}{t("cfgext.compGuideTitleCardsDesc")}</li>
              <li><span className="text-[var(--text-primary)]">{t("cfgext.compGuideIntrosOutros")}</span>{" — "}{t("cfgext.compGuideIntrosOutrosDesc")}</li>
              <li><span className="text-[var(--text-primary)]">{t("cfgext.compGuideKineticTypography")}</span>{" — "}{t("cfgext.compGuideKineticTypographyDesc")}</li>
              <li><span className="text-[var(--text-primary)]">{t("cfgext.compGuideAnimatedShapes")}</span>{" — "}{t("cfgext.compGuideAnimatedShapesDesc")}</li>
            </ul>
            <Separator className="my-1.5" />
            <p className="font-medium text-[var(--text-primary)]">{t("cfgext.compGuidePromptTips")}</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>{t("cfgext.compTipQuotes")}{" "}<span className="font-mono text-[10px]">{t("cfgext.compTipQuotesExample")}</span></li>
              <li>{t("cfgext.compTipStyle")}</li>
              <li>{t("cfgext.compTipColors")}{" "}<span className="font-mono text-[10px]">{t("cfgext.compTipColorsExample")}</span></li>
              <li>{t("cfgext.compTipAnimationFeel")}</li>
            </ul>
            <Separator className="my-1.5" />
            <p className="font-medium text-[var(--text-primary)]">{t("settings.title")}</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><span className="text-[var(--text-primary)]">{t("audiocfg.mergeRoleBackground")}</span>{" — "}{t("cfgext.compGuideBackgroundDesc")}</li>
              <li><span className="text-[var(--text-primary)]">{t("field.duration")}</span>{" — "}{t("cfgext.compGuideDurationDesc")}</li>
              {/* The node NAME goes through the label table, so the sentence
                  reads in one language; the inline highlight is dropped
                  because the name's position moves between languages. */}
              <li>{t("cfgext.compGuideWireToRender", { node: localizeNode("Render Video") })}</li>
            </ul>
          </div>
        )}
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("imgcfg.promptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea
            placeholder={t("cfgext.compPhMotionGraphicsPrompt")}
            value={data.motionPrompt ?? ""}
            onChange={(v) => onUpdate({ motionPrompt: v })}
            rows={3}
            className="text-sm"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>

      {data.motionPlan && (
        <>
          <Separator />
          {data.motionPlan.planType === "lottie-graphic" ? (
            <>
              <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("cfgext.compLoadingPlayer")}</div>}>
                <LazyLottieGraphicPlayerPreview
                  motionPlan={data.motionPlan}
                  fps={data.fps}
                />
              </Suspense>
              {Object.keys((data.motionPlan.slots as Record<string, unknown>) ?? {}).length > 0 && (
                <LottieSlotControls plan={data.motionPlan} onUpdate={onUpdate} />
              )}
            </>
          ) : (
            <>
              <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("cfgext.compLoadingPlayer")}</div>}>
                <LazyMotionGraphicsPlayerPreview
                  motionPlan={data.motionPlan}
                  fps={data.fps}
                />
              </Suspense>
              <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("proccfg.loadingPreview")}</div>}>
                <LazyMotionGraphicsPreview
                  motionPlan={data.motionPlan}
                  fps={data.fps}
                  onUpdate={(mp) => onUpdate({ motionPlan: mp })}
                />
              </Suspense>
            </>
          )}
        </>
      )}

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">{t("settings.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="mg-fps" className="mb-1.5 block text-xs">{t("field.fps")}</Label>
                  <Select value={String(data.fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
                    <SelectTrigger id="mg-fps" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="mg-duration" className="mb-1.5 block text-xs">{t("scriptcfg.durationS")}</Label>
                  <Input
                    id="mg-duration"
                    type="number"
                    min={1}
                    max={60}
                    value={data.durationSeconds ?? ""}
                    onChange={(e) => onUpdate({ durationSeconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">{t("field.aspectRatio")}</Label>
                <AspectRatioSelector
                  options={COMPOSITION_RATIOS}
                  value={data.aspectRatio}
                  onValueChange={(v) => onUpdate({ aspectRatio: v as MotionGraphicsData["aspectRatio"] })}
                />
              </div>
              <div>
                <Label htmlFor="mg-bgcolor" className="mb-1.5 block text-xs">{t("proccfg.backgroundColor")}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    id="mg-bgcolor"
                    value={(data.backgroundColor ?? "#00000000").slice(0, 7)}
                    onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                    className="h-8 w-8 rounded border border-[var(--border-primary)] cursor-pointer"
                  />
                  <Input
                    value={data.backgroundColor ?? "#00000000"}
                    onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

export function CompositeConfig({ data, onUpdate }: { data: CompositeData; onUpdate: (d: Partial<CompositeData>) => void }) {
  const t = useT()
  const HANDLES = ["video1", "video2", "video3", "video4"] as const

  function updateLayer(layerId: string, patch: Partial<CompositeLayerConfig>) {
    const updated = data.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l))
    onUpdate({ layers: updated })
  }

  function addLayer(handle: string) {
    const newLayer: CompositeLayerConfig = {
      id: `layer-${handle}-${Date.now()}`,
      inputHandle: handle,
      position: "fullscreen",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      startFrame: 0,
      opacity: 1,
      blendMode: "normal",
      zIndex: data.layers.length,
    }
    onUpdate({ layers: [...data.layers, newLayer] })
  }

  function removeLayer(layerId: string) {
    onUpdate({ layers: data.layers.filter((l) => l.id !== layerId) })
  }

  const usedHandles = new Set(data.layers.map((l) => l.inputHandle))
  const availableHandles = HANDLES.filter((h) => !usedHandles.has(h))

  return (
    <div className="flex flex-col gap-3">
      <div className="p-2.5 rounded-md bg-muted/30 border border-[var(--border-primary)]">
        <p className="text-xs text-muted-foreground">
          {t("cfgext.compCompositeIntro")}
        </p>
      </div>

      <CompositePreview layers={data.layers} aspectRatio={data.aspectRatio} />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">{t("cfgext.compLayersCount", { count: data.layers.length })}</Label>
          {availableHandles.length > 0 && (
            <button
              type="button"
              onClick={() => addLayer(availableHandles[0])}
              className="text-[10px] text-[#ff0073] hover:underline"
            >
              {t("cfgext.compAddLayer")}
            </button>
          )}
        </div>

        {data.layers.length === 0 && (
          <div className="text-xs text-muted-foreground/60 py-2 text-center">
            {t("cfgext.compNoLayers")}
          </div>
        )}

        {data.layers.map((layer) => (
          <div key={layer.id} className="p-2.5 rounded-md border border-[var(--border-primary)] bg-muted/10 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{layer.inputHandle}</span>
              <button type="button" onClick={() => removeLayer(layer.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-[10px]">{t("proccfg.position")}</Label>
                <Select value={layer.position} onValueChange={(v) => updateLayer(layer.id, { position: v as "fullscreen" | "positioned" })}>
                  <SelectTrigger aria-label={t("proccfg.position")} className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fullscreen">{t("cfgext.compPositionFullscreen")}</SelectItem>
                    <SelectItem value="positioned">{t("cfgext.compPositionPositioned")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-[10px]">{t("cfgext.compBlendMode")}</Label>
                <Select value={layer.blendMode} onValueChange={(v) => updateLayer(layer.id, { blendMode: v as CompositeLayerConfig["blendMode"] })}>
                  <SelectTrigger aria-label={t("cfgext.compBlendMode")} className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">{t("vidcfg.normal")}</SelectItem>
                    <SelectItem value="multiply">{t("cfgext.compBlendMultiply")}</SelectItem>
                    <SelectItem value="screen">{t("cfgext.compBlendScreen")}</SelectItem>
                    <SelectItem value="overlay">{t("cfgext.compBlendOverlay")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-1 block text-[10px]">{t("cfgext.compOpacityPercent", { value: Math.round(layer.opacity * 100) })}</Label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layer.opacity}
                onChange={(e) => updateLayer(layer.id, { opacity: parseFloat(e.target.value) })}
                className="w-full h-1.5 accent-[#ff0073]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="mb-1 block text-[10px]">{t("cfgext.compZIndex")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={layer.zIndex ?? ""}
                  onChange={(e) => updateLayer(layer.id, { zIndex: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                  className="h-7 text-[11px]"
                />
              </div>
              <div>
                <Label className="mb-1 block text-[10px]">{t("vidcfg.startFrame")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={layer.startFrame ?? ""}
                  onChange={(e) => updateLayer(layer.id, { startFrame: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                  className="h-7 text-[11px]"
                />
              </div>
            </div>

            {layer.position === "positioned" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="mb-1 block text-[10px]">{t("cfgext.compXPercent")}</Label>
                  <Input type="number" min={0} max={100} value={layer.x ?? ""} onChange={(e) => updateLayer(layer.id, { x: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
                <div>
                  <Label className="mb-1 block text-[10px]">{t("cfgext.compYPercent")}</Label>
                  <Input type="number" min={0} max={100} value={layer.y ?? ""} onChange={(e) => updateLayer(layer.id, { y: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
                <div>
                  <Label className="mb-1 block text-[10px]">{t("cfgext.compWidthPercent")}</Label>
                  <Input type="number" min={1} max={100} value={layer.width ?? ""} onChange={(e) => updateLayer(layer.id, { width: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
                <div>
                  <Label className="mb-1 block text-[10px]">{t("cfgext.compHeightPercent")}</Label>
                  <Input type="number" min={1} max={100} value={layer.height ?? ""} onChange={(e) => updateLayer(layer.id, { height: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">{t("settings.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="comp-fps" className="mb-1.5 block text-xs">{t("field.fps")}</Label>
                  <Select value={String(data.fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
                    <SelectTrigger id="comp-fps" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="comp-duration" className="mb-1.5 block text-xs">{t("scriptcfg.durationS")}</Label>
                  <Input
                    id="comp-duration"
                    type="number"
                    min={1}
                    max={120}
                    value={data.durationSeconds ?? ""}
                    onChange={(e) => onUpdate({ durationSeconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">{t("field.aspectRatio")}</Label>
                <AspectRatioSelector
                  options={COMPOSITION_RATIOS}
                  value={data.aspectRatio}
                  onValueChange={(v) => onUpdate({ aspectRatio: v as CompositeData["aspectRatio"] })}
                />
              </div>
              <div>
                <Label htmlFor="comp-bg" className="mb-1.5 block text-xs">{t("proccfg.backgroundColor")}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={data.backgroundColor}
                    onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                    className="w-8 h-8 rounded border border-[var(--border-primary)] cursor-pointer bg-transparent"
                  />
                  <Input
                    id="comp-bg"
                    value={data.backgroundColor}
                    onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
                    className="h-8 text-xs flex-1"
                  />
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

export function RenderVideoConfig({ data, onUpdate, sources }: ConfigProps<RenderVideoData>) {
  const t = useT()
  // Upstream nodes report their English default label unless renamed.
  const localizeNode = useLocalizeNodeLabel()
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const { sensors, orderedIds, orderedSources, handleDragEnd } = useMediaOrder(sources, data.assetOrder, onUpdate)

  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const upstreamComposer = useMemo(() => {
    if (!selectedNodeId) return undefined
    const inEdges = edges.filter((e) => e.target === selectedNodeId)
    for (const edge of inEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source)
      if (srcNode?.type === "video-composer") {
        const composerData = srcNode.data as VideoComposerData
        return { label: composerData.label, trackCount: ((composerData.sceneGraph as Record<string, unknown>)?.tracks as unknown[])?.length ?? 0 }
      }
      if (srcNode?.type === "after-effects") {
        const aeData = srcNode.data as AfterEffectsData
        const effectCount = ((aeData.effectPlan as Record<string, unknown>)?.effects as unknown[])?.length ?? 0
        return { label: aeData.label, trackCount: effectCount }
      }
      if (srcNode?.type === "lottie-overlay") {
        const loData = srcNode.data as LottieOverlayData
        const overlayCount = ((loData.overlayPlan as Record<string, unknown>)?.overlays as unknown[])?.length ?? 0
        return { label: loData.label, trackCount: overlayCount }
      }
      if (srcNode?.type === "3d-title") {
        const tdData = srcNode.data as ThreeDTitleData
        const objectCount = ((tdData.titlePlan as Record<string, unknown>)?.objects as unknown[])?.length ?? 0
        return { label: tdData.label, trackCount: objectCount }
      }
      if (srcNode?.type === "motion-graphics") {
        const mgData = srcNode.data as MotionGraphicsData
        const elementCount = ((mgData.motionPlan as Record<string, unknown>)?.elements as unknown[])?.length ?? 0
        return { label: mgData.label, trackCount: elementCount }
      }
    }
    return undefined
  }, [selectedNodeId, edges, nodes])

  return (
    <div className="flex flex-col gap-3">
      {upstreamComposer && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-[#ff0073]/5 border border-[#ff0073]/20">
          <Sparkles className="w-4 h-4 text-[#ff0073] shrink-0" />
          <div className="text-xs">
            <span className="text-[var(--text-primary)]">{t("cfgext.compCompositionFrom")}{" "}</span>
            <span className="font-medium text-[#ff0073]">{localizeNode(upstreamComposer.label)}</span>
            {upstreamComposer.trackCount > 0 && (
              <span className="ms-1 text-muted-foreground">{t("cfgext.compTracksCount", { count: upstreamComposer.trackCount })}</span>
            )}
          </div>
        </div>
      )}

      {!upstreamComposer && (
        <MediaOrderList sensors={sensors} orderedIds={orderedIds} orderedSources={orderedSources} onDragEnd={handleDragEnd} />
      )}

      <VideoSettingsAccordion
        aspectRatio={data.aspectRatio}
        fps={data.fps}
        durationSeconds={data.durationSeconds}
        backgroundColor={data.backgroundColor}
        onUpdate={onUpdate}
        idPrefix="render"
      />
    </div>
  )
}
