"use client"

import { useState, useEffect, useMemo } from "react"
import { Sparkles, Loader2, ArrowLeft, Check, Lightbulb, Settings } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { wizardAnalyze, wizardGenerate } from "@/lib/api"
import { useModelCredits } from "@/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import { LlmModelSelect } from "./llm-model-select"
import type { WizardQuestion, RecommendedModel, ModelChange } from "@nodaro/shared"

interface PromptHelperDialogProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly nodeType: string
  readonly currentPrompt: string
  readonly provider?: string
  readonly style?: string
  readonly aspectRatio?: string
  readonly duration?: number
  readonly nodeContext?: {
    connectedInputTypes?: string[]
    referenceImageCount?: number
    referenceImageUrls?: string[]
    hasSourceVideo?: boolean
  }
  readonly downstreamTargets?: ReadonlyArray<{ id: string; type: string; label: string }>
  readonly onAccept: (enhancedPrompt: string, modelChange?: ModelChange) => void
}

type Phase = "input" | "review" | "result"

type OutputFormat = "natural" | "json"

const CUSTOM_VALUE = "__custom__"

const GENERAL_TEXT_VALUE = "text-prompt"

// Wizard category key → JSON output key. Mirrors the prompthero-style
// schema commonly seen in ChatGPT-Image / Nano-Banana JSON prompts
// (subject, scene, camera, lighting, composition, mood, …).
const CATEGORY_TO_JSON_KEY: Record<string, string> = {
  subject: "subject",
  "subject-action": "subject",
  environment: "scene",
  lighting: "lighting",
  "camera-composition": "camera",
  "camera-movement": "camera",
  composition: "composition",
  "style-medium": "style",
  "style-look": "style",
  "mood-tone": "mood",
  "mood-energy": "mood",
  "details-texture": "details",
  "what-to-avoid": "negative_prompt",
  "pacing-speed": "pacing",
  "genre-style": "genre",
  instruments: "instruments",
  tempo: "tempo",
  vocals: "vocals",
  "production-style": "production",
  "sound-type": "sound_type",
  intensity: "intensity",
  "texture-quality": "texture",
  "purpose-intent": "purpose",
  "tone-voice": "tone",
  audience: "audience",
  "length-format": "format",
  task: "task",
  tone: "tone",
  format: "format",
  constraints: "constraints",
}

// Keep in sync with NODE_TYPE_TO_CATEGORIES in packages/shared/src/prompt-wizard-categories.ts
const WIZARD_TARGET_OPTIONS: ReadonlyArray<{
  group: string
  items: ReadonlyArray<{ value: string; label: string }>
}> = [
  {
    group: "Image",
    items: [
      { value: "generate-image", label: "Generate Image" },
      { value: "image-to-image", label: "Image to Image" },
    ],
  },
  {
    group: "Video",
    items: [
      { value: "text-to-video", label: "Text to Video" },
      { value: "image-to-video", label: "Image to Video" },
      { value: "video-to-video", label: "Video to Video" },
      { value: "motion-transfer", label: "Motion Transfer" },
      { value: "extend-video", label: "Extend Video" },
      { value: "speech-to-video", label: "Speech to Video" },
    ],
  },
  {
    group: "Music",
    items: [
      { value: "generate-music", label: "Generate Music" },
      { value: "suno-generate", label: "Suno Generate" },
    ],
  },
  {
    group: "Audio",
    items: [
      { value: "text-to-audio", label: "Text to Audio" },
    ],
  },
]

