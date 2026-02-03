"use client"

import { useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { X, Loader2, Trash2, Plus, Maximize2, Sparkles, Expand } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { generateCharacterAsset, getJobStatus, deleteCharacter, generateImage, saveCharacter } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { CharacterNodeData, CharacterAssetItem } from "@/types/nodes"

type TabType = "main" | "expressions" | "poses" | "lighting" | "angles" | "custom"

const TABS: readonly { readonly id: TabType; readonly label: string }[] = [
  { id: "main", label: "Main" },
  { id: "expressions", label: "Expressions" },
  { id: "poses", label: "Poses" },
  { id: "lighting", label: "Lighting" },
  { id: "angles", label: "Angles" },
  { id: "custom", label: "Custom" },
]

interface CharacterPageModalProps {
  readonly characterNodeId: string
  readonly onClose: () => void
}

function startDrag(e: React.DragEvent, imageUrl: string, onDragStart?: () => void) {
  e.dataTransfer.setData("application/scenenode-image", imageUrl)
  e.dataTransfer.effectAllowed = "copy"
  onDragStart?.()
}

function InlineDeleteConfirm({
  onCancel,
  onConfirm,
}: {
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  return (
    <span className="flex items-center gap-1 text-[10px]">
      <span className="text-red-500 font-medium">Delete?</span>
      <button
        type="button"
        className="px-1.5 py-0.5 rounded text-[10px] bg-muted hover:bg-muted/80 text-muted-foreground"
        onClick={(e) => { e.stopPropagation(); onCancel() }}
      >
        Cancel
      </button>
      <button
        type="button"
        className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/90 hover:bg-red-500 text-white"
        onClick={(e) => { e.stopPropagation(); onConfirm() }}
      >
        Delete
      </button>
    </span>
  )
}

function DraggableImage({
  src,
  label,
  onEnlarge,
  onAddToCanvas,
  onDragStarted,
  onDragEnded,
  confirmingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  isMainImage,
}: {
  readonly src: string
  readonly label?: string
  readonly onEnlarge: (url: string) => void
  readonly onAddToCanvas?: (url: string) => void
  readonly onDragStarted?: () => void
  readonly onDragEnded?: () => void
  readonly confirmingDelete?: boolean
  readonly onRequestDelete?: () => void
  readonly onCancelDelete?: () => void
  readonly onConfirmDelete?: () => void
  readonly isMainImage?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative group">
        <img
          src={src}
          alt={label ?? "Character image"}
          draggable
          onDragStart={(e) => startDrag(e, src, onDragStarted)}
          onDragEnd={() => onDragEnded?.()}
          onClick={() => onEnlarge(src)}
          className={cn(
            "w-full rounded-lg cursor-pointer border border-border hover:border-primary/50 transition-colors",
            isMainImage ? "max-h-[400px] object-contain" : "aspect-square object-cover"
          )}
        />
        {/* Add to canvas button */}
        {onAddToCanvas && (
          <button
            type="button"
            className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center bg-primary text-primary-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-primary/90"
            onClick={(e) => { e.stopPropagation(); onAddToCanvas(src) }}
            title="Add to canvas"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
        {/* Enlarge button */}
        <button
          type="button"
          className="absolute bottom-1 left-1 p-1 rounded bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onEnlarge(src) }}
          title="Enlarge"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
        {onRequestDelete && !confirmingDelete && (
          <button
            type="button"
            className="absolute top-1 right-1 p-1 rounded bg-black/60 hover:bg-red-500/90 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); onRequestDelete() }}
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      {confirmingDelete ? (
        <InlineDeleteConfirm onCancel={onCancelDelete!} onConfirm={onConfirmDelete!} />
      ) : (
        label && <p className="text-xs text-muted-foreground text-center truncate">{label}</p>
      )}
    </div>
  )
}

function AssetGrid({
  items,
  onEnlarge,
  onAddToCanvas,
  onDragStarted,
  onDragEnded,
  emptyMessage,
  confirmingIndex,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  readonly items: readonly CharacterAssetItem[]
  readonly onEnlarge: (url: string) => void
  readonly onAddToCanvas?: (url: string) => void
  readonly onDragStarted?: () => void
  readonly onDragEnded?: () => void
  readonly emptyMessage: string
  readonly confirmingIndex: number | null
  readonly onRequestDelete: (index: number) => void
  readonly onCancelDelete: () => void
  readonly onConfirmDelete: (index: number) => void
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-12">
        {emptyMessage}
      </p>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-4">
      {items.map((item, i) => (
        <DraggableImage
          key={`${item.name}-${i}`}
          src={item.url}
          label={item.name}
          onEnlarge={onEnlarge}
          onAddToCanvas={onAddToCanvas}
          onDragStarted={onDragStarted}
          onDragEnded={onDragEnded}
          confirmingDelete={confirmingIndex === i}
          onRequestDelete={() => onRequestDelete(i)}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={() => onConfirmDelete(i)}
        />
      ))}
    </div>
  )
}

export function CharacterPageModal({ characterNodeId, onClose }: CharacterPageModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("main")
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [customPrompt, setCustomPrompt] = useState("")
  const [generating, setGenerating] = useState(false)
  const [confirmingAssetDelete, setConfirmingAssetDelete] = useState<number | null>(null)
  const [confirmingCharacterDelete, setConfirmingCharacterDelete] = useState(false)
  const [deletingCharacter, setDeletingCharacter] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isRefining, setIsRefining] = useState(false)
  const [refinedResults, setRefinedResults] = useState<string[]>([])
  const [showRefinePicker, setShowRefinePicker] = useState(false)
  const [selectedRefinedIndex, setSelectedRefinedIndex] = useState<number | null>(null)
  const [refineLightboxSrc, setRefineLightboxSrc] = useState<string | null>(null)
  const [refinementCompleted, setRefinementCompleted] = useState(false)
  const [generatingAllAssets, setGeneratingAllAssets] = useState(false)

  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const deleteNode = useWorkflowStore((s) => s.deleteNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const projectId = useWorkflowStore((s) => s.projectId)

  const node = nodes.find((n) => n.id === characterNodeId)
  if (!node || node.type !== "character") return null

  const data = node.data as CharacterNodeData
  const activeResult = (data.generatedResults ?? [])[data.activeResultIndex ?? 0]
  const mainImageUrl = activeResult?.url ?? data.sourceImageUrl

  // Add image to canvas as generate-image node with result already set
  const handleAddImageToCanvas = useCallback((imageUrl: string) => {
    // Position to the right of existing nodes
    const maxX = nodes.length > 0
      ? Math.max(...nodes.map((n) => n.position.x)) + 300
      : 200
    const avgY = nodes.length > 0
      ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
      : 200

    // Create generate-image node with the image already set as a result
    const nodeId = addNode("generate-image", { x: maxX, y: avgY }, {
      generatedResults: [{
        url: imageUrl,
        timestamp: new Date().toISOString(),
        jobId: `imported-${Date.now()}`,
      }],
      activeResultIndex: 0,
      executionStatus: "completed",
      generatedImageUrl: imageUrl,
    })
    if (nodeId) {
      selectNode(nodeId)
      toast.success("Image added to canvas")
      onClose()
    }
  }, [nodes, addNode, selectNode, onClose])

  // Refine character image - generate 4 clean versions
  const handleRefine = useCallback(async () => {
    if (!mainImageUrl) {
      toast.error("No image to refine")
      return
    }

    setIsRefining(true)
    setRefinedResults([])

    try {
      const characterName = data.characterName || "character"
      const description = data.description || ""

      const refinePrompt = `${characterName}${description ? `, ${description}` : ""}
Full body portrait, facing camera, neutral standing pose,
clean white background, studio lighting, looking at viewer,
centered composition, high quality, single character`

      toast.info("Generating refined versions...")

      // Generate 4 variations
      const results: string[] = []
      for (let i = 0; i < 4; i++) {
        try {
          const { jobId } = await generateImage(refinePrompt, [mainImageUrl])

          // Poll for result
          const imageUrl = await new Promise<string>((resolve, reject) => {
            const interval = setInterval(async () => {
              try {
                const job = await getJobStatus(jobId)
                if (job.status === "completed") {
                  clearInterval(interval)
                  resolve(job.output_data?.imageUrl ?? "")
                } else if (job.status === "failed") {
                  clearInterval(interval)
                  reject(new Error(job.error_message ?? "Failed"))
                }
              } catch (err) {
                clearInterval(interval)
                reject(err)
              }
            }, 2000)
          })

          if (imageUrl) {
            results.push(imageUrl)
            setRefinedResults([...results])
          }
        } catch (err) {
          console.error(`Failed to generate refined image ${i + 1}:`, err)
        }
      }

      if (results.length === 0) {
        throw new Error("Failed to generate any refined images")
      }

      setShowRefinePicker(true)
      setSelectedRefinedIndex(null)
    } catch (err) {
      toast.error("Failed to refine character", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setIsRefining(false)
    }
  }, [mainImageUrl, data.characterName, data.description])

  // Handle selecting a refined image
  const handleSelectRefined = useCallback(async (imageUrl: string) => {
    // Add to generatedResults
    const newResult = {
      url: imageUrl,
      timestamp: new Date().toISOString(),
      jobId: `refined-${Date.now()}`,
    }

    const updatedResults = [...(data.generatedResults ?? []), newResult]
    const newIndex = updatedResults.length - 1

    updateNodeData(characterNodeId, {
      generatedResults: updatedResults,
      activeResultIndex: newIndex,
      sourceImageUrl: imageUrl,
    })

    // Update in database if persisted
    if (data.characterDbId && projectId) {
      try {
        // Get user ID to ensure it's preserved in the update
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()

        await saveCharacter({
          id: data.characterDbId, // Pass ID to trigger UPDATE instead of INSERT
          userId: user?.id, // CRITICAL: Must pass userId to preserve ownership
          nodeId: characterNodeId,
          projectId,
          name: data.characterName,
          sourceImageUrl: imageUrl,
          description: data.description,
          style: data.style,
        })
        console.log("[Refine] Saved refined image to database:", imageUrl)
      } catch (err) {
        console.error("Failed to save refined image to database:", err)
      }
    }

    setShowRefinePicker(false)
    setRefinedResults([])
    setRefinementCompleted(true)
    toast.success("Refined image selected")
  }, [data, characterNodeId, projectId, updateNodeData])

  // Generate all character assets (expressions, poses, lighting, angles)
  const handleGenerateAllAssets = useCallback(async () => {
    const imageUrl = mainImageUrl
    if (!imageUrl) {
      toast.error("No portrait available")
      return
    }

    setGeneratingAllAssets(true)
    setRefinementCompleted(false)
    toast.info("Generating all character assets...")

    const ASSET_TYPES = [
      { type: "angles" as const, variants: ["front", "side", "back"], names: ["Front View", "Side View", "Back View"], dataKey: "angles" },
      { type: "expressions" as const, variants: ["neutral", "smile", "angry", "surprised", "sad", "talking"], names: ["Neutral", "Smile", "Angry", "Surprised", "Sad", "Talking"], dataKey: "expressions" },
      { type: "poses" as const, variants: ["standing", "walking", "sitting", "running"], names: ["Standing", "Walking", "Sitting", "Running"], dataKey: "poses" },
      { type: "lighting" as const, variants: ["daylight", "night", "dramatic"], names: ["Daylight", "Night", "Dramatic"], dataKey: "lightingVariations" },
    ]

    // Track accumulated assets locally (since data from closure doesn't update between iterations)
    const accumulatedAssets: Record<string, CharacterAssetItem[]> = {
      angles: [...(data.angles ?? [])],
      expressions: [...(data.expressions ?? [])],
      poses: [...(data.poses ?? [])],
      lightingVariations: [...(data.lightingVariations ?? [])],
    }

    try {
      for (const assetConfig of ASSET_TYPES) {
        for (let i = 0; i < assetConfig.variants.length; i++) {
          const variant = assetConfig.variants[i]
          const variantName = assetConfig.names[i]

          try {
            const { jobId } = await generateCharacterAsset({
              assetType: assetConfig.type,
              variant,
              name: data.characterName || "Character",
              description: data.description,
              gender: data.gender,
              style: data.style,
              baseOutfit: data.baseOutfit,
              sourceImageUrl: imageUrl,
            })

            // Poll for result
            const resultUrl = await new Promise<string>((resolve, reject) => {
              const interval = setInterval(async () => {
                try {
                  const job = await getJobStatus(jobId)
                  if (job.status === "completed") {
                    clearInterval(interval)
                    resolve(job.output_data?.imageUrl ?? "")
                  } else if (job.status === "failed") {
                    clearInterval(interval)
                    reject(new Error(job.error_message ?? "Failed"))
                  }
                } catch (err) {
                  clearInterval(interval)
                  reject(err)
                }
              }, 2000)
            })

            if (resultUrl) {
              // Add to local accumulator and update node data
              const newAsset = { name: variantName, url: resultUrl }
              accumulatedAssets[assetConfig.dataKey].push(newAsset)
              updateNodeData(characterNodeId, {
                [assetConfig.dataKey]: [...accumulatedAssets[assetConfig.dataKey]],
              })
            }
          } catch (err) {
            console.error(`Failed to generate ${assetConfig.type} ${variant}:`, err)
          }
        }
      }

      toast.success("All character assets generated!")
    } catch (err) {
      toast.error("Failed to generate some assets", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setGeneratingAllAssets(false)
    }
  }, [mainImageUrl, data, characterNodeId, updateNodeData])

  // Map tab to data key for asset deletion
  const ASSET_DATA_KEYS: Record<string, string> = {
    expressions: "expressions",
    poses: "poses",
    lighting: "lightingVariations",
    angles: "angles",
    custom: "customVariations",
  }

  function handleDeleteAsset(index: number) {
    const dataKey = ASSET_DATA_KEYS[activeTab]
    if (!dataKey) return

    if (activeTab === "custom") {
      const items = [...(data.customVariations ?? [])]
      items.splice(index, 1)
      updateNodeData(characterNodeId, { customVariations: items })
    } else {
      const items = [...((data as Record<string, unknown>)[dataKey] as CharacterAssetItem[])]
      items.splice(index, 1)
      updateNodeData(characterNodeId, { [dataKey]: items })
    }
    setConfirmingAssetDelete(null)
    toast.success("Asset deleted")
  }

  async function handleDeleteCharacter() {
    setDeletingCharacter(true)
    try {
      // Delete from database if persisted
      if (data.characterDbId) {
        await deleteCharacter(data.characterDbId)
      }
      // Remove node from canvas
      deleteNode(characterNodeId)
      toast.success(`Character "${data.characterName || "Unnamed"}" permanently deleted`)
      onClose()
    } catch (err) {
      toast.error("Failed to delete character", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setDeletingCharacter(false)
    }
  }

  const handleGenerateCustom = useCallback(async () => {
    if (!customPrompt.trim()) return
    if (!mainImageUrl) {
      toast.error("Generate or upload a main portrait first")
      return
    }

    setGenerating(true)
    try {
      const { jobId } = await generateCharacterAsset({
        assetType: "custom",
        variant: customPrompt.trim(),
        name: data.characterName,
        description: data.description || undefined,
        gender: data.gender || undefined,
        style: data.style || undefined,
        baseOutfit: data.baseOutfit || undefined,
        sourceImageUrl: mainImageUrl,
      })

      toast.info("Generating custom variation...")

      const imageUrl = await new Promise<string>((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const job = await getJobStatus(jobId)
            if (job.status === "completed") {
              clearInterval(interval)
              resolve(job.output_data?.imageUrl ?? "")
            } else if (job.status === "failed") {
              clearInterval(interval)
              reject(new Error(job.error_message ?? "Failed"))
            }
          } catch (err) {
            clearInterval(interval)
            reject(err)
          }
        }, 2000)
      })

      const newVariation = {
        prompt: customPrompt.trim(),
        url: imageUrl,
        createdAt: new Date().toISOString(),
      }

      const updated = [...(data.customVariations ?? []), newVariation]
      updateNodeData(characterNodeId, { customVariations: updated })
      toast.success("Custom variation generated")
      setCustomPrompt("")
    } catch (err) {
      toast.error("Failed to generate custom variation", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    } finally {
      setGenerating(false)
    }
  }, [customPrompt, mainImageUrl, data, characterNodeId, updateNodeData])

  // Reset confirming state when switching tabs
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setConfirmingAssetDelete(null)
  }

  return createPortal(
    <>
      <div
        className={cn(
          "fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity",
          isDragging && "pointer-events-none opacity-30"
        )}
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className={cn(
            "bg-card rounded-xl w-[800px] max-w-[92vw] max-h-[88vh] flex flex-col shadow-2xl border",
            isDragging && "pointer-events-none"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="border-b px-6 py-4 flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-lg font-semibold">
                {data.characterName || "Unnamed Character"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {data.style ?? "realistic"} | {data.gender ?? "other"}
                {data.baseOutfit ? ` | ${data.baseOutfit}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {confirmingCharacterDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500 max-w-[260px]">
                    Permanently delete {data.characterName || "this character"}? All assets will be lost. This cannot be undone.
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setConfirmingCharacterDelete(false)}
                    disabled={deletingCharacter}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDeleteCharacter}
                    disabled={deletingCharacter}
                  >
                    {deletingCharacter ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-1.5" />
                    )}
                    Delete Forever
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => setConfirmingCharacterDelete(true)}
                >
                  <Trash2 className="w-4 h-4 mr-1.5" />
                  Delete Character
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b px-6 flex gap-1 shrink-0 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={cn(
                  "px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
                {tab.id === "expressions" && data.expressions.length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">({data.expressions.length})</span>
                )}
                {tab.id === "poses" && data.poses.length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">({data.poses.length})</span>
                )}
                {tab.id === "lighting" && data.lightingVariations.length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">({data.lightingVariations.length})</span>
                )}
                {tab.id === "angles" && data.angles.length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">({data.angles.length})</span>
                )}
                {tab.id === "custom" && (data.customVariations ?? []).length > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">({(data.customVariations ?? []).length})</span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Main Tab */}
            {activeTab === "main" && (
              <div>
                {mainImageUrl ? (
                  <div className="mb-6">
                    <DraggableImage
                      src={mainImageUrl}
                      onEnlarge={setLightboxSrc}
                      onAddToCanvas={handleAddImageToCanvas}
                      onDragStarted={() => setIsDragging(true)}
                      onDragEnded={() => setIsDragging(false)}
                      isMainImage
                    />
                    {/* Refine Button */}
                    <Button
                      onClick={handleRefine}
                      disabled={isRefining}
                      className="w-full mt-3 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
                    >
                      {isRefining ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Refining... ({refinedResults.length}/4)
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          Refine Character
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center mt-1.5">
                      Generate a clean portrait with studio lighting
                    </p>

                    {/* Prominent CTA after refinement */}
                    {refinementCompleted && (
                      <div className="mt-4 p-4 bg-gradient-to-r from-pink-500/20 to-rose-500/20 rounded-lg border border-pink-500/50">
                        <div className="flex items-center gap-3">
                          <Sparkles className="w-6 h-6 text-pink-400 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-white">Character refined!</p>
                            <p className="text-sm text-gray-400">Generate expressions, poses, lighting & angles</p>
                          </div>
                          <Button
                            onClick={handleGenerateAllAssets}
                            disabled={generatingAllAssets}
                            className="bg-gradient-to-r from-pink-500 to-rose-500 text-white font-medium hover:from-pink-600 hover:to-rose-600 shrink-0"
                          >
                            {generatingAllAssets ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4 mr-2" />
                                Generate All Assets
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    No portrait generated yet. Generate or upload one from the config panel.
                  </p>
                )}

                {(data.generatedResults ?? []).length > 1 && (
                  <div>
                    <h3 className="text-sm font-medium mb-3">Version History</h3>
                    <div className="grid grid-cols-4 gap-3">
                      {(data.generatedResults ?? []).map((r, i) => (
                        <DraggableImage
                          key={r.jobId ?? i}
                          src={r.url}
                          label={`v${i + 1}`}
                          onEnlarge={setLightboxSrc}
                          onAddToCanvas={handleAddImageToCanvas}
                          onDragStarted={() => setIsDragging(true)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Expressions Tab */}
            {activeTab === "expressions" && (
              <AssetGrid
                items={data.expressions}
                onEnlarge={setLightboxSrc}
                onAddToCanvas={handleAddImageToCanvas}
                onDragStarted={() => setIsDragging(true)}
                onDragEnded={() => setIsDragging(false)}
                emptyMessage="No expressions generated yet. Generate them from the config panel."
                confirmingIndex={confirmingAssetDelete}
                onRequestDelete={setConfirmingAssetDelete}
                onCancelDelete={() => setConfirmingAssetDelete(null)}
                onConfirmDelete={handleDeleteAsset}
              />
            )}

            {/* Poses Tab */}
            {activeTab === "poses" && (
              <AssetGrid
                items={data.poses}
                onEnlarge={setLightboxSrc}
                onAddToCanvas={handleAddImageToCanvas}
                onDragStarted={() => setIsDragging(true)}
                onDragEnded={() => setIsDragging(false)}
                emptyMessage="No poses generated yet. Generate them from the config panel."
                confirmingIndex={confirmingAssetDelete}
                onRequestDelete={setConfirmingAssetDelete}
                onCancelDelete={() => setConfirmingAssetDelete(null)}
                onConfirmDelete={handleDeleteAsset}
              />
            )}

            {/* Lighting Tab */}
            {activeTab === "lighting" && (
              <AssetGrid
                items={data.lightingVariations}
                onEnlarge={setLightboxSrc}
                onAddToCanvas={handleAddImageToCanvas}
                onDragStarted={() => setIsDragging(true)}
                onDragEnded={() => setIsDragging(false)}
                emptyMessage="No lighting variations generated yet. Generate them from the config panel."
                confirmingIndex={confirmingAssetDelete}
                onRequestDelete={setConfirmingAssetDelete}
                onCancelDelete={() => setConfirmingAssetDelete(null)}
                onConfirmDelete={handleDeleteAsset}
              />
            )}

            {/* Angles Tab */}
            {activeTab === "angles" && (
              <AssetGrid
                items={data.angles}
                onEnlarge={setLightboxSrc}
                onAddToCanvas={handleAddImageToCanvas}
                onDragStarted={() => setIsDragging(true)}
                onDragEnded={() => setIsDragging(false)}
                emptyMessage="No angle views generated yet. Generate them from the config panel."
                confirmingIndex={confirmingAssetDelete}
                onRequestDelete={setConfirmingAssetDelete}
                onCancelDelete={() => setConfirmingAssetDelete(null)}
                onConfirmDelete={handleDeleteAsset}
              />
            )}

            {/* Custom Tab */}
            {activeTab === "custom" && (
              <div>
                <div className="mb-6">
                  <label className="text-sm font-medium mb-2 block">
                    Describe a new variation
                  </label>
                  <div className="flex gap-2">
                    <Input
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="e.g., sitting at a computer, holding a sword, wearing a red dress"
                      disabled={generating}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !generating && customPrompt.trim()) {
                          handleGenerateCustom()
                        }
                      }}
                    />
                    <Button
                      onClick={handleGenerateCustom}
                      disabled={!customPrompt.trim() || generating}
                      className="shrink-0"
                    >
                      {generating ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Generate"
                      )}
                    </Button>
                  </div>
                </div>

                {(data.customVariations ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    No custom variations yet. Describe a pose, outfit, or scene above.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {(data.customVariations ?? []).map((v, i) => (
                      <DraggableImage
                        key={`${v.createdAt}-${i}`}
                        src={v.url}
                        label={v.prompt}
                        onEnlarge={setLightboxSrc}
                        onAddToCanvas={handleAddImageToCanvas}
                        onDragStarted={() => setIsDragging(true)}
                        onDragEnded={() => setIsDragging(false)}
                        confirmingDelete={confirmingAssetDelete === i}
                        onRequestDelete={() => setConfirmingAssetDelete(i)}
                        onCancelDelete={() => setConfirmingAssetDelete(null)}
                        onConfirmDelete={() => handleDeleteAsset(i)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

      {/* Refine Picker Modal */}
      {showRefinePicker && refinedResults.length > 0 && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowRefinePicker(false)}
        >
          <div
            className="bg-card rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Select Refined Image</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowRefinePicker(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Click to select, use expand button to preview full size
            </p>
            <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto">
              {refinedResults.map((url, i) => (
                <div
                  key={i}
                  className={cn(
                    "relative cursor-pointer rounded-lg border-2 transition-all group",
                    selectedRefinedIndex === i
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50"
                  )}
                  onClick={() => setSelectedRefinedIndex(i)}
                >
                  <img
                    src={url}
                    alt={`Refined ${i + 1}`}
                    className="w-full h-36 object-cover rounded-lg"
                  />
                  {/* Expand button */}
                  <button
                    type="button"
                    className="absolute bottom-2 left-2 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRefineLightboxSrc(url)
                    }}
                  >
                    <Expand className="w-4 h-4" />
                  </button>
                  {selectedRefinedIndex === i && (
                    <div className="absolute top-2 right-2 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <span className="text-primary-foreground text-xs font-bold">✓</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowRefinePicker(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => selectedRefinedIndex !== null && handleSelectRefined(refinedResults[selectedRefinedIndex])}
                disabled={selectedRefinedIndex === null}
                className="bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600"
              >
                Use This Image
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Refine Lightbox */}
      {refineLightboxSrc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
          onClick={() => setRefineLightboxSrc(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            onClick={() => setRefineLightboxSrc(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={refineLightboxSrc}
            alt="Full size preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
          />
        </div>
      )}
    </>,
    document.body,
  )
}
