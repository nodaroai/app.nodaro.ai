"use client"

import { useEffect, useCallback, useState } from "react"
import { createPortal } from "react-dom"
import { X, Play, Loader2, AlertCircle, Eye, Scissors, BookOpen, Palette, Mic, Clapperboard, Check, ChevronLeft, ChevronRight, Video } from "lucide-react"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { SceneConfig } from "./scene-config"
import { buildScenePrompt, buildVideoPrompt, PROMPT_MAX_LENGTH } from "@/lib/prompt-builder"
import { textToSpeech, generateVideo, getJobStatus } from "@/lib/api"
import { MediaPreviewModal } from "./media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { ExtractReferencesModal } from "./extract-references-modal"
import type { SceneNodeDataType, ExtractedReference, GenerateScriptData } from "@/types/nodes"
import { mapScriptSceneToNodeData } from "@/types/nodes"

type WizardStep = 1 | 2 | 3 | 4

const STEPS: readonly { readonly step: WizardStep; readonly label: string; readonly icon: React.ElementType }[] = [
  { step: 1, label: "Story", icon: BookOpen },
  { step: 2, label: "Image", icon: Palette },
  { step: 3, label: "Audio", icon: Mic },
  { step: 4, label: "Video", icon: Clapperboard },
]

interface SceneEditorModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly nodeId: string
}

