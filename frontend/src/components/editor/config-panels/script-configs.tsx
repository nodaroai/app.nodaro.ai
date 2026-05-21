"use client"

import { useState, useRef, useEffect } from "react"
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
} from "@/types/nodes"
import { IMAGE_CRITIC_MODES, type ImageCriticMode } from "@nodaro/shared"
import { LlmModelSelect } from "./llm-model-select"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"

export function GenerateScriptConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<GenerateScriptData>) {
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
      <MappableField field="sceneCount" label="Number of Scenes" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          type="number"
          min={1}
          max={20}
          value={data.sceneCount ?? ""}
          onChange={(e) => onUpdate({ sceneCount: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
        />
      </MappableField>
      <div>
        <Label>Structure</Label>
        <Select
          value={data.structure}
          onValueChange={(v) => onUpdate({ structure: v as GenerateScriptData["structure"] })}
        >
          <SelectTrigger aria-label="Structure"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="freeform">Freeform</SelectItem>
            <SelectItem value="8-step">8-Step Story</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <MappableField field="styleGuide" label="Style Guide" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <TagTextarea
          rows={3}
          value={data.styleGuide}
          onChange={(v) => onUpdate({ styleGuide: v })}
          placeholder="e.g. children's book illustration, watercolor..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </MappableField>
      <MappableField field="tone" label="Tone" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <Input
          value={data.tone}
          onChange={(e) => onUpdate({ tone: e.target.value })}
          placeholder="e.g. whimsical, dramatic, educational"
        />
      </MappableField>
      <MappableField field="targetLength" label="Target Length (seconds)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
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
              <Label className="text-sm font-semibold">Generated Script</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleCopyImagePrompts}
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied" : "Copy Prompts"}
              </Button>
            </div>

            <div>
              <Label className="text-xs">Title</Label>
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
              {script.scenes.length} scenes / {script.totalDuration}s total
            </div>

            <Accordion type="single" collapsible className="w-full">
              {script.scenes.map((scene, i) => (
                <AccordionItem key={scene.sceneNumber} value={`scene-${i}`}>
                  <AccordionTrigger className="text-xs py-2 hover:no-underline">
                    <span className="text-left truncate pr-2">
                      Scene {scene.sceneNumber}: {scene.action.slice(0, 40)}{scene.action.length > 40 ? "..." : ""}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-2 pt-1">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Visual Description</Label>
                        <Textarea
                          rows={3}
                          className="text-xs"
                          value={scene.visualDescription}
                          onChange={(e) => updateScene(i, "visualDescription", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Action</Label>
                        <Textarea
                          rows={2}
                          className="text-xs"
                          value={scene.action}
                          onChange={(e) => updateScene(i, "action", e.target.value)}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Mood</Label>
                          <Input
                            className="text-xs h-7"
                            value={Array.isArray(scene.mood) ? scene.mood.join(", ") : scene.mood}
                            onChange={(e) => updateScene(i, "mood", e.target.value)}
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground">Duration (s)</Label>
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
                        <Label className="text-[10px] text-muted-foreground">Image Prompt (for Generate Image)</Label>
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
  return (
    <div className="flex flex-col gap-3">
      <LlmModelSelect
        feature="qa-check"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <div>
        <Label>Check Type</Label>
        <Select
          value={data.checkType}
          onValueChange={(v) => onUpdate({ checkType: v as QACheckData["checkType"] })}
        >
          <SelectTrigger aria-label="Check Type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="content">Content</SelectItem>
            <SelectItem value="quality">Quality</SelectItem>
            <SelectItem value="consistency">Consistency</SelectItem>
            <SelectItem value="safety">Safety</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="threshold">Threshold</Label>
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

export function ImageCriticConfig({ data, onUpdate }: ConfigProps<ImageCriticData>) {
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
        <Label>Mode</Label>
        <Select value={mode} onValueChange={(v) => handleModeChange(v as ImageCriticMode)}>
          <SelectTrigger aria-label="Mode"><SelectValue /></SelectTrigger>
          <SelectContent>
            {IMAGE_CRITIC_MODES.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="image-critic-threshold">Threshold ({data.threshold ?? 0.7})</Label>
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
          <Label htmlFor="image-critic-prompt">Prompt (or wire via input edge)</Label>
          <textarea
            id="image-critic-prompt"
            className="w-full rounded-md border bg-background p-2 text-sm"
            rows={3}
            value={data.prompt ?? ""}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            maxLength={8000}
          />
        </div>
      )}

      <LlmModelSelect
        feature="image-critic"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
    </div>
  )
}

export function ImageToTextConfig({ data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode }: ConfigProps<ImageToTextData>) {
  const imageToTextData = data as ImageToTextData
  const results = imageToTextData.generatedResults ?? []
  const activeIndex = imageToTextData.activeResultIndex ?? 0
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current) } }, [])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Detail Level</Label>
        <Select
          value={imageToTextData.detailLevel ?? "detailed"}
          onValueChange={(v) => onUpdate({ detailLevel: v as ImageToTextData["detailLevel"] })}
        >
          <SelectTrigger aria-label="Detail Level"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="brief">Brief (1-2 sentences)</SelectItem>
            <SelectItem value="detailed">Detailed (3-6 sentences)</SelectItem>
            <SelectItem value="structured">Structured (labeled sections)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <LlmModelSelect
        feature="image-to-text"
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />

      <div>
        <MappableField field="customPrompt" label="Custom Prompt (optional)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <TagTextarea
            value={imageToTextData.customPrompt ?? ""}
            onChange={(v) => onUpdate({ customPrompt: v })}
            placeholder="Override the detail level with a custom instruction..."
            rows={3}
            maxLength={2000}
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
        </MappableField>
        <p className="text-xs text-muted-foreground mt-1">
          If provided, overrides the detail level preset.
        </p>
      </div>

      {results.length > 1 && (
        <div>
          <Label>Result History</Label>
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
            <Label>Output</Label>
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
              {copied ? "Copied" : "Copy"}
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
