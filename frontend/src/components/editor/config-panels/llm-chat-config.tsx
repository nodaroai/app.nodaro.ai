"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, BookmarkPlus, Loader2, Image as ImageIcon, Video as VideoIcon, Music as MusicIcon, X, Save, Trash2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { LLMChatData } from "@/types/nodes"
import { LlmModelSelect } from "./llm-model-select"
import { MappableField } from "./mappable-field"
import { PromptHelperButton } from "./prompt-helper-button"
import { SnippetMenuButton } from "./snippet-menu-button"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { PromptFieldFinalView, PromptFieldModeToggle } from "./prompt-field-final-view"
import { useFinalPromptSegments } from "./use-final-prompt-segments"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
import type { ConfigProps } from "./types"
import { getLlmModalityCaps, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAuth } from "@/hooks/use-auth"
import { useSaveTemplatesMutation } from "@/hooks/queries/use-user-settings-queries"
import {
  GENERATE_TEXT_TEMPLATES,
  getGenerateTextTemplate,
  type GenerateTextTemplate,
} from "@/lib/generate-text-templates"

// Image source node types that satisfy a template's reference-image requirement.
const IMG_SRC_TYPES = new Set([
  "generate-image", "upload-image", "edit-image", "image-to-image",
  "character", "object", "location", "face",
])

