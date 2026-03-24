"use client"

import { useState, useMemo } from "react"
import { AlertCircle, Loader2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { AI_WRITER_TEMPLATES, getAIWriterTemplate } from "@/lib/ai-writer-templates"
import type { AIWriterNodeData } from "@/types/nodes"
import { LlmModelSelect } from "./llm-model-select"
import type { ConfigProps } from "./types"

export function AIWriterConfig({ data, onUpdate }: ConfigProps<AIWriterNodeData>) {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const [expandedItemIndex, setExpandedItemIndex] = useState<number | null>(null)
  const currentTemplate = getAIWriterTemplate(data.templateId)

  const createdIds = data.createdNodeIds ?? []
  const allNodes = useWorkflowStore((s) => s.nodes)
  const imageNodeStatuses = useMemo(() => {
    if (createdIds.length === 0) return { running: 0, completed: 0, failed: 0, total: 0 }
    let running = 0, completed = 0, failed = 0
    for (const id of createdIds) {
      const node = allNodes.find((n) => n.id === id)
      const status = (node?.data as Record<string, unknown>)?.executionStatus as string | undefined
      if (status === "running") running += 1
      else if (status === "completed") completed += 1
      else if (status === "failed") failed += 1
    }
    return { running, completed, failed, total: createdIds.length }
  }, [createdIds, allNodes])
  const isGenerating = imageNodeStatuses.running > 0

  const allEdges = useWorkflowStore((s) => s.edges)
  const hasRefImage = useMemo(() => {
    if (!selectedNodeId) return false
    const IMG_SRC_TYPES = new Set(["generate-image", "upload-image", "edit-image", "image-to-image", "character", "object", "location", "face"])
    return allEdges
      .filter((e) => e.target === selectedNodeId)
      .some((e) => {
        const src = allNodes.find((n) => n.id === e.source)
        return src && IMG_SRC_TYPES.has(src.type ?? "")
      })
  }, [selectedNodeId, allEdges, allNodes])
  const isPresetTemplate = data.templateId !== "custom"
  const needsRefImage = isPresetTemplate && !hasRefImage

  function handleTemplateChange(templateId: string) {
    const tpl = getAIWriterTemplate(templateId)
    if (!tpl) return
    const prevTpl = getAIWriterTemplate(data.templateId)
    const isDefaultOrEmpty = !data.userInput?.trim() || data.userInput === prevTpl?.defaultInput
    onUpdate({
      templateId,
      systemPrompt: tpl.systemPrompt,
      ...(isDefaultOrEmpty && tpl.defaultInput ? { userInput: tpl.defaultInput } : {}),
      ...(tpl.defaultMaxTokens ? { maxTokens: tpl.defaultMaxTokens } : {}),
    })
  }

  return (
    <>
      {/* Template Selector */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-3">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Template</Label>
        <Select value={data.templateId} onValueChange={handleTemplateChange}>
          <SelectTrigger className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AI_WRITER_TEMPLATES.map((tpl) => (
              <SelectItem key={tpl.id} value={tpl.id}>
                {tpl.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentTemplate && currentTemplate.id !== "custom" && (
          <p className="text-xs text-muted-foreground">{currentTemplate.description}</p>
        )}
      </div>

      {/* Reference Image Warning */}
      {needsRefImage && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 shadow-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Connect a reference image node (Generate Image, Upload Image) to AI Agent for character consistency across all generated images.
            </p>
          </div>
        </div>
      )}

      {/* System Prompt */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">System Prompt</Label>
        <Textarea
          rows={6}
          value={data.systemPrompt}
          onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
          placeholder="Instructions for the AI writer..."
          className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm font-mono resize-y"
        />
      </div>

      {/* User Input */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
        <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">User Input</Label>
        <Textarea
          rows={4}
          value={data.userInput}
          onChange={(e) => onUpdate({ userInput: e.target.value })}
          placeholder={currentTemplate?.placeholderInput ?? "Enter your instructions..."}
          className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm resize-y"
        />
      </div>

      {/* Settings */}
      <Accordion type="single" value="settings">
        <AccordionItem value="settings" className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shadow-sm">
          <AccordionTrigger className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
            Settings
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select value={data.provider} onValueChange={(v) => onUpdate({ provider: v as AIWriterNodeData["provider"] })}>
                <SelectTrigger className="mt-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <LlmModelSelect
              feature="ai-writer"
              value={data.llmModel}
              onChange={(v) => onUpdate({ llmModel: v })}
            />
            <div>
              <Label className="text-xs text-muted-foreground">Temperature: {data.temperature.toFixed(1)}</Label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={data.temperature}
                onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                className="w-full mt-1 accent-[#ff0073]"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <Input
                type="number"
                min={256}
                max={8192}
                step={256}
                value={data.maxTokens}
                onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value, 10) || 2048 })}
                className="mt-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Streaming Output */}
      {data.executionStatus === "running" && (
        <div className="rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/10 p-3 shadow-sm space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">
              Streaming...
            </Label>
          </div>
          <div className="bg-white/60 dark:bg-[#121212] rounded-lg p-3 max-h-60 overflow-y-auto">
            {data.generatedText ? (
              <p className="text-sm whitespace-pre-wrap">
                {data.generatedText}
                <span className="animate-pulse text-violet-500">|</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">Waiting for tokens...</p>
            )}
          </div>
        </div>
      )}

      {/* Generated Prompts List */}
      {data.generatedItems && data.generatedItems.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
              Generated Prompts
            </Label>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium">
              {data.generatedItems.length} items
            </span>
          </div>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {data.generatedItems.map((item, idx) => (
              <div key={idx} className="group">
                <div
                  className="flex items-start gap-2 p-2 rounded-lg bg-[#F8FAFC] dark:bg-[#121212] hover:bg-gray-100 dark:hover:bg-[#1a1a1a] cursor-pointer transition-colors"
                  onClick={() => setExpandedItemIndex(expandedItemIndex === idx ? null : idx)}
                >
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-500/10 text-violet-500 text-[10px] font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  {expandedItemIndex === idx ? (
                    <Textarea
                      value={item}
                      onChange={(e) => {
                        const updated = [...data.generatedItems!]
                        updated[idx] = e.target.value
                        onUpdate({ generatedItems: updated })
                      }}
                      onClick={(e) => e.stopPropagation()}
                      rows={4}
                      className="flex-1 text-xs bg-white dark:bg-[#1E1E1E] border-gray-200 dark:border-[#2D2D2D] resize-y"
                    />
                  ) : (
                    <p className="flex-1 text-xs text-muted-foreground line-clamp-2">{item}</p>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const updated = data.generatedItems!.filter((_, i) => i !== idx)
                      onUpdate({ generatedItems: updated })
                      if (expandedItemIndex === idx) setExpandedItemIndex(null)
                    }}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/20"
                  >
                    <X className="w-3 h-3 text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Create Nodes Button */}
          <button
            onClick={() => {
              if (selectedNodeId) {
                useWorkflowStore.getState().createNodesFromWriter?.(selectedNodeId)
              }
            }}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: "#ff0073" }}
          >
            {data.createdNodeIds && data.createdNodeIds.length > 0
              ? `Re-create ${data.generatedItems.length} Image Nodes`
              : `Create ${data.generatedItems.length} Image Nodes`}
          </button>
          {data.createdNodeIds && data.createdNodeIds.length > 0 && (
            <p className="text-[10px] text-center text-muted-foreground">
              {data.createdNodeIds.length} nodes previously created (will be replaced)
            </p>
          )}
          {!hasRefImage && (
            <p className="text-[10px] text-center text-amber-600 dark:text-amber-400">
              No reference image connected -- images will have no visual reference
            </p>
          )}
        </div>
      )}

      {/* Run All Image Nodes */}
      {createdIds.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
          <button
            onClick={() => {
              if (selectedNodeId && !isGenerating) {
                useWorkflowStore.getState().runAllWriterImageNodes?.(selectedNodeId)
              }
            }}
            disabled={isGenerating}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: isGenerating ? "#6b7280" : "#7c3aed" }}
          >
            {isGenerating
              ? `Generating images: ${imageNodeStatuses.completed + imageNodeStatuses.failed}/${imageNodeStatuses.total} complete`
              : `Generate All ${createdIds.length} Images`}
          </button>
          {isGenerating && (
            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${imageNodeStatuses.total > 0 ? Math.round(((imageNodeStatuses.completed + imageNodeStatuses.failed) / imageNodeStatuses.total) * 100) : 0}%`,
                  backgroundColor: "#7c3aed",
                }}
              />
            </div>
          )}
          {!isGenerating && (imageNodeStatuses.completed > 0 || imageNodeStatuses.failed > 0) && (
            <p className="text-[10px] text-center text-muted-foreground">
              {imageNodeStatuses.completed} succeeded{imageNodeStatuses.failed > 0 ? `, ${imageNodeStatuses.failed} failed` : ""}
            </p>
          )}
        </div>
      )}

      {/* Raw Output Display */}
      {data.generatedText && !data.generatedItems?.length && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Raw Output</Label>
          <div className="bg-[#F8FAFC] dark:bg-[#121212] rounded-lg p-3 max-h-60 overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap">{data.generatedText}</p>
          </div>
        </div>
      )}
    </>
  )
}