export function PromptHelperDialog({
  open,
  onClose,
  nodeType,
  currentPrompt,
  provider,
  style,
  aspectRatio,
  duration,
  nodeContext,
  downstreamTargets,
  onAccept,
}: PromptHelperDialogProps) {
  // Shared state
  const [llmModel, setLlmModel] = useState<string | undefined>(() => {
    return localStorage.getItem("prompt-wizard-model") || "gemini-3.1-pro"
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Target selector state (only for text-prompt nodes)
  const hasTargetSelector = !!downstreamTargets
  const defaultTarget = downstreamTargets?.[0]?.type ?? GENERAL_TEXT_VALUE
  const [selectedTargetType, setSelectedTargetType] = useState<string>(
    downstreamTargets ? defaultTarget : nodeType,
  )

  // The nodeType sent to the backend — either the selected target or the raw prop
  const effectiveNodeType = hasTargetSelector ? selectedTargetType : nodeType

  // Types already shown in Connected group — excluded from static groups to avoid duplicate Radix Select values
  const connectedTypes = useMemo(
    () => new Set(downstreamTargets?.map((t) => t.type) ?? []),
    [downstreamTargets],
  )

  // Phase 1 state
  const [roughIdea, setRoughIdea] = useState(currentPrompt || "")

  // Phase 2 state
  const [phase, setPhase] = useState<Phase>("input")
  const [questions, setQuestions] = useState<WizardQuestion[]>([])
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [multiSelections, setMultiSelections] = useState<Record<string, string[]>>({})
  const [customTexts, setCustomTexts] = useState<Record<string, string>>({})

  // Phase 3 state
  const [generatedPrompt, setGeneratedPrompt] = useState("")
  const [recommendedModel, setRecommendedModel] = useState<RecommendedModel | null>(null)
  // Output format toggle — natural-language (default) vs prompthero-style JSON.
  // JSON mode serializes the wizard's structured answers directly into a JSON
  // dict (subject / scene / camera / lighting / composition / mood / …) rather
  // than relying on the LLM-rendered prose.
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("natural")

  // User preference (persisted in localStorage)
  const [showPreference, setShowPreference] = useState(false)
  const [userPreference, setUserPreference] = useState("")

  useEffect(() => {
    const savedPref = localStorage.getItem("prompt-wizard-preference")
    if (savedPref) setUserPreference(savedPref)
  }, [])

  function handleModelChange(modelId: string) {
    setLlmModel(modelId)
    localStorage.setItem("prompt-wizard-model", modelId)
  }

  function handlePreferenceChange(value: string) {
    setUserPreference(value)
    if (value) {
      localStorage.setItem("prompt-wizard-preference", value)
    } else {
      localStorage.removeItem("prompt-wizard-preference")
    }
  }

  const effectiveModel = llmModel || LLM_FEATURE_DEFAULTS["prompt-helper"]
  const creditCost = useModelCredits(buildLlmCreditIdentifier("prompt-helper", effectiveModel), 1)

  // -- Phase 1: Analyze --
  async function handleAnalyze() {
    setLoading(true)
    setError("")
    try {
      const result = await wizardAnalyze({
        nodeType: effectiveNodeType,
        prompt: roughIdea || undefined,
        provider,
        style,
        aspectRatio,
        duration,
        llmModel,
        nodeContext,
        userPreference: userPreference || undefined,
      })

      setQuestions(result.questions)

      // Initialize selections from AI pre-selections
      const initSelections: Record<string, string> = {}
      const initMulti: Record<string, string[]> = {}
      for (const q of result.questions) {
        if (q.multi && Array.isArray(q.selected)) {
          initMulti[q.category] = q.selected
        } else if (typeof q.selected === "string") {
          initSelections[q.category] = q.selected
        }
      }
      setSelections(initSelections)
      setMultiSelections(initMulti)
      setCustomTexts({})
      setPhase("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed")
    } finally {
      setLoading(false)
    }
  }

  // -- Phase 2: Generate --
  async function handleGenerate() {
    setLoading(true)
    setError("")
    try {
      const selectionList = questions.map((q) => {
        if (q.multi) {
          const vals = multiSelections[q.category] ?? []
          return {
            category: q.category,
            value: vals.join(","),
            isCustom: false,
          }
        }
        const val = selections[q.category]
        const isCustom = val === CUSTOM_VALUE
        return {
          category: q.category,
          value: isCustom ? (customTexts[q.category] ?? "") : (val ?? ""),
          isCustom,
        }
      }).filter((s) => s.value)

      const result = await wizardGenerate({
        nodeType: effectiveNodeType,
        provider,
        style,
        aspectRatio,
        duration,
        llmModel,
        selections: selectionList,
        originalPrompt: roughIdea || undefined,
        nodeContext,
        userPreference: userPreference || undefined,
      })

      setGeneratedPrompt(result.prompt)
      setRecommendedModel(result.recommendedModel ?? null)
      setPhase("result")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed")
    } finally {
      setLoading(false)
    }
  }

  // -- Phase 3: Accept --
  function handleAccept(applyModel: boolean) {
    const modelChange = applyModel && recommendedModel
      ? { field: recommendedModel.field, value: recommendedModel.provider }
      : undefined
    const finalPrompt = outputFormat === "json" ? buildJsonPrompt() : generatedPrompt
    onAccept(finalPrompt, modelChange)
    handleClose()
  }

  function handleClose() {
    setPhase("input")
    if (downstreamTargets) {
      setSelectedTargetType(defaultTarget)
    }
    setRoughIdea(currentPrompt || "")
    // Don't reset llmModel — persisted in localStorage
    setQuestions([])
    setSelections({})
    setMultiSelections({})
    setCustomTexts({})
    setGeneratedPrompt("")
    setRecommendedModel(null)
    setOutputFormat("natural")
    setError("")
    setLoading(false)
    onClose()
  }

  // -- Selection Handlers --
  function handleSingleSelect(category: string, value: string) {
    setSelections((prev) => ({ ...prev, [category]: value }))
  }

  function handleMultiToggle(category: string, value: string) {
    setMultiSelections((prev) => {
      const current = prev[category] ?? []
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      return { ...prev, [category]: next }
    })
  }

  function handleCustomText(category: string, text: string) {
    setCustomTexts((prev) => ({ ...prev, [category]: text }))
  }

  const canGenerate =
    !loading &&
    questions.length > 0 &&
    questions.some((q) =>
      q.multi
        ? (multiSelections[q.category]?.length ?? 0) > 0
        : !!selections[q.category] && (selections[q.category] !== CUSTOM_VALUE || !!customTexts[q.category])
    )

  /**
   * Serialize wizard answers into a prompthero-style JSON dict.
   * Empty/unset fields are omitted entirely (no `null` keys).
   * Reference image roles collapse into a `references` array.
   */
  function buildJsonPrompt(): string {
    const out: Record<string, unknown> = {}
    if (roughIdea.trim()) out.idea = roughIdea.trim()
    const refs: Array<{ index: number; role: string }> = []

    for (const q of questions) {
      // Resolve the selected label (or custom text) for this question
      let label: string | undefined
      if (q.multi) {
        const vals = multiSelections[q.category] ?? []
        if (vals.length === 0) continue
        const labels = vals.map((v) => q.options.find((o) => o.value === v)?.label ?? v)
        label = labels.join(", ")
      } else {
        const val = selections[q.category]
        if (!val) continue
        if (val === CUSTOM_VALUE) {
          const custom = customTexts[q.category]?.trim()
          if (!custom) continue
          label = custom
        } else {
          label = q.options.find((o) => o.value === val)?.label ?? val
        }
      }
      if (!label) continue

      // Reference image role → references[]
      const refMatch = q.category.match(/^reference-role-(\d+)$/)
      if (refMatch) {
        refs.push({ index: parseInt(refMatch[1], 10), role: label })
        continue
      }

      const jsonKey = CATEGORY_TO_JSON_KEY[q.category] ?? q.category.replace(/-/g, "_")
      out[jsonKey] = label
    }

    if (refs.length > 0) {
      refs.sort((a, b) => a.index - b.index)
      out.references = refs.map((r) => ({ slot: r.index, role: r.role }))
    }
    if (provider) out.model = provider
    if (aspectRatio) out.aspect_ratio = aspectRatio
    if (duration) out.duration_seconds = duration

    return JSON.stringify(out, null, 2)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#ff0073]" />
            AI Prompt Wizard
            {phase !== "input" && (
              <span className="text-xs font-normal text-muted-foreground ml-2">
                {phase === "review" ? "Step 2 of 3" : "Step 3 of 3"}
              </span>
            )}
          </DialogTitle>
          <button
            type="button"
            onClick={() => setShowPreference((p) => !p)}
            className={`absolute top-4 right-10 p-1 rounded-md transition-colors ${showPreference || userPreference ? "text-[#ff0073] bg-[#ff0073]/10" : "text-muted-foreground hover:text-foreground"}`}
            title="Wizard preferences"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{effectiveNodeType}</span>
            {provider && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{provider}</span>}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-3">
          {/* User preference (collapsible) */}
          {showPreference && (
            <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-[#ff0073]/20 bg-[#ff0073]/5">
              <label className="text-xs font-medium text-muted-foreground">
                General Preference <span className="text-[10px] font-normal">(applies to all wizard sessions)</span>
              </label>
              <Textarea
                rows={2}
                value={userPreference}
                onChange={(e) => handlePreferenceChange(e.target.value)}
                placeholder="e.g. show options in Hebrew, always suggest photorealistic style, use simple language..."
                className="text-xs resize-none"
                maxLength={500}
              />
              {userPreference && (
                <p className="text-[10px] text-muted-foreground">Saved automatically. Clear the text to remove.</p>
              )}
            </div>
          )}

          {/* PHASE 1: Input */}
          {phase === "input" && (
            <>
              {hasTargetSelector && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Prompt target
                  </label>
                  <Select value={selectedTargetType} onValueChange={setSelectedTargetType}>
                    <SelectTrigger className="h-auto min-h-[2rem] sm:min-h-[2.5rem] text-xs py-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {downstreamTargets && downstreamTargets.length > 0 && (
                        <>
                          <SelectGroup>
                            <SelectLabel className="text-[10px] text-muted-foreground">Connected</SelectLabel>
                            {downstreamTargets.map((t) => (
                              <SelectItem key={t.id} value={t.type}>
                                <span>{t.label}</span>
                                <span className="ml-1.5 text-[10px] text-muted-foreground">{t.type}</span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectSeparator />
                        </>
                      )}
                      {WIZARD_TARGET_OPTIONS.map((group) => {
                        const filtered = group.items.filter((item) => !connectedTypes.has(item.value))
                        if (!filtered.length) return null
                        return (
                          <SelectGroup key={group.group}>
                            <SelectLabel className="text-[10px] text-muted-foreground">{group.group}</SelectLabel>
                            {filtered.map((item) => (
                              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        )
                      })}
                      <SelectSeparator />
                      <SelectItem value={GENERAL_TEXT_VALUE}>General text</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Describe what you want (or leave empty to build from scratch)
                </label>
                <Textarea
                  rows={3}
                  value={roughIdea}
                  onChange={(e) => setRoughIdea(e.target.value)}
                  placeholder="e.g. a cat sitting on a windowsill at sunset..."
                  className="text-xs resize-none"
                  maxLength={5000}
                />
              </div>

              <LlmModelSelect feature="prompt-helper" value={llmModel} onChange={handleModelChange} />
            </>
          )}

          {/* PHASE 2: Review Form */}
          {phase === "review" && (
            <>
              {/* Collapsed rough idea */}
              {roughIdea && (
                <div className="text-xs bg-muted/50 rounded-md px-2.5 py-2 border">
                  <span className="text-muted-foreground font-medium">Your idea: </span>
                  <span className="break-words">{roughIdea.length > 120 ? roughIdea.slice(0, 120) + "..." : roughIdea}</span>
                </div>
              )}

              {/* Question rows */}
              <div className="flex flex-col gap-3">
                {questions.map((q) => {
                  // Extract reference image index for thumbnail display
                  const refMatch = q.category.match(/^reference-role-(\d+)$/)
                  const refIdx = refMatch ? parseInt(refMatch[1], 10) - 1 : -1
                  const refImageUrl = refIdx >= 0 ? nodeContext?.referenceImageUrls?.[refIdx] : undefined

                  return (
                  <div key={q.category} className="flex flex-col gap-1.5 p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-2">
                      {refImageUrl && (
                        <img
                          src={refImageUrl}
                          alt={`Reference ${refIdx + 1}`}
                          className="w-12 h-12 rounded-md object-cover border flex-shrink-0"
                        />
                      )}
                      <label className="text-xs font-medium">{q.label}</label>
                    </div>

                    {q.multi ? (
                      /* Multi-select: checkboxes */
                      <div className="flex flex-col gap-1.5">
                        {q.options.map((opt) => (
                          <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                            <Checkbox
                              checked={(multiSelections[q.category] ?? []).includes(opt.value)}
                              onCheckedChange={() => handleMultiToggle(q.category, opt.value)}
                              className="mt-0.5"
                            />
                            <div>
                              <span className="text-xs font-medium">{opt.label}</span>
                              {opt.description && (
                                <p className="text-[10px] text-muted-foreground">{opt.description}</p>
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    ) : (
                      /* Single-select: dropdown */
                      <>
                        <Select
                          value={selections[q.category] ?? ""}
                          onValueChange={(v) => handleSingleSelect(q.category, v)}
                        >
                          <SelectTrigger className="h-auto min-h-[2rem] sm:min-h-[2.5rem] text-xs py-1.5">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent className="max-w-[min(90vw,600px)]">
                            {q.options.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value} className="whitespace-normal">
                                <div className="flex flex-col">
                                  <span>{opt.label}</span>
                                  {opt.description && (
                                    <span className="text-[10px] text-muted-foreground leading-tight">{opt.description}</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                            {q.allowCustom && (
                              <SelectItem value={CUSTOM_VALUE}>Custom...</SelectItem>
                            )}
                          </SelectContent>
                        </Select>

                        {/* Custom text input */}
                        {selections[q.category] === CUSTOM_VALUE && (
                          <Input
                            value={customTexts[q.category] ?? ""}
                            onChange={(e) => handleCustomText(q.category, e.target.value)}
                            placeholder="Type your custom value..."
                            className="h-8 text-xs mt-1"
                          />
                        )}
                      </>
                    )}
                  </div>
                  )
                })}
              </div>
            </>
          )}

          {/* PHASE 3: Result */}
          {phase === "result" && (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {outputFormat === "json" ? "Generated Prompt (JSON)" : "Generated Prompt"}
                  </label>
                  <div className="inline-flex rounded-md border bg-background p-0.5 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setOutputFormat("natural")}
                      className={`px-2 py-0.5 rounded-sm transition-colors ${outputFormat === "natural" ? "bg-[#ff0073] text-white" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Natural
                    </button>
                    <button
                      type="button"
                      onClick={() => setOutputFormat("json")}
                      className={`px-2 py-0.5 rounded-sm transition-colors ${outputFormat === "json" ? "bg-[#ff0073] text-white" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      JSON
                    </button>
                  </div>
                </div>
                {outputFormat === "natural" ? (
                  <Textarea
                    rows={4}
                    value={generatedPrompt}
                    onChange={(e) => setGeneratedPrompt(e.target.value)}
                    className="text-xs resize-none"
                  />
                ) : (
                  <Textarea
                    rows={10}
                    value={buildJsonPrompt()}
                    readOnly
                    className="text-xs resize-none font-mono"
                  />
                )}
              </div>

              {/* Model recommendation card */}
              {recommendedModel && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                  <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">Recommended: {recommendedModel.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{recommendedModel.reason}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAccept(true)}
                    className="flex-shrink-0 text-xs h-7"
                  >
                    <Check className="w-3 h-3 mr-1" />
                    Apply & Use
                  </Button>
                </div>
              )}
            </>
          )}

          {/* Error display (all phases) */}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </div>

        <div className="shrink-0 px-6 py-3 border-t bg-background">
          {phase === "input" && (
            <Button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
            >
              {loading ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Analyzing...</>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                  Build Prompt
                  <span className="ml-1.5 text-[10px] opacity-80 bg-white/20 px-1.5 py-0.5 rounded">{creditCost} CR</span>
                </>
              )}
            </Button>
          )}

          {phase === "review" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPhase("input")}
                className="flex-shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                Re-analyze
                <span className="ml-1 text-[10px] opacity-60">{creditCost} CR</span>
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex-1 bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
              >
                {loading ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Generating...</>
                ) : (
                  <>
                    Generate Prompt
                    <span className="ml-1.5 text-[10px] opacity-80 bg-white/20 px-1.5 py-0.5 rounded">{creditCost} CR</span>
                  </>
                )}
              </Button>
            </div>
          )}

          {phase === "result" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPhase("review")}
                className="flex-shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                Back
              </Button>
              <Button
                onClick={() => handleAccept(false)}
                className="flex-1 bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
              >
                Use This Prompt
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
