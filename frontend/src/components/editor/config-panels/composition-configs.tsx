"use client"

import { useState, useMemo, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Sparkles, Trash2, Info } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TagTextarea } from "./tag-textarea"
import { SnippetMenuButton } from "./snippet-menu-button"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
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
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"
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
  const { sensors, orderedIds, orderedSources, handleDragEnd } = useMediaOrder(sources, data.assetOrder, onUpdate)

  return (
    <div className="flex flex-col gap-3">
      <MediaOrderList sensors={sensors} orderedIds={orderedIds} orderedSources={orderedSources} onDragEnd={handleDragEnd} />

      <LlmModelSelect
        feature="scene-graph-ai"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />

      <MappableField field="compositionPrompt" label="Composition Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          placeholder="Describe the style of video you want: cinematic product showcase with slow fades, energetic social reel with zoom cuts..."
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
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="after-effects"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />

      <MappableField field="effectPrompt" label="Effect Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          placeholder="Describe the look: cinematic film grain with warm color grading, vignette, letterbox..."
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
            <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading player...</div>}>
              <LazyAfterEffectsPlayerPreview
                effectPlan={data.effectPlan}
                fps={data.fps}
              />
            </Suspense>
          )}
          <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading preview...</div>}>
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
          <AccordionTrigger className="text-xs py-2">Settings</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="ae-fps" className="mb-1.5 block text-xs">FPS</Label>
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
                  <Label htmlFor="ae-duration" className="mb-1.5 block text-xs">Duration (s)</Label>
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
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="lottie-overlay"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />

      <MappableField field="overlayPrompt" label="Overlay Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          placeholder="Describe overlays: add confetti at 3 seconds, floating particles throughout..."
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
          <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading preview...</div>}>
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
          <AccordionTrigger className="text-xs py-2">Settings</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="lo-fps" className="mb-1.5 block text-xs">FPS</Label>
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
                  <Label htmlFor="lo-duration" className="mb-1.5 block text-xs">Duration (s)</Label>
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

