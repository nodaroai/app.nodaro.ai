"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { ArrowLeft, ChevronRight, Save, CheckCircle, Loader2, RefreshCw, Play, Pause, MoreVertical, Download, Upload, Package, FileJson, FileText } from "lucide-react"
import { CreditBalance } from "@/components/credits/CreditBalance"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { FlowTemplatesDialog } from "./flow-templates-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProjectsStore } from "@/hooks/use-projects-store"
import {
  getCharacterById,
  getObjectById,
  getLocationById,
  saveCharacter,
  saveObject,
  saveLocation,
  type DbCharacter,
  type DbObject,
  type DbLocation,
} from "@/lib/api"
import { createClient } from "@/lib/supabase"
import type { WorkflowNode, WorkflowEdge, CharacterNodeData, ObjectNodeData, LocationNodeData } from "@/types/nodes"

type EditorTab = "editor" | "executions" | "cost"

interface EditorToolbarProps {
  readonly projectId?: string
  readonly workflowId?: string
  readonly onSave: () => void
  readonly saving: boolean
  readonly onNavigate?: (href: string) => void
  readonly activeTab?: EditorTab
  readonly onTabChange?: (tab: EditorTab) => void
}

interface ExportedWorkflow {
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  settings?: Record<string, unknown>
  exportedAt: string
  version: string
  assets?: {
    characters: DbCharacter[]
    objects: DbObject[]
    locations: DbLocation[]
  }
}