function MediaRefRow({
  label, icon, urls, max, onAdd, onRemove,
}: {
  label: string
  icon: React.ReactNode
  urls: readonly string[]
  max: number
  onAdd: (url: string) => void
  onRemove: (idx: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">{label}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{urls.length}/{max}</span>
      </div>
      {urls.length > 0 && (
        <ul className="space-y-1">
          {urls.map((url, idx) => (
            <li key={`${url}-${idx}`} className="flex items-center gap-2 text-xs bg-[#F8FAFC] dark:bg-[#121212] rounded px-2 py-1">
              <span className="truncate flex-1" title={url}>{url.split("/").slice(-1)[0]}</span>
              <button onClick={() => onRemove(idx)} className="text-gray-400 hover:text-red-500" aria-label="Remove">
                <X className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {urls.length < max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs w-full"
          onClick={() => {
            const url = window.prompt(`Paste a public ${label.toLowerCase()} URL:`)
            if (url && /^https?:\/\//.test(url)) onAdd(url)
          }}
        >
          + Add {label.toLowerCase()}
        </Button>
      )}
    </div>
  )
}

export function LLMChatConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<LLMChatData>) {
  const activeIdx = data.activeResultIndex ?? 0
  const results = data.generatedResults ?? []
  const promptSnippets = useSnippetPool("text", "prompt")

  const currentModel = data.llmModel ?? LLM_FEATURE_DEFAULTS["llm-chat"]
  const caps = getLlmModalityCaps(currentModel)

  useEffect(() => {
    const updates: Partial<LLMChatData> = {}
    if (!caps.video && data.referenceVideoUrls?.length) updates.referenceVideoUrls = undefined
    if (!caps.audio && data.referenceAudioUrls?.length) updates.referenceAudioUrls = undefined
    if (Object.keys(updates).length) onUpdate(updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.llmModel])

  // --- Templates + fan-out (merged from the former AI Agent node) ---
  const { user } = useAuth()
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const allNodes = useWorkflowStore((s) => s.nodes)
  const allEdges = useWorkflowStore((s) => s.edges)

  // Edit⇄Final toggles for both prompt fields (provider-less — LLMChatData has
  // no provider). Keyed by the real data fields so state persists per node.
  const systemPromptMode = usePromptFieldMode(selectedNodeId ?? "", "systemPrompt")
  const userInputMode = usePromptFieldMode(selectedNodeId ?? "", "userInput")
  const finalSystemPrompt = useFinalPromptSegments({
    userPrompt: data.systemPrompt,
    consumerNodeId: selectedNodeId ?? undefined,
    nodes: allNodes,
    edges: allEdges,
    snippets: promptSnippets,
  })
  const finalUserInput = useFinalPromptSegments({
    userPrompt: data.userInput,
    consumerNodeId: selectedNodeId ?? undefined,
    nodes: allNodes,
    edges: allEdges,
    snippets: promptSnippets,
  })
  const userTextTemplates = useWorkflowStore((s) => s.userTextTemplates)
  const setUserTextTemplates = useWorkflowStore((s) => s.setUserTextTemplates)
  const userPromptTemplates = useWorkflowStore((s) => s.userPromptTemplates)
  const saveTemplates = useSaveTemplatesMutation()

  const [expandedItemIndex, setExpandedItemIndex] = useState<number | null>(null)

  // Resolve the selected template from built-ins first, then the user's saved set.
  const templateId = data.templateId ?? "custom"
  const currentTemplate: GenerateTextTemplate | undefined =
    getGenerateTextTemplate(templateId) ?? userTextTemplates.find((t) => t.id === templateId)
  // Whether the selected template is one of the user's saved (editable) ones —
  // gates the Update / Delete affordances (built-ins can't be overridden).
  const isUserTemplate = userTextTemplates.some((t) => t.id === templateId)

  // Reference-image gate: only warn when the chosen template explicitly needs one
  // (built-in fan-out templates set requiresImageRef) AND no image source is wired in.
  const hasRefImage = useMemo(() => {
    if (!selectedNodeId) return false
    return allEdges
      .filter((e) => e.target === selectedNodeId)
      .some((e) => {
        const src = allNodes.find((n) => n.id === e.source)
        return src && IMG_SRC_TYPES.has(src.type ?? "")
      })
  }, [selectedNodeId, allEdges, allNodes])
  const needsRefImage = Boolean(currentTemplate?.requiresImageRef) && !hasRefImage

  function handleTemplateChange(nextId: string) {
    const tpl = getGenerateTextTemplate(nextId) ?? userTextTemplates.find((t) => t.id === nextId)
    if (!tpl) return
    const prevTpl =
      getGenerateTextTemplate(templateId) ?? userTextTemplates.find((t) => t.id === templateId)
    const isDefaultOrEmpty = !data.userInput?.trim() || data.userInput === prevTpl?.defaultInput
    onUpdate({
      templateId: nextId,
      systemPrompt: tpl.systemPrompt,
      ...(isDefaultOrEmpty && tpl.defaultInput ? { userInput: tpl.defaultInput } : {}),
      ...(tpl.defaultMaxTokens ? { maxTokens: tpl.defaultMaxTokens } : {}),
      ...(tpl.llmModel ? { llmModel: tpl.llmModel } : {}),
    })
  }

  // Single persistence path for the user's saved text templates: update the
  // store optimistically, then PATCH settings. Re-sends the already-saved
  // prompt templates so the PATCH doesn't clobber them (the backend updates
  // prompt_templates whenever the field is present).
  function persistTextTemplates(next: GenerateTextTemplate[]) {
    setUserTextTemplates(next)
    if (user?.id) {
      saveTemplates.mutate({
        userId: user.id,
        promptTemplates: userPromptTemplates,
        textTemplates: next,
      })
    }
  }

  function handleSaveAsTemplate() {
    const suggested = data.userInput?.trim().split("\n")[0]?.slice(0, 60) || "My Preset"
    const label = window.prompt("Name this preset:", suggested)?.trim()
    if (!label) return
    persistTextTemplates([
      ...userTextTemplates,
      {
        id: crypto.randomUUID(),
        label,
        systemPrompt: data.systemPrompt,
        ...(data.maxTokens ? { defaultMaxTokens: data.maxTokens } : {}),
        ...(data.llmModel ? { llmModel: data.llmModel } : {}),
      },
    ])
  }

  // Override the currently-selected user template with the panel's current
  // System Prompt + settings (in place — keeps the same id + label).
  function handleUpdateTemplate() {
    if (!isUserTemplate) return
    persistTextTemplates(
      userTextTemplates.map((t) =>
        t.id === templateId
          ? {
              ...t,
              systemPrompt: data.systemPrompt,
              ...(data.maxTokens ? { defaultMaxTokens: data.maxTokens } : {}),
              ...(data.llmModel ? { llmModel: data.llmModel } : {}),
            }
          : t,
      ),
    )
  }

  // Delete the currently-selected user template and fall back to Custom.
  function handleDeleteTemplate() {
    if (!isUserTemplate) return
    const tpl = userTextTemplates.find((t) => t.id === templateId)
    if (!window.confirm(`Delete the preset "${tpl?.label ?? "Untitled"}"? This can't be undone.`)) return
    persistTextTemplates(userTextTemplates.filter((t) => t.id !== templateId))
    onUpdate({ templateId: "custom" })
  }

  // Progress for the "Generate All" fan-out button (mirrors the former AI Agent).
  const createdIds = data.createdNodeIds ?? []
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

  return (
    <>
      {/* Preset Selector — built-in presets + the user's saved presets */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Preset</Label>
          <div className="flex items-center gap-1">
            {isUserTemplate && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleUpdateTemplate}
                  disabled={!data.systemPrompt?.trim()}
                  title="Save your current edits back to this preset"
                >
                  <Save className="w-3 h-3 mr-1" />
                  Update
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  onClick={handleDeleteTemplate}
                  title="Delete this preset"
                  aria-label="Delete preset"
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleSaveAsTemplate}
              disabled={!data.systemPrompt?.trim()}
            >
              <BookmarkPlus className="w-3 h-3 mr-1" />
              Save as preset
            </Button>
          </div>
        </div>
        <select
          aria-label="Preset"
          value={templateId}
          onChange={(e) => handleTemplateChange(e.target.value)}
          className="w-full rounded-md border border-gray-200 dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#121212] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#ff0073]/30 focus:border-[#ff0073]"
        >
          <optgroup label="Built-in">
            {GENERATE_TEXT_TEMPLATES.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.label}
              </option>
            ))}
          </optgroup>
          {userTextTemplates.length > 0 && (
            <optgroup label="My Presets">
              {userTextTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.label || "Untitled"}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        {currentTemplate?.description && currentTemplate.id !== "custom" && (
          <p className="text-xs text-muted-foreground">{currentTemplate.description}</p>
        )}
      </div>

      {/* Reference Image Warning — only for templates that require an image ref */}
      {needsRefImage && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 shadow-sm">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Connect a reference image node (Generate Image, Upload Image) to Generate Text for character consistency across all generated images.
            </p>
          </div>
        </div>
      )}

      {/* Model */}
      <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-3">
        <LlmModelSelect
          feature="llm-chat"
          value={data.llmModel}
          onChange={(v) => onUpdate({ llmModel: v })}
        />
      </div>

      {/* Instructions (System Prompt) */}
      <MappableField field="systemPrompt" label="Instructions (System Prompt)" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={systemPromptMode.mode} onToggle={systemPromptMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.systemPrompt || ""} onInsert={(v) => onUpdate({ systemPrompt: v })} target="prompt" media="text" />
        <PromptHelperButton nodeType="llm-chat" currentPrompt={data.systemPrompt || ""} onAccept={(prompt) => onUpdate({ systemPrompt: prompt })} />
      </span>}>
        {systemPromptMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalSystemPrompt.promptSegments}
            plainText={finalSystemPrompt.promptText}
            placeholder="Final system prompt preview — empty"
            minHeightRem={4 * 1.5}
          />
        ) : (
          <Textarea
            rows={4}
            value={data.systemPrompt}
            onChange={(e) => onUpdate({ systemPrompt: e.target.value })}
            placeholder="You are a helpful assistant... (use {} to inject input)"
            className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm font-mono resize-y"
          />
        )}
      </MappableField>

      {/* User Prompt */}
      <MappableField field="userInput" label="User Prompt" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={<span className="inline-flex items-center gap-0.5">
        <PromptFieldModeToggle mode={userInputMode.mode} onToggle={userInputMode.toggle} />
        <SnippetMenuButton pool={promptSnippets} value={data.userInput || ""} onInsert={(v) => onUpdate({ userInput: v })} target="prompt" media="text" />
        <PromptHelperButton nodeType="llm-chat" currentPrompt={data.userInput || ""} onAccept={(prompt) => onUpdate({ userInput: prompt })} />
      </span>}>
        {userInputMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalUserInput.promptSegments}
            plainText={finalUserInput.promptText}
            placeholder="Final user prompt preview — empty"
            minHeightRem={4 * 1.5}
          />
        ) : (
          <Textarea
            rows={4}
            value={data.userInput}
            onChange={(e) => onUpdate({ userInput: e.target.value })}
            placeholder="Enter your prompt... (use {} to inject input)"
            className="bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D] text-sm resize-y"
          />
        )}
      </MappableField>

      {/* Settings */}
      <Accordion type="single" collapsible defaultValue="settings">
        <AccordionItem value="settings" className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shadow-sm">
          <AccordionTrigger className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
            Settings
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Temperature: {(data.temperature ?? 0.7).toFixed(1)}</Label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={data.temperature ?? 0.7}
                onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                className="w-full mt-1 accent-[#ff0073]"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max Tokens</Label>
              <Input
                type="number"
                min={256}
                max={16384}
                step={256}
                value={data.maxTokens ?? 2048}
                onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value, 10) || 2048 })}
                className="mt-1 bg-[#F8FAFC] dark:bg-[#121212] border-gray-200 dark:border-[#2D2D2D]"
              />
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* References */}
      <Accordion type="single" collapsible>
        <AccordionItem value="refs" className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shadow-sm">
          <AccordionTrigger className="px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
            References
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3 space-y-4">
            <MediaRefRow
              label="Images"
              icon={<ImageIcon className="w-3.5 h-3.5 text-gray-500" />}
              urls={data.referenceImageUrls ?? []}
              max={5}
              onAdd={(url) => onUpdate({ referenceImageUrls: [...(data.referenceImageUrls ?? []), url] })}
              onRemove={(idx) => onUpdate({ referenceImageUrls: (data.referenceImageUrls ?? []).filter((_, i) => i !== idx) })}
            />
            {caps.video && (
              <MediaRefRow
                label="Videos"
                icon={<VideoIcon className="w-3.5 h-3.5 text-gray-500" />}
                urls={data.referenceVideoUrls ?? []}
                max={3}
                onAdd={(url) => onUpdate({ referenceVideoUrls: [...(data.referenceVideoUrls ?? []), url] })}
                onRemove={(idx) => onUpdate({ referenceVideoUrls: (data.referenceVideoUrls ?? []).filter((_, i) => i !== idx) })}
              />
            )}
            {caps.audio && (
              <MediaRefRow
                label="Audio"
                icon={<MusicIcon className="w-3.5 h-3.5 text-gray-500" />}
                urls={data.referenceAudioUrls ?? []}
                max={3}
                onAdd={(url) => onUpdate({ referenceAudioUrls: [...(data.referenceAudioUrls ?? []), url] })}
                onRemove={(idx) => onUpdate({ referenceAudioUrls: (data.referenceAudioUrls ?? []).filter((_, i) => i !== idx) })}
              />
            )}
            {!caps.video && !caps.audio && (
              <p className="text-[11px] text-muted-foreground">
                Switch to a Gemini model to attach video or audio references.
              </p>
            )}
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

      {/* Generated Prompts List (fan-out templates) */}
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

          {/* Create Image Nodes */}
          <button
            onClick={() => {
              if (selectedNodeId) {
                useWorkflowStore.getState().createNodesFromWriter?.(selectedNodeId)
              }
            }}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: "#ff0073" }}
          >
            {createdIds.length > 0
              ? `Re-create ${data.generatedItems.length} Image Nodes`
              : `Create ${data.generatedItems.length} Image Nodes`}
          </button>
          {createdIds.length > 0 && (
            <p className="text-[10px] text-center text-muted-foreground">
              {createdIds.length} nodes previously created (will be replaced)
            </p>
          )}
          {!hasRefImage && (
            <p className="text-[10px] text-center text-amber-600 dark:text-amber-400">
              No reference image connected -- images will have no visual reference
            </p>
          )}
        </div>
      )}

      {/* Run All Image Nodes (fan-out templates) */}
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

      {/* Result Display (raw text — hidden when fan-out produced a prompt list) */}
      {data.executionStatus !== "running" && data.generatedText && !data.generatedItems?.length && (
        <div className="rounded-xl border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-3 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Result</Label>
            {results.length > 1 && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <button
                  onClick={() => {
                    const prev = Math.max(0, activeIdx - 1)
                    const result = results[prev]
                    onUpdate({ activeResultIndex: prev, generatedText: result?.text })
                  }}
                  disabled={activeIdx === 0}
                  className="px-1.5 py-0.5 rounded border disabled:opacity-30"
                >
                  Prev
                </button>
                <span>{activeIdx + 1}/{results.length}</span>
                <button
                  onClick={() => {
                    const next = Math.min(results.length - 1, activeIdx + 1)
                    const result = results[next]
                    onUpdate({ activeResultIndex: next, generatedText: result?.text })
                  }}
                  disabled={activeIdx >= results.length - 1}
                  className="px-1.5 py-0.5 rounded border disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="bg-[#F8FAFC] dark:bg-[#121212] rounded-lg p-3 overflow-y-auto resize-y" style={{ minHeight: '120px', maxHeight: '600px' }}>
            <p className="text-sm whitespace-pre-wrap">{data.generatedText}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {data.errorMessage && (
        <div className="rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10 p-3 shadow-sm">
          <p className="text-xs text-red-600 dark:text-red-400">{data.errorMessage}</p>
        </div>
      )}
    </>
  )
}