export function SceneEditorModal({ isOpen, onClose, nodeId }: SceneEditorModalProps) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const allAssets = useWorkflowStore((s) => s.characterDefinitions)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const addCharacterDefinition = useWorkflowStore((s) => s.addCharacterDefinition)

  const [currentStep, setCurrentStep] = useState<WizardStep>(1)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractedRefs, setExtractedRefs] = useState<readonly ExtractedReference[]>([])
  const [generatingAllAudio, setGeneratingAllAudio] = useState(false)
  const [audioProgress, setAudioProgress] = useState({ current: 0, total: 0 })
  const [generatingVideo, setGeneratingVideo] = useState(false)
  const [videoError, setVideoError] = useState<string | null>(null)
  const [mediaTab, setMediaTab] = useState<"image" | "video">("image")


  const node = nodes.find((n) => n.id === nodeId)
  const data = node?.data as SceneNodeDataType | undefined

  const linkedScriptNode = data?.sourceScriptNodeId
    ? nodes.find((n) => n.id === data.sourceScriptNodeId)
    : undefined
  const linkedScriptData = linkedScriptNode?.data as GenerateScriptData | undefined
  const linkedActiveScript = linkedScriptData
    ? (linkedScriptData.generatedResults?.[linkedScriptData.activeResultIndex ?? 0]?.script ?? linkedScriptData.generatedScript)
    : undefined
  const linkedSceneName = data && linkedActiveScript && data.sourceSceneIndex >= 0
    ? linkedActiveScript.scenes[data.sourceSceneIndex]?.sceneName
    : undefined

  function handleSyncFromScript() {
    if (!data || !linkedActiveScript || data.sourceSceneIndex < 0) return
    const scene = linkedActiveScript.scenes[data.sourceSceneIndex]
    if (!scene) return
    const mapped = mapScriptSceneToNodeData(scene)
    updateNodeData(nodeId, { ...mapped, sceneNumber: data.sourceSceneIndex + 1 })
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  // Reset step when modal opens
  useEffect(() => {
    if (isOpen) setCurrentStep(1)
  }, [isOpen])

  if (!isOpen || !data) return null

  const status = data.executionStatus ?? "idle"
  const results = data.generatedResults ?? []
  const activeIndex = data.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? data.generatedImageUrl
  const videoResults = data.generatedVideoResults ?? []
  const activeVideoIndex = data.activeVideoResultIndex ?? 0
  const activeVideoResult = videoResults[activeVideoIndex]
  const activeVideoUrl = activeVideoResult?.url ?? data.generatedVideoUrl
  const generatedPrompt = buildScenePrompt(data, allAssets)
  const displayPrompt = buildScenePrompt(data, allAssets, { forDisplay: true })

  function handleUpdate(updates: Record<string, unknown>) {
    updateNodeData(nodeId, updates)
  }

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(nodeId, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedImageUrl: newResults[newActiveIndex]?.url ?? "",
    })
  }

  async function handleGenerateAllAudio() {
    if (!data) return
    const dialogue = data.dialogue ?? []
    const linesToGenerate = dialogue
      .map((d, i) => ({ entry: d, index: i }))
      .filter((item) => item.entry.text.trim() && !(item.entry.generatedAudioResults?.length))
    if (linesToGenerate.length === 0) return

    setGeneratingAllAudio(true)
    setAudioProgress({ current: 0, total: linesToGenerate.length })

    for (let idx = 0; idx < linesToGenerate.length; idx++) {
      const { entry, index } = linesToGenerate[idx]
      setAudioProgress({ current: idx + 1, total: linesToGenerate.length })
      try {
        const { jobId } = await textToSpeech(entry.text, entry.voiceId ?? "Rachel")
        // Poll until done
        await new Promise<void>((resolve, reject) => {
          const poll = setInterval(async () => {
            try {
              const job = await getJobStatus(jobId)
              if (job.status === "completed") {
                clearInterval(poll)
                const currentData = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as SceneNodeDataType | undefined
                const currentDialogue = currentData?.dialogue ?? []
                const audioUrl = job.output_data?.audioUrl ?? ""
                const voiceId = entry.voiceId ?? "Rachel"
                const newResult = { url: audioUrl, jobId, voiceId, createdAt: new Date().toISOString() }
                const existingResults = currentDialogue[index]?.generatedAudioResults ?? []
                const updatedResults = [...existingResults, newResult]
                const updated = currentDialogue.map((d, di) =>
                  di === index ? { ...d, generatedAudioResults: updatedResults, activeAudioIndex: updatedResults.length - 1 } : d
                )
                updateNodeData(nodeId, { dialogue: updated })
                resolve()
              } else if (job.status === "failed") {
                clearInterval(poll)
                reject(new Error("TTS failed"))
              }
            } catch (err) {
              clearInterval(poll)
              reject(err)
            }
          }, 2000)
        })
      } catch {
        // Continue to next line on failure
      }
    }
    setGeneratingAllAudio(false)
  }

  async function handleGenerateVideo() {
    if (!activeUrl || generatingVideo) return
    setGeneratingVideo(true)
    setVideoError(null)
    updateNodeData(nodeId, { videoExecutionStatus: "running" })
    try {
      const provider = data?.videoProvider ?? "minimax"
      const generateAudio = provider === "veo3" ? true : undefined
      const videoPrompt = data ? buildVideoPrompt(data) : "smooth cinematic motion"
      console.log(`[SceneEditor] Generate Video - provider: ${provider}, prompt: "${videoPrompt.slice(0, 100)}..."`)
      const duration = data?.duration ?? 5
      const { jobId } = await generateVideo(activeUrl, videoPrompt, provider, generateAudio, duration)
      await new Promise<void>((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              clearInterval(poll)
              const currentData = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as SceneNodeDataType | undefined
              const videoUrl = job.output_data?.videoUrl ?? ""
              const newResult = { url: videoUrl, timestamp: new Date().toISOString(), jobId }
              const existing = currentData?.generatedVideoResults ?? []
              const updated = [...existing, newResult]
              updateNodeData(nodeId, {
                generatedVideoResults: updated,
                activeVideoResultIndex: updated.length - 1,
                generatedVideoUrl: videoUrl,
                videoExecutionStatus: "completed",
              })
              setMediaTab("video")
              resolve()
            } else if (job.status === "failed") {
              clearInterval(poll)
              updateNodeData(nodeId, { videoExecutionStatus: "failed" })
              reject(new Error(job.error_message ?? "Video generation failed"))
            }
          } catch (err) {
            clearInterval(poll)
            updateNodeData(nodeId, { videoExecutionStatus: "failed" })
            reject(err)
          }
        }, 2000)
      })
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : "Video generation failed")
      updateNodeData(nodeId, { videoExecutionStatus: "failed" })
    } finally {
      setGeneratingVideo(false)
    }
  }

  function handleDeleteVideoResult(indexToDelete: number) {
    const newResults = videoResults.filter((_, i) => i !== indexToDelete)
    let newIndex = activeVideoIndex
    if (indexToDelete === activeVideoIndex) {
      newIndex = 0
    } else if (indexToDelete < activeVideoIndex) {
      newIndex = activeVideoIndex - 1
    }
    updateNodeData(nodeId, {
      generatedVideoResults: newResults,
      activeVideoResultIndex: newIndex,
      generatedVideoUrl: newResults[newIndex]?.url ?? "",
    })
  }

  function isStepComplete(s: WizardStep): boolean {
    if (!data) return false
    if (s === 1) return !!data.summary.trim() || (data.dialogue ?? []).length > 0
    if (s === 2) return !!activeUrl
    return true
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="relative bg-background rounded-lg w-[90vw] h-[85vh] max-w-6xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">
              {data.sceneName ? `Scene: ${data.sceneName}` : "Scene Editor"}
            </h2>
            {linkedActiveScript && data.sourceSceneIndex >= 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  Linked: {linkedActiveScript?.title ?? linkedScriptData?.label ?? "Script"} / {linkedSceneName ? `${data.sourceSceneIndex + 1}. ${linkedSceneName}` : `Scene ${data.sourceSceneIndex + 1}`}
                </span>
                <button type="button" onClick={handleSyncFromScript} className="text-[10px] text-primary hover:underline">Sync</button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body - side by side */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Image/Video + Prompt Preview */}
          <div className="w-1/2 flex flex-col border-r overflow-y-auto">
            {/* Tab toggle when videos exist */}
            {videoResults.length > 0 && (
              <div className="px-4 pt-3 pb-0 shrink-0">
                <div className="flex gap-1 bg-muted/40 rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => setMediaTab("image")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      mediaTab === "image" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Palette className="w-3.5 h-3.5" /> Image
                  </button>
                  <button
                    type="button"
                    onClick={() => setMediaTab("video")}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      mediaTab === "video" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Video className="w-3.5 h-3.5" /> Video
                  </button>
                </div>
              </div>
            )}

            {/* Media area */}
            <div className="p-4 flex flex-col gap-3">
              {mediaTab === "image" && (
                <>
                  {status === "running" && (
                    <div className="flex items-center justify-center h-64 rounded-lg bg-muted/30">
                      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {status !== "running" && activeUrl && (
                    <div className="relative group">
                      <img
                        src={activeUrl}
                        alt="Scene"
                        className="w-full rounded-lg object-contain max-h-[50vh] cursor-pointer hover:opacity-90 transition-opacity bg-muted/20"
                        onClick={() => setPreviewOpen(true)}
                      />
                      <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          className="p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-md"
                          onClick={() => setPreviewOpen(true)}
                          title="Full preview"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 bg-purple-500/80 hover:bg-purple-500 text-white rounded-md"
                          onClick={() => setExtractOpen(true)}
                          title="Extract references"
                        >
                          <Scissors className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 bg-red-500/80 hover:bg-red-500 text-white rounded-md"
                          onClick={() => setDeleteConfirm(activeIndex)}
                          title="Delete this result"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {status === "failed" && !activeUrl && (
                    <div className="flex items-center justify-center gap-2 h-48 rounded-lg bg-red-500/5 text-red-500">
                      <AlertCircle className="w-6 h-6" />
                      <span className="text-sm">Generation failed</span>
                    </div>
                  )}

                  {status !== "running" && !activeUrl && status !== "failed" && (
                    <div className="flex items-center justify-center h-48 rounded-lg border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                      <span className="text-sm">No image generated yet</span>
                    </div>
                  )}

                  {/* Image version history */}
                  {results.length > 1 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {results.map((r, i) => (
                        <div key={r.jobId} className="relative group/thumb shrink-0">
                          <img
                            src={r.url}
                            alt={`Result ${i + 1}`}
                            className={`w-14 h-14 object-cover rounded-md cursor-pointer transition-opacity ${
                              i === activeIndex
                                ? "opacity-100 ring-2 ring-primary"
                                : "opacity-50 hover:opacity-80"
                            }`}
                            onClick={() => updateNodeData(nodeId, { activeResultIndex: i, generatedImageUrl: r.url })}
                          />
                          <button
                            type="button"
                            className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                            onClick={() => setDeleteConfirm(i)}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {mediaTab === "video" && (
                <>
                  {generatingVideo && (
                    <div className="flex items-center justify-center h-64 rounded-lg bg-muted/30">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Generating video...</span>
                      </div>
                    </div>
                  )}

                  {!generatingVideo && activeVideoUrl && (
                    <div className="relative">
                      <video
                        key={activeVideoUrl}
                        src={activeVideoUrl}
                        controls
                        className="w-full rounded-lg max-h-[50vh] bg-black"
                      />
                    </div>
                  )}

                  {!generatingVideo && !activeVideoUrl && (
                    <div className="flex items-center justify-center h-48 rounded-lg border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                      <span className="text-sm">No video generated yet</span>
                    </div>
                  )}

                  {/* Video version history */}
                  {videoResults.length > 1 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {videoResults.map((r, i) => (
                        <div key={r.jobId} className="relative group/thumb shrink-0">
                          <div
                            className={`w-14 h-14 rounded-md cursor-pointer transition-opacity flex items-center justify-center bg-muted ${
                              i === activeVideoIndex
                                ? "opacity-100 ring-2 ring-primary"
                                : "opacity-50 hover:opacity-80"
                            }`}
                            onClick={() => updateNodeData(nodeId, { activeVideoResultIndex: i, generatedVideoUrl: r.url })}
                          >
                            <Video className="w-4 h-4 text-muted-foreground" />
                            <span className="text-[9px] text-muted-foreground ml-0.5">{i + 1}</span>
                          </div>
                          <button
                            type="button"
                            className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                            onClick={() => handleDeleteVideoResult(i)}
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Prompt Preview */}
            <div className="px-4 pb-4">
              <Accordion type="single" collapsible>
                <AccordionItem value="prompt" className="border rounded-lg bg-muted/20">
                  <AccordionTrigger className="px-3 py-2 text-xs hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-muted-foreground">Generated Prompt</span>
                      <span className={`text-[10px] ${
                        generatedPrompt.length > PROMPT_MAX_LENGTH
                          ? "text-red-500 font-medium"
                          : generatedPrompt.length > PROMPT_MAX_LENGTH * 0.9
                            ? "text-amber-500"
                            : "text-muted-foreground"
                      }`}>
                        ({generatedPrompt.length}/{PROMPT_MAX_LENGTH})
                      </span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-0">
                    <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                      {displayPrompt || "Configure scene settings to generate a prompt..."}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>

          {/* Right: Wizard */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            {/* Stepper */}
            <div className="px-4 pt-4 pb-2 shrink-0">
              <div className="flex items-center justify-between">
                {STEPS.map((s, idx) => {
                  const Icon = s.icon
                  const isActive = currentStep === s.step
                  const isComplete = isStepComplete(s.step) && currentStep > s.step
                  return (
                    <div key={s.step} className="flex items-center flex-1">
                      <button
                        type="button"
                        onClick={() => setCurrentStep(s.step)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-violet-500/15 text-violet-500 border border-violet-500/30"
                            : isComplete
                              ? "text-green-600 hover:bg-muted"
                              : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {isComplete && !isActive ? (
                          <Check className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <Icon className="w-3.5 h-3.5" />
                        )}
                        <span className="hidden sm:inline">{s.label}</span>
                      </button>
                      {idx < STEPS.length - 1 && (
                        <div className="flex-1 h-px border-t border-dashed border-muted-foreground/30 mx-1" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Step Content */}
            <div className="flex-1 overflow-y-auto px-4 pb-2">
              <SceneConfig key={currentStep} data={data} onUpdate={handleUpdate} step={currentStep} nodeId={nodeId} />
            </div>

            {/* Step Action Button + Navigation */}
            <div className="px-4 py-3 border-t shrink-0 flex flex-col gap-2">
              {/* Per-step action button */}
              {currentStep === 2 && (
                <button
                  type="button"
                  disabled={status === "running"}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-md transition-colors"
                  onClick={() => runSingleNode?.(nodeId)}
                >
                  {status === "running" ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</>
                  ) : activeUrl ? (
                    <><Play className="w-3.5 h-3.5" /> Regenerate Image</>
                  ) : (
                    <><Play className="w-3.5 h-3.5" /> Generate Scene Image</>
                  )}
                </button>
              )}
              {currentStep === 3 && (
                <button
                  type="button"
                  disabled={generatingAllAudio || !(data?.dialogue ?? []).some((d) => d.text.trim() && !(d.generatedAudioResults?.length))}
                  onClick={handleGenerateAllAudio}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-md transition-colors"
                >
                  {generatingAllAudio ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating {audioProgress.current}/{audioProgress.total}...</>
                  ) : (
                    <><Mic className="w-3.5 h-3.5" /> Generate All Audio</>
                  )}
                </button>
              )}
              {currentStep === 4 && (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={!activeUrl || generatingVideo}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white rounded-md transition-colors"
                    onClick={handleGenerateVideo}
                    title={activeUrl ? "Generate video from scene image" : "Generate an image first (Step 2)"}
                  >
                    {generatingVideo ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating Video...</>
                    ) : activeVideoUrl ? (
                      <><Video className="w-3.5 h-3.5" /> Regenerate Video</>
                    ) : (
                      <><Video className="w-3.5 h-3.5" /> Generate Video</>
                    )}
                  </button>
                  {videoError && (
                    <p className="text-[10px] text-red-500 text-center">{videoError}</p>
                  )}
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  disabled={currentStep === 1}
                  onClick={() => setCurrentStep((currentStep - 1) as WizardStep)}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md hover:bg-muted disabled:opacity-30 disabled:cursor-default transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </button>
                <span className="text-[10px] text-muted-foreground">
                  Step {currentStep} of {STEPS.length}
                </span>
                {currentStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => setCurrentStep((currentStep + 1) as WizardStep)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 transition-colors"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-violet-500 text-white hover:bg-violet-600 transition-colors"
                  >
                    Done <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={activeUrl}
        />
      )}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />
      {activeUrl && (
        <ExtractReferencesModal
          isOpen={extractOpen}
          onClose={() => setExtractOpen(false)}
          imageUrl={activeUrl}
          sceneIndex={0}
          sceneCharacters={[]}
          existingReferences={extractedRefs}
          onSave={(refs) => {
            setExtractedRefs(refs)
            for (const ref of refs) {
              if (!ref.imageUrl) continue
              addCharacterDefinition({
                id: crypto.randomUUID(),
                name: ref.name,
                type: "reference",
                category: ref.type,
                referenceImageUrl: ref.imageUrl,
              })
            }
          }}
        />
      )}
    </div>,
    document.body
  )
}
