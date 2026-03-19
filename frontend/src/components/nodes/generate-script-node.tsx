"use client"

import { memo, useState, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Position, type NodeProps } from "@xyflow/react"
import { BookOpen, Loader2, AlertCircle, X, FileText, Sparkles, ImageIcon, Film, Maximize2, Type, MessageSquare, Music, Volume2, User, MapPin, Copy } from "lucide-react"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import type { ExpandOptions } from "@/components/editor/expand-storyboard-dialog"
const ScriptPreviewModal = lazy(() => import("@/components/editor/script-preview-modal").then(m => ({ default: m.ScriptPreviewModal })))
const ExpandStoryboardDialog = lazy(() => import("@/components/editor/expand-storyboard-dialog").then(m => ({ default: m.ExpandStoryboardDialog })))
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { buildLlmCreditIdentifier, LLM_FEATURE_DEFAULTS } from "@nodaro-shared/llm-models"
import type { GenerateScriptData, GeneratedScriptResult } from "@/types/nodes"

function GenerateScriptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateScriptData
  const credits = useModelCredits(buildLlmCreditIdentifier("generate-script", nodeData.llmModel || LLM_FEATURE_DEFAULTS["generate-script"]), 10)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const generateSceneImage = useWorkflowStore((s) => s.generateSceneImage)
  const expandStoryboard = useWorkflowStore((s) => s.expandStoryboard)
  const createSceneNodeFromScript = useWorkflowStore((s) => s.createSceneNodeFromScript)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeScript = activeResult?.script ?? nodeData.generatedScript
  const [showFullscreen, setShowFullscreen] = useState(false)
  const [showExpandDialog, setShowExpandDialog] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const sceneCount = activeScript?.scenes.length ?? 0
  const creditsPerScene = 5 + 20 // image + video
  const totalEstimatedCredits = 2 + sceneCount * creditsPerScene // script + scenes

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedScript", "script"))
  }

  return (
    <div className="relative" style={{ width: activeScript ? 350 : 220 }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<BookOpen className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<BookOpen className="h-4 w-4" />}
      category="script"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      minHeight={280}
      topToolbarContent={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "in", type: "target", position: Position.Left, customStyle: { top: '50%', left: '-29px' }, hideHandle: true },
        { id: "scenes", type: "source", position: Position.Right, customStyle: { top: '10%', right: '-29px' }, hideHandle: true },
        { id: "images", type: "source", position: Position.Right, customStyle: { top: '24%', right: '-29px' }, hideHandle: true },
        { id: "dialogue", type: "source", position: Position.Right, customStyle: { top: '38%', right: '-29px' }, hideHandle: true },
        { id: "music", type: "source", position: Position.Right, customStyle: { top: '52%', right: '-29px' }, hideHandle: true },
        { id: "sfx", type: "source", position: Position.Right, customStyle: { top: '66%', right: '-29px' }, hideHandle: true },
        { id: "characters", type: "source", position: Position.Right, customStyle: { top: '80%', right: '-29px' }, hideHandle: true },
        { id: "locations", type: "source", position: Position.Right, customStyle: { top: '94%', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="flex flex-col gap-1.5">
        {status === "running" && !activeScript && (
          <div className="flex items-center justify-center h-16 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {activeScript && (
          <div className="relative group">
            <div className="rounded-md bg-muted/30 p-2 text-xs space-y-1.5">
              {status === "running" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-md z-10">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="font-medium truncate">{activeScript.title}</div>
                <div className="text-muted-foreground shrink-0 ml-2">
                  {sceneCount} scenes / {activeScript.totalDuration}s
                </div>
              </div>

              {/* Storyboard strip */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                {activeScript.scenes.map((scene) => (
                  <div
                    key={scene.sceneNumber}
                    className={`shrink-0 w-[68px] rounded bg-background/60 border p-1 flex flex-col items-center gap-0.5 ${
                      scene.imageStatus === "failed" ? "border-red-500/40" : "border-border/40"
                    }`}
                  >
                    <div className="text-[9px] font-medium text-muted-foreground">
                      #{scene.sceneNumber}
                    </div>
                    <div className="w-full aspect-video rounded-sm overflow-hidden bg-muted/50 flex items-center justify-center text-muted-foreground/30">
                      {scene.imageStatus === "completed" && (scene.generatedImages ?? []).length > 0 ? (
                        <CachedImage src={(scene.generatedImages ?? [])[scene.activeImageIndex ?? 0]?.url} alt={`Scene ${scene.sceneNumber}`} className="w-full h-full object-cover" thumbnail thumbnailWidth={120} />
                      ) : scene.imageStatus === "running" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ImageIcon className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className="text-[9px] text-muted-foreground">{scene.durationHint}s</div>
                    <div className="text-[8px] text-muted-foreground/60 truncate w-full text-center">
                      {scene.action}
                    </div>
                  </div>
                ))}
              </div>

              {/* Credits estimate */}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 pt-0.5 border-t border-border/30">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" />
                  Est. {totalEstimatedCredits} credits
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="flex items-center gap-0.5"><ImageIcon className="w-2.5 h-2.5" />{sceneCount * 5}</span>
                  +
                  <span className="flex items-center gap-0.5"><Film className="w-2.5 h-2.5" />{sceneCount * 20}</span>
                </span>
              </div>

              {/* Expand fullscreen */}
              <button
                type="button"
                className="w-full h-6 flex items-center justify-center gap-1 text-[10px] font-medium rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setShowFullscreen(true)
                }}
              >
                <Maximize2 className="w-3 h-3" />
                Expand Storyboard
              </button>
            </div>
            <div className="absolute -top-1 -right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label="Copy text"
                className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                onClick={(e) => {
                  e.stopPropagation()
                  const scriptText = activeScript
                    ? [
                        activeScript.title,
                        "",
                        ...activeScript.scenes.map(
                          (s) => `Scene ${s.sceneNumber} (${s.durationHint}s): ${s.action}`
                        ),
                      ].join("\n")
                    : ""
                  copyToClipboard(scriptText, "Script copied")
                }}
              >
                <Copy className="w-3 h-3" />
              </button>
              {results.length > 0 && (
                <button
                  type="button"
                  aria-label="Remove"
                  className="w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(activeIndex)
                  }}
                  title="Delete this result"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {status === "failed" && !activeScript && (
          <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {status !== "running" && !activeScript && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <BookOpen className="w-5 h-5" />
          </div>
        )}

        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <button
                  type="button"
                  aria-label={`Result ${i + 1}`}
                  className={`w-8 h-8 flex items-center justify-center rounded cursor-pointer transition-opacity ${
                    i === activeIndex
                      ? "opacity-100 ring-2 ring-primary bg-primary/20"
                      : "opacity-50 hover:opacity-80 bg-muted"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, { activeResultIndex: i, generatedScript: r.script })
                  }}
                >
                  <FileText className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteConfirm(i)
                  }}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-between text-muted-foreground">
          <span>{nodeData.provider}</span>
          <span>{nodeData.sceneCount} scenes</span>
        </div>
      </div>
    </BaseNode>
    <HandleIcon icon={<Type />} color="pink" side="left" top="50%" />
    <HandleIcon icon={<BookOpen />} color="pink" side="right" top="10%" label="scenes" />
    <HandleIcon icon={<ImageIcon />} color="cyan" side="right" top="24%" label="images" />
    <HandleIcon icon={<MessageSquare />} color="orange" side="right" top="38%" label="dialogue" />
    <HandleIcon icon={<Music />} color="purple" side="right" top="52%" label="music" />
    <HandleIcon icon={<Volume2 />} color="emerald" side="right" top="66%" label="sfx" />
    <HandleIcon icon={<User />} color="pink" side="right" top="80%" label="characters" />
    <HandleIcon icon={<MapPin />} color="cyan" side="right" top="94%" label="locations" />
    {activeScript && showFullscreen && (
      <Suspense fallback={null}>
      <ScriptPreviewModal
        isOpen={showFullscreen}
        onClose={() => setShowFullscreen(false)}
        script={activeScript}
        onGenerateScene={(sceneIndex) =>
          generateSceneImage?.(id, sceneIndex) ?? Promise.resolve()
        }
        onSetActiveImage={(sceneIndex, imageIndex) => {
          if (!activeScript) return
          const updatedScenes = activeScript.scenes.map((s, i) =>
            i === sceneIndex ? { ...s, activeImageIndex: imageIndex } : s
          )
          const updatedScript = { ...activeScript, scenes: updatedScenes }
          updateNodeData(id, {
            generatedScript: updatedScript,
            ...(activeResult ? {
              generatedResults: results.map((r, i) =>
                i === activeIndex ? { ...r, script: updatedScript } : r
              ),
            } : {}),
          })
        }}
        onExpandToNodes={() => {
          setShowFullscreen(false)
          setShowExpandDialog(true)
        }}
        onCreateSceneNode={(sceneIndex) => {
          setShowFullscreen(false)
          createSceneNodeFromScript?.(id, sceneIndex)
        }}
        onUpdateScenes={(scenes) => {
          if (!activeScript) return
          const updatedScript = { ...activeScript, scenes }
          updateNodeData(id, {
            generatedScript: updatedScript,
            ...(activeResult ? {
              generatedResults: results.map((r, i) =>
                i === activeIndex ? { ...r, script: updatedScript } : r
              ),
            } : {}),
          })
        }}
        onUpdateSceneField={(sceneIndex, field, value) => {
          if (!activeScript) return
          const updatedScenes = activeScript.scenes.map((s, i) =>
            i === sceneIndex ? { ...s, [field]: value } : s
          )
          const updatedScript = { ...activeScript, scenes: updatedScenes }
          updateNodeData(id, {
            generatedScript: updatedScript,
            ...(activeResult ? {
              generatedResults: results.map((r, i) =>
                i === activeIndex ? { ...r, script: updatedScript } : r
              ),
            } : {}),
          })
        }}
        onUpdateSceneCharacters={(sceneIndex, characters) => {
          if (!activeScript) return
          const updatedScenes = activeScript.scenes.map((s, i) =>
            i === sceneIndex ? { ...s, characters } : s
          )
          const updatedScript = { ...activeScript, scenes: updatedScenes }
          updateNodeData(id, {
            generatedScript: updatedScript,
            ...(activeResult ? {
              generatedResults: results.map((r, i) =>
                i === activeIndex ? { ...r, script: updatedScript } : r
              ),
            } : {}),
          })
        }}
        extractedReferences={activeScript.extractedReferences ?? []}
        onSaveReferences={(references) => {
          if (!activeScript) return
          const updatedScript = { ...activeScript, extractedReferences: references }
          updateNodeData(id, {
            generatedScript: updatedScript,
            ...(activeResult ? {
              generatedResults: results.map((r, i) =>
                i === activeIndex ? { ...r, script: updatedScript } : r
              ),
            } : {}),
          })
        }}
        onDeleteImage={(sceneIndex, imageIndex) => {
          if (!activeScript) return
          const scene = activeScript.scenes[sceneIndex]
          const images = scene.generatedImages ?? []
          if (images.length <= 1) return
          const newImages = images.filter((_, i) => i !== imageIndex)
          const currentActive = scene.activeImageIndex ?? 0
          const newActive = imageIndex === currentActive
            ? 0
            : imageIndex < currentActive
              ? currentActive - 1
              : currentActive
          const updatedScenes = activeScript.scenes.map((s, i) =>
            i === sceneIndex ? { ...s, generatedImages: newImages, activeImageIndex: newActive } : s
          )
          const updatedScript = { ...activeScript, scenes: updatedScenes }
          updateNodeData(id, {
            generatedScript: updatedScript,
            ...(activeResult ? {
              generatedResults: results.map((r, i) =>
                i === activeIndex ? { ...r, script: updatedScript } : r
              ),
            } : {}),
          })
        }}
      />
      </Suspense>
    )}
    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />
    {activeScript && showExpandDialog && (
      <Suspense fallback={null}>
        <ExpandStoryboardDialog
          isOpen={showExpandDialog}
          onClose={() => setShowExpandDialog(false)}
          script={activeScript}
          onConfirm={(options: ExpandOptions) => {
            expandStoryboard?.(id, options)
          }}
        />
      </Suspense>
    )}
    </div>
  )
}

export const GenerateScriptNode = memo(GenerateScriptNodeComponent)