export function EditorToolbar({ projectId, onSave, saving, onNavigate, activeTab = "editor", onTabChange }: EditorToolbarProps) {
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const saveStatus = useWorkflowStore((s) => s.saveStatus)
  const saveError = useWorkflowStore((s) => s.saveError)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow)
  const project = useProjectsStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) : undefined,
  )
  const flowTemplates = useWorkflowStore((s) => s.flowPromptTemplates)
  const userTemplates = useWorkflowStore((s) => s.userPromptTemplates)
  const setFlowPromptTemplates = useWorkflowStore((s) => s.setFlowPromptTemplates)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const setVideoAutoplay = useWorkflowStore((s) => s.setVideoAutoplay)
  const [flowTemplatesOpen, setFlowTemplatesOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showSavedState, setShowSavedState] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [userId, setUserId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }: { data: { user: any } }) => {
      setUserId(user?.id ?? undefined)
    })
  }, [])

  // Show "Saved" state for 1.5 seconds after successful save
  useEffect(() => {
    if (saveStatus === "saved" && !isDirty) {
      setShowSavedState(true)
      const timer = setTimeout(() => {
        setShowSavedState(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [saveStatus, isDirty])

  // Strip generated content from nodes for template export
  const stripGeneratedContent = (nodesToStrip: WorkflowNode[]): WorkflowNode[] => {
    return nodesToStrip.map(node => {
      // Use a mutable copy with loose typing for modifications
      const data = { ...node.data } as Record<string, unknown>

      switch (node.type) {
        case "character":
          // Clear character generated content
          data.sourceImageUrl = undefined
          data.generatedResults = []
          data.generatedImageUrl = undefined
          data.expressions = []
          data.poses = []
          data.lightingVariations = []
          data.angles = []
          data.customVariations = []
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "object":
          // Clear object generated content
          data.sourceImageUrl = undefined
          data.generatedResults = []
          data.generatedImageUrl = undefined
          data.angles = []
          data.materials = []
          data.variations = []
          data.customVariations = []
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "location":
          // Clear location generated content
          data.sourceImageUrl = undefined
          data.generatedResults = []
          data.generatedImageUrl = undefined
          data.timeOfDay = []
          data.weather = []
          data.angles = []
          data.customVariations = []
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "generate-image":
        case "edit-image":
        case "image-to-image":
          // Clear generated image results, keep settings
          data.generatedResults = []
          data.generatedImageUrl = undefined
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "image-to-video":
        case "video-to-video":
        case "text-to-video":
          // Clear generated video results, keep settings
          data.generatedResults = []
          data.generatedVideoUrl = undefined
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "generate-script":
          // Clear generated script results, keep settings
          data.generatedResults = []
          data.generatedScript = undefined
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "text-to-speech":
          // Clear generated audio results, keep settings
          data.generatedResults = []
          data.generatedAudioUrl = undefined
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "generate-music":
        case "text-to-audio":
          // Clear generated audio results, keep settings
          data.generatedResults = []
          data.generatedAudioUrl = undefined
          data.activeResultIndex = 0
          data.executionStatus = undefined
          break

        case "scene":
          // Clear scene generated content
          data.generatedResults = []
          data.generatedImageUrl = undefined
          data.generatedVideoResults = []
          data.generatedVideoUrl = undefined
          data.activeResultIndex = 0
          data.activeVideoResultIndex = 0
          data.executionStatus = undefined
          data.videoExecutionStatus = undefined
          // Clear dialogue audio
          if (Array.isArray(data.dialogue)) {
            data.dialogue = (data.dialogue as Array<Record<string, unknown>>).map(d => ({
              ...d,
              generatedAudioResults: [],
              activeAudioIndex: 0,
            }))
          }
          break

        case "upload-image":
        case "upload-video":
          // Clear uploaded content
          data.assetId = undefined
          data.url = undefined
          data.thumbnailUrl = undefined
          break

        case "youtube-video":
          data.youtubeUrl = ""
          data.videoId = ""
          data.title = ""
          data.thumbnailUrl = ""
          break

        case "transcribe":
          data.generatedResults = []
          data.activeResultIndex = 0
          data.generatedText = undefined
          data.executionStatus = undefined
          data.errorMessage = undefined
          break

        case "ai-writer":
          data.generatedResults = []
          data.activeResultIndex = 0
          data.generatedText = undefined
          data.generatedItems = undefined
          data.executionStatus = undefined
          data.errorMessage = undefined
          break

        default:
          // For any other node type, clear common generated fields
          if ('generatedResults' in data) {
            data.generatedResults = []
          }
          if ('activeResultIndex' in data) {
            data.activeResultIndex = 0
          }
          if ('executionStatus' in data) {
            data.executionStatus = undefined
          }
          break
      }

      return { ...node, data } as WorkflowNode
    })
  }

  const handleExport = useCallback(async (includeAssets: boolean) => {
    setExporting(true)
    try {
      // For template export, strip all generated content from nodes
      const exportNodes = includeAssets ? nodes : stripGeneratedContent(nodes)

      const hasFlowTemplates = Object.keys(flowTemplates).length > 0

      const workflowData: ExportedWorkflow = {
        name: workflowName || "Untitled Workflow",
        nodes: exportNodes,
        edges,
        ...(hasFlowTemplates ? { settings: { flowPromptTemplates: flowTemplates } } : {}),
        exportedAt: new Date().toISOString(),
        version: "1.0",
      }

      if (includeAssets) {
        // Collect all referenced asset IDs from nodes
        const characterIds = new Set<string>()
        const objectIds = new Set<string>()
        const locationIds = new Set<string>()

        for (const node of nodes) {
          if (node.type === "character") {
            const data = node.data as CharacterNodeData
            if (data.characterDbId) {
              characterIds.add(data.characterDbId)
            }
          } else if (node.type === "object") {
            const data = node.data as ObjectNodeData
            if (data.objectDbId) {
              objectIds.add(data.objectDbId)
            }
          } else if (node.type === "location") {
            const data = node.data as LocationNodeData
            if (data.locationDbId) {
              locationIds.add(data.locationDbId)
            }
          }
        }

        // Fetch full asset data from database
        const characters: DbCharacter[] = []
        const objects: DbObject[] = []
        const locations: DbLocation[] = []

        for (const id of characterIds) {
          try {
            const char = await getCharacterById(id)
            if (char) characters.push(char)
          } catch (err) {
            console.error(`Failed to fetch character ${id}:`, err)
          }
        }

        for (const id of objectIds) {
          try {
            const obj = await getObjectById(id)
            if (obj) objects.push(obj)
          } catch (err) {
            console.error(`Failed to fetch object ${id}:`, err)
          }
        }

        for (const id of locationIds) {
          try {
            const loc = await getLocationById(id)
            if (loc) locations.push(loc)
          } catch (err) {
            console.error(`Failed to fetch location ${id}:`, err)
          }
        }

        if (characters.length > 0 || objects.length > 0 || locations.length > 0) {
          workflowData.assets = { characters, objects, locations }
        }
      }

      // Download as JSON file
      const blob = new Blob([JSON.stringify(workflowData, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const safeName = (workflowName || "workflow").replace(/[^a-z0-9]/gi, "-").toLowerCase()
      a.download = `${safeName}-${includeAssets ? "with-assets" : "template"}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(includeAssets ? "Exported workflow with assets" : "Exported workflow template")
    } catch (err) {
      console.error("Export failed:", err)
      toast.error("Export failed: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setExporting(false)
    }
  }, [nodes, edges, workflowName, flowTemplates])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string) as ExportedWorkflow

        // Validate structure
        if (!data.nodes || !Array.isArray(data.nodes)) {
          throw new Error("Invalid workflow file: missing nodes array")
        }
        if (!data.edges || !Array.isArray(data.edges)) {
          throw new Error("Invalid workflow file: missing edges array")
        }

        setImporting(true)

        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        const userId = user?.id

        let nodesToImport = [...data.nodes]
        const assetIdMap: Record<string, string> = {} // old ID -> new ID mapping

        // Import assets if they exist
        if (data.assets) {
          const { characters, objects, locations } = data.assets

          // Import characters
          for (const char of characters || []) {
            try {
              const result = await saveCharacter({
                userId: userId,
                nodeId: char.nodeId,
                projectId: projectId,
                name: char.name,
                description: char.description ?? undefined,
                gender: char.gender ?? undefined,
                style: char.style ?? undefined,
                baseOutfit: char.baseOutfit ?? undefined,
                sourceImageUrl: char.sourceImageUrl ?? undefined,
                expressions: char.expressions ?? [],
                poses: char.poses ?? [],
                lightingVariations: char.lightingVariations ?? [],
              })
              assetIdMap[char.id] = result.id
            } catch (err) {
              console.error(`Failed to import character ${char.name}:`, err)
            }
          }

          // Import objects
          for (const obj of objects || []) {
            try {
              const result = await saveObject({
                userId: userId,
                nodeId: obj.nodeId,
                projectId: projectId,
                name: obj.name,
                description: obj.description ?? undefined,
                category: obj.category ?? undefined,
                style: obj.style ?? undefined,
                sourceImageUrl: obj.sourceImageUrl ?? undefined,
                angles: obj.angles ?? [],
                materials: obj.materials ?? [],
                variations: obj.variations ?? [],
              })
              assetIdMap[obj.id] = result.id
            } catch (err) {
              console.error(`Failed to import object ${obj.name}:`, err)
            }
          }

          // Import locations
          for (const loc of locations || []) {
            try {
              const result = await saveLocation({
                userId: userId,
                nodeId: loc.nodeId,
                projectId: projectId,
                name: loc.name,
                description: loc.description ?? undefined,
                category: loc.category ?? undefined,
                style: loc.style ?? undefined,
                sourceImageUrl: loc.sourceImageUrl ?? undefined,
                timeOfDay: loc.timeOfDay ?? [],
                weather: loc.weather ?? [],
                angles: loc.angles ?? [],
              })
              assetIdMap[loc.id] = result.id
            } catch (err) {
              console.error(`Failed to import location ${loc.name}:`, err)
            }
          }

          // Update node references to use new asset IDs
          nodesToImport = nodesToImport.map(node => {
            if (node.type === "character") {
              const nodeData = node.data as CharacterNodeData
              if (nodeData.characterDbId && assetIdMap[nodeData.characterDbId]) {
                return {
                  ...node,
                  data: {
                    ...nodeData,
                    characterDbId: assetIdMap[nodeData.characterDbId],
                  },
                }
              }
            } else if (node.type === "object") {
              const nodeData = node.data as ObjectNodeData
              if (nodeData.objectDbId && assetIdMap[nodeData.objectDbId]) {
                return {
                  ...node,
                  data: {
                    ...nodeData,
                    objectDbId: assetIdMap[nodeData.objectDbId],
                  },
                }
              }
            } else if (node.type === "location") {
              const nodeData = node.data as LocationNodeData
              if (nodeData.locationDbId && assetIdMap[nodeData.locationDbId]) {
                return {
                  ...node,
                  data: {
                    ...nodeData,
                    locationDbId: assetIdMap[nodeData.locationDbId],
                  },
                }
              }
            }
            return node
          })
        }

        // Generate new node IDs to avoid conflicts
        const nodeIdMap: Record<string, string> = {}
        nodesToImport = nodesToImport.map(node => {
          const newId = `${node.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          nodeIdMap[node.id] = newId
          return { ...node, id: newId }
        })

        // Update edge references
        const edgesToImport = data.edges.map(edge => ({
          ...edge,
          id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          source: nodeIdMap[edge.source] || edge.source,
          target: nodeIdMap[edge.target] || edge.target,
        }))

        // Extract flow-level prompt templates from settings if present
        const importedFlowTemplates =
          (data.settings?.flowPromptTemplates as Record<string, string> | undefined) ?? {}

        // Set the imported workflow using loadWorkflow
        const importedName = (data.name || "Untitled Workflow") + " (Imported)"
        loadWorkflow(
          workflowId || `temp-${Date.now()}`,
          importedName,
          nodesToImport,
          edgesToImport,
          undefined,
          Object.keys(importedFlowTemplates).length > 0 ? importedFlowTemplates : undefined,
        )

        const assetCount = Object.keys(assetIdMap).length
        toast.success(
          assetCount > 0
            ? `Imported workflow with ${assetCount} assets`
            : "Imported workflow"
        )
      } catch (err) {
        console.error("Invalid file:", err)
        toast.error("Invalid file: " + (err instanceof Error ? err.message : "Could not parse JSON"))
      } finally {
        setImporting(false)
      }
    }
    reader.readAsText(file)

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [projectId, workflowId, loadWorkflow])

  return (
    <div className="flex items-center justify-between gap-2 px-2 sm:px-4 h-[41px] border-b border-gray-200 dark:border-border bg-white dark:bg-card">
      {/* Left section: Back, Breadcrumbs, Workflow name */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        {projectId && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Back to project"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => onNavigate ? onNavigate(`/projects/${projectId}`) : undefined}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Breadcrumbs - hidden on small screens */}
        <nav className="hidden sm:flex items-center gap-1 text-sm shrink-0">
          <button
            type="button"
            onClick={() => onNavigate?.("/projects")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Dashboard
          </button>
          {project && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button
                type="button"
                onClick={() => onNavigate?.(`/projects/${projectId}`)}
                className="text-muted-foreground hover:text-foreground transition-colors max-w-[120px] truncate"
              >
                {project.name}
              </button>
            </>
          )}
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </nav>

        <div className="flex items-center gap-0.5 min-w-0">
          <Input
            aria-label="Workflow name"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="w-28 sm:w-48 h-8 text-sm"
          />
        </div>

      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {userId && <CreditBalance userId={userId} />}

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json,application/json"
          onChange={handleFileSelect}
        />

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="Prompt Templates"
                className="relative"
                onClick={() => setFlowTemplatesOpen(true)}
              >
                <FileText className="h-4 w-4" />
                {Object.keys(flowTemplates).length > 0 && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[#ff0073] border-2 border-white dark:border-card" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Prompt Templates</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <FlowTemplatesDialog
          open={flowTemplatesOpen}
          onOpenChange={setFlowTemplatesOpen}
          flowTemplates={flowTemplates}
          userTemplates={userTemplates}
          onSave={setFlowPromptTemplates}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="More options" disabled={exporting || importing}>
              {(exporting || importing) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreVertical className="h-4 w-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download className="h-4 w-4 mr-2" />
                Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => handleExport(true)}>
                  <Package className="h-4 w-4 mr-2" />
                  With Assets
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport(false)}>
                  <FileJson className="h-4 w-4 mr-2" />
                  Template Only
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Import from file...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Save Button with integrated state indicator */}
        {(() => {
          // Determine save button state
          const isSaving = saving || saveStatus === "saving"
          const isSaved = showSavedState && !isDirty
          const isUnsaved = isDirty && !isSaving
          const hasError = saveStatus === "error"
          const isIdle = !isDirty && !isSaving && !isSaved && !hasError

          // Button styling based on state
          let buttonStyle: React.CSSProperties = {}
          let buttonClassName = "transition-all duration-300 "

          if (isSaving || isUnsaved || isSaved) {
            // Pink for unsaved, saving, and saved states
            buttonStyle = { backgroundColor: '#ff0073', borderColor: '#ff0073' }
            buttonClassName += "text-white hover:opacity-90"
          } else if (hasError) {
            // Red for error state
            buttonStyle = { backgroundColor: '#ef4444', borderColor: '#ef4444' }
            buttonClassName += "text-white hover:opacity-90"
          } else {
            // Muted for idle state
            buttonClassName += "bg-gray-100 text-gray-400 border-gray-200 dark:bg-muted dark:text-muted-foreground dark:border-border cursor-default"
          }

          // Button text
          let buttonText = "Saved"
          if (isSaving) buttonText = "Saving..."
          else if (isSaved) buttonText = "Saved"
          else if (hasError) buttonText = "Retry"
          else if (isUnsaved) buttonText = "Unsaved"

          return (
            <Button
              variant="outline"
              size="sm"
              onClick={onSave}
              disabled={isSaving || isIdle}
              aria-label={buttonText}
              className={buttonClassName}
              style={buttonStyle}
              title={hasError ? saveError ?? "Save failed" : undefined}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin sm:mr-1" />
              ) : isSaved ? (
                <CheckCircle className="h-4 w-4 text-green-300 sm:mr-1" />
              ) : hasError ? (
                <RefreshCw className="h-4 w-4 sm:mr-1" />
              ) : isUnsaved ? (
                <Save className="h-4 w-4 sm:mr-1" />
              ) : (
                <CheckCircle className="h-4 w-4 sm:mr-1" />
              )}
              <span className="hidden sm:inline">{buttonText}</span>
            </Button>
          )
        })()}

        <Button
          variant="outline"
          size="sm"
          onClick={() => setVideoAutoplay(!videoAutoplay)}
          aria-label={videoAutoplay ? "Pause video autoplay" : "Enable video autoplay"}
          title={videoAutoplay ? "Auto-playing videos" : "Videos paused"}
          className={videoAutoplay ? "text-white hover:opacity-90" : ""}
          style={videoAutoplay ? { backgroundColor: '#ff0073', borderColor: '#ff0073' } : undefined}
        >
          {videoAutoplay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