export function ThreeDTitleConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<ThreeDTitleData>) {
  const promptSnippets = useSnippetPool("text", "prompt")
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="3d-title"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />

      <MappableField field="titlePrompt" label="Title Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <SnippetMenuButton pool={promptSnippets} value={data.titlePrompt || ""} onInsert={(v) => onUpdate({ titlePrompt: v })} target="prompt" media="text" />
      }>
        <TagTextarea
          placeholder="Describe the 3D title: epic gold ADVENTURE text with particles, cinematic camera..."
          value={data.titlePrompt ?? ""}
          onChange={(v) => onUpdate({ titlePrompt: v })}
          rows={3}
          className="text-sm"
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
          snippets={promptSnippets}
        />
      </MappableField>

      {data.titlePlan && (
        <>
          <Separator />
          <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading preview...</div>}>
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
          <AccordionTrigger className="text-xs py-2">Settings</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="3d-fps" className="mb-1.5 block text-xs">FPS</Label>
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
                  <Label htmlFor="3d-duration" className="mb-1.5 block text-xs">Duration (s)</Label>
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
                <Label className="mb-1.5 block text-xs">Aspect Ratio</Label>
                <AspectRatioSelector
                  options={COMPOSITION_RATIOS}
                  value={data.aspectRatio}
                  onValueChange={(v) => onUpdate({ aspectRatio: v as ThreeDTitleData["aspectRatio"] })}
                />
              </div>
              <div>
                <Label htmlFor="3d-bgcolor" className="mb-1.5 block text-xs">Background Color</Label>
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

export function MotionGraphicsConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<MotionGraphicsData>) {
  const [showInfo, setShowInfo] = useState(false)
  const promptSnippets = useSnippetPool("video", "prompt")

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="mg-engine" className="mb-1.5 block text-xs">Engine</Label>
        <Select value={data.engine ?? "elements"} onValueChange={(v) => onUpdate({ engine: v as MotionGraphicsData["engine"] })}>
          <SelectTrigger id="mg-engine" className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="elements">Classic (elements)</SelectItem>
            <SelectItem value="lottie">Lottie (AI-authored)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <LlmModelSelect
        feature={motionGraphicsFeature(data.engine)}
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />

      <MappableField field="motionPrompt" label="Motion Graphics Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <SnippetMenuButton pool={promptSnippets} value={data.motionPrompt || ""} onInsert={(v) => onUpdate({ motionPrompt: v })} target="prompt" media="video" />
      }>
        <div className="flex items-center justify-end mb-1.5">
          <button
            type="button"
            onClick={() => setShowInfo(!showInfo)}
            className={`p-1 rounded-md transition-colors ${showInfo ? "bg-[#ff0073]/10 text-[#ff0073]" : "text-muted-foreground hover:text-[var(--text-primary)] hover:bg-muted/50"}`}
            title="Prompt guide"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>

        {showInfo && (
          <div className="mb-2 p-3 rounded-md bg-muted/30 border border-[var(--border-primary)] text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-[var(--text-primary)]">What can you create?</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><span className="text-[var(--text-primary)]">Lower thirds</span> — name + title bars for interviews, news</li>
              <li><span className="text-[var(--text-primary)]">Title cards</span> — centered text with decorative shapes</li>
              <li><span className="text-[var(--text-primary)]">Intros / Outros</span> — animated text sequences with staggered timing</li>
              <li><span className="text-[var(--text-primary)]">Kinetic typography</span> — multiple texts animating in sequence</li>
              <li><span className="text-[var(--text-primary)]">Animated shapes</span> — geometric patterns, lines, SVG paths</li>
            </ul>
            <Separator className="my-1.5" />
            <p className="font-medium text-[var(--text-primary)]">Prompt tips</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Include names/text in quotes: <span className="font-mono text-[10px]">"John Smith - CEO"</span></li>
              <li>Mention style: modern, minimal, neon, corporate, elegant</li>
              <li>Specify colors if you want: <span className="font-mono text-[10px]">pink accent, white text</span></li>
              <li>Mention animation feel: snappy, smooth, cinematic</li>
            </ul>
            <Separator className="my-1.5" />
            <p className="font-medium text-[var(--text-primary)]">Settings</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><span className="text-[var(--text-primary)]">Background</span> — transparent (#00000000) for overlays, solid for standalone</li>
              <li><span className="text-[var(--text-primary)]">Duration</span> — 3-5s for lower thirds, 5-10s for title cards</li>
              <li>Wire to <span className="text-[var(--text-primary)]">Render Video</span> to produce the final video file</li>
            </ul>
          </div>
        )}
        <TagTextarea
          placeholder="Describe the motion graphic: modern lower third with name, title card, animated shapes..."
          value={data.motionPrompt ?? ""}
          onChange={(v) => onUpdate({ motionPrompt: v })}
          rows={3}
          className="text-sm"
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
          snippets={promptSnippets}
        />
      </MappableField>

      {data.motionPlan && (
        <>
          <Separator />
          {data.motionPlan.planType === "lottie-graphic" ? (
            <>
              <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading player...</div>}>
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
              <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading player...</div>}>
                <LazyMotionGraphicsPlayerPreview
                  motionPlan={data.motionPlan}
                  fps={data.fps}
                />
              </Suspense>
              <Suspense fallback={<div className="text-xs text-muted-foreground py-2">Loading preview...</div>}>
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
          <AccordionTrigger className="text-xs py-2">Settings</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="mg-fps" className="mb-1.5 block text-xs">FPS</Label>
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
                  <Label htmlFor="mg-duration" className="mb-1.5 block text-xs">Duration (s)</Label>
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
                <Label className="mb-1.5 block text-xs">Aspect Ratio</Label>
                <AspectRatioSelector
                  options={COMPOSITION_RATIOS}
                  value={data.aspectRatio}
                  onValueChange={(v) => onUpdate({ aspectRatio: v as MotionGraphicsData["aspectRatio"] })}
                />
              </div>
              <div>
                <Label htmlFor="mg-bgcolor" className="mb-1.5 block text-xs">Background Color</Label>
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
          Connect rendered videos to input handles, then configure layers below. 0 credits — plan is built client-side.
        </p>
      </div>

      <CompositePreview layers={data.layers} aspectRatio={data.aspectRatio} />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Layers ({data.layers.length})</Label>
          {availableHandles.length > 0 && (
            <button
              type="button"
              onClick={() => addLayer(availableHandles[0])}
              className="text-[10px] text-[#ff0073] hover:underline"
            >
              + Add Layer
            </button>
          )}
        </div>

        {data.layers.length === 0 && (
          <div className="text-xs text-muted-foreground/60 py-2 text-center">
            No layers. Add a layer for each connected video input.
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
                <Label className="mb-1 block text-[10px]">Position</Label>
                <Select value={layer.position} onValueChange={(v) => updateLayer(layer.id, { position: v as "fullscreen" | "positioned" })}>
                  <SelectTrigger aria-label="Position" className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fullscreen">Fullscreen</SelectItem>
                    <SelectItem value="positioned">Positioned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-[10px]">Blend Mode</Label>
                <Select value={layer.blendMode} onValueChange={(v) => updateLayer(layer.id, { blendMode: v as CompositeLayerConfig["blendMode"] })}>
                  <SelectTrigger aria-label="Blend Mode" className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="multiply">Multiply</SelectItem>
                    <SelectItem value="screen">Screen</SelectItem>
                    <SelectItem value="overlay">Overlay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-1 block text-[10px]">Opacity: {Math.round(layer.opacity * 100)}%</Label>
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
                <Label className="mb-1 block text-[10px]">Z-Index</Label>
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
                <Label className="mb-1 block text-[10px]">Start Frame</Label>
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
                  <Label className="mb-1 block text-[10px]">X (%)</Label>
                  <Input type="number" min={0} max={100} value={layer.x ?? ""} onChange={(e) => updateLayer(layer.id, { x: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
                <div>
                  <Label className="mb-1 block text-[10px]">Y (%)</Label>
                  <Input type="number" min={0} max={100} value={layer.y ?? ""} onChange={(e) => updateLayer(layer.id, { y: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
                <div>
                  <Label className="mb-1 block text-[10px]">Width (%)</Label>
                  <Input type="number" min={1} max={100} value={layer.width ?? ""} onChange={(e) => updateLayer(layer.id, { width: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
                <div>
                  <Label className="mb-1 block text-[10px]">Height (%)</Label>
                  <Input type="number" min={1} max={100} value={layer.height ?? ""} onChange={(e) => updateLayer(layer.id, { height: e.target.value === "" ? undefined : parseFloat(e.target.value) })} className="h-7 text-[11px]" />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">Settings</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="comp-fps" className="mb-1.5 block text-xs">FPS</Label>
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
                  <Label htmlFor="comp-duration" className="mb-1.5 block text-xs">Duration (s)</Label>
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
                <Label className="mb-1.5 block text-xs">Aspect Ratio</Label>
                <AspectRatioSelector
                  options={COMPOSITION_RATIOS}
                  value={data.aspectRatio}
                  onValueChange={(v) => onUpdate({ aspectRatio: v as CompositeData["aspectRatio"] })}
                />
              </div>
              <div>
                <Label htmlFor="comp-bg" className="mb-1.5 block text-xs">Background Color</Label>
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
            <span className="text-[var(--text-primary)]">Composition from </span>
            <span className="font-medium text-[#ff0073]">{upstreamComposer.label}</span>
            {upstreamComposer.trackCount > 0 && (
              <span className="ml-1 text-muted-foreground">({upstreamComposer.trackCount} tracks)</span>
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
