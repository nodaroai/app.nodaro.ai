"use client"

import { useState, useRef, useCallback } from "react"
import { ArrowLeft, ChevronRight, Save, AlertTriangle, CheckCircle, Loader2, RefreshCw, Video, VideoOff, MoreVertical, Download, Upload, Package, FileJson } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"
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
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { validateWorkflow, type ValidationResult } from "@/lib/workflow-validation"
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

interface EditorToolbarProps {
  readonly projectId?: string
  readonly workflowId?: string
  readonly onSave: () => void
  readonly saving: boolean
  readonly onNavigate?: (href: string) => void
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

export function EditorToolbar({ projectId, onSave, saving, onNavigate }: EditorToolbarProps) {
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
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const setVideoAutoplay = useWorkflowStore((s) => s.setVideoAutoplay)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleValidate() {
    const result = validateWorkflow(nodes, edges)
    setValidation(result)
  }

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

      const workflowData: ExportedWorkflow = {
        name: workflowName || "Untitled Workflow",
        nodes: exportNodes,
        edges,
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
  }, [nodes, edges, workflowName])

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

        // Set the imported workflow using loadWorkflow
        const importedName = (data.name || "Untitled Workflow") + " (Imported)"
        loadWorkflow(
          workflowId || `temp-${Date.now()}`,
          importedName,
          nodesToImport,
          edgesToImport,
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
    <div className="flex items-center justify-between gap-2 px-2 sm:px-4 py-2 border-b bg-card">
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        {projectId && (
          <Button
            variant="ghost"
            size="sm"
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
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="w-28 sm:w-48 h-8 text-sm"
          />
          {isDirty && (
            <span className="text-destructive text-lg leading-none shrink-0" title="Unsaved changes">*</span>
          )}
        </div>

        {/* Save status indicator */}
        <div className="hidden sm:flex items-center gap-1 text-xs shrink-0">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Saving...</span>
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-600 dark:text-green-400">Saved</span>
            </>
          )}
          {saveStatus === "error" && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              <span className="text-destructive" title={saveError ?? undefined}>Save failed</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onSave}
                title="Retry save"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          )}
          {saveStatus === "idle" && isDirty && (
            <Badge variant="outline" className="text-xs">
              Unsaved
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {validation && (
          <div className="hidden sm:flex items-center gap-1 text-xs mr-2">
            {validation.valid ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            <span>
              {validation.errors.length} errors, {validation.warnings.length} warnings
            </span>
            <Badge variant="secondary" className="text-xs">
              ~{validation.estimatedCredits} credits
            </Badge>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={handleValidate} className="hidden sm:flex">
          Validate
        </Button>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json,application/json"
          onChange={handleFileSelect}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={exporting || importing}>
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

        <Button
          variant={isDirty ? "default" : "outline"}
          size="sm"
          onClick={onSave}
          disabled={saving || !isDirty}
        >
          <Save className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{saving ? "Saving..." : "Save"}</span>
          {isDirty && !saving && (
            <span className="ml-0.5 h-2 w-2 rounded-full bg-red-500 shrink-0" />
          )}
        </Button>

        <Button
          variant={videoAutoplay ? "default" : "ghost"}
          size="sm"
          onClick={() => setVideoAutoplay(!videoAutoplay)}
          title={videoAutoplay ? "Auto-playing videos" : "Videos paused"}
        >
          {videoAutoplay ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </Button>

        <ThemeToggle />
      </div>
    </div>
  )
}
