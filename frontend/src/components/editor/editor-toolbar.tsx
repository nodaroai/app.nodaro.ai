"use client"

import { useState, useRef, useCallback, useEffect, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { ArrowLeft, Braces, ChevronRight, Save, CheckCircle, Loader2, RefreshCw, Play, Pause, MoreVertical, Download, Upload, Package, FileJson, FileText, ClipboardPaste } from "lucide-react"
import { CreditBalance } from "@/ee/components/credits/CreditBalance"
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
const FlowTemplatesDialog = lazy(() => import("./flow-templates-dialog").then(m => ({ default: m.FlowTemplatesDialog })))
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProjectsStore } from "@/hooks/use-projects-store"
import {
  exportWorkflow,
  importWorkflow,
  saveCharacter,
  saveObject,
  saveLocation,
  type DbCharacter,
  type DbObject,
  type DbLocation,
} from "@/lib/api"
import {
  buildSaveCharacterPayloadFromExport,
  buildSaveObjectPayloadFromExport,
  buildSaveLocationPayloadFromExport,
} from "./editor-toolbar-inject-helpers"
import { createClient } from "@/lib/supabase"
import type { WorkflowExport } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge, CharacterNodeData, ObjectNodeData, LocationNodeData } from "@/types/nodes"

type EditorTab = "editor" | "present" | "executions" | "cost"

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
  const edges = useWorkflowStore((s) => s.edges)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const saveStatus = useWorkflowStore((s) => s.saveStatus)
  const saveError = useWorkflowStore((s) => s.saveError)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const project = useProjectsStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) : undefined,
  )
  const flowTemplates = useWorkflowStore((s) => s.flowPromptTemplates)
  const userTemplates = useWorkflowStore((s) => s.userPromptTemplates)
  const setFlowPromptTemplates = useWorkflowStore((s) => s.setFlowPromptTemplates)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const setVideoAutoplay = useWorkflowStore((s) => s.setVideoAutoplay)
  const variableDisplayMode = useWorkflowStore((s) => s.variableDisplayMode)
  const setVariableDisplayMode = useWorkflowStore((s) => s.setVariableDisplayMode)
  const [flowTemplatesOpen, setFlowTemplatesOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showSavedState, setShowSavedState] = useState(false)
  const [pendingImportData, setPendingImportData] = useState<ExportedWorkflow | null>(null)
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

  const handleExport = useCallback(async (includeAssets: boolean) => {
    if (!workflowId || workflowId.startsWith("temp-")) {
      toast.error("Save the workflow before exporting")
      return
    }
    setExporting(true)
    try {
      // Backend builds the portable bundle: with `assets` it inlines referenced
      // characters/objects/locations; without it, generated/transient content is
      // stripped from nodes server-side (stripExportContent in @nodaro/shared).
      const workflowData = await exportWorkflow(workflowId, { assets: includeAssets })

      // Download as JSON file
      const blob = new Blob([JSON.stringify(workflowData, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const safeName = (workflowName || workflowData.name || "workflow").replace(/[^a-z0-9]/gi, "-").toLowerCase()
      a.download = `${safeName}-${includeAssets ? "with-assets" : "template"}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(includeAssets ? "Exported workflow with assets" : "Exported workflow template")
    } catch (err) {
      toast.error("Export failed: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setExporting(false)
    }
  }, [workflowId, workflowName])

  function parseWorkflowJson(jsonStr: string): ExportedWorkflow {
    const raw = JSON.parse(jsonStr) as Record<string, unknown>
    // Tutorial/seed format wraps the workflow: `{ meta, workflow: { name, nodes, edges, ... } }`.
    // Unwrap so downstream import logic sees the flat ExportedWorkflow shape.
    const inner = (raw.workflow && typeof raw.workflow === "object" && raw.workflow !== null
      && "nodes" in (raw.workflow as object))
      ? (raw.workflow as Record<string, unknown>)
      : raw
    const data = inner as unknown as ExportedWorkflow
    if (!data.nodes || !Array.isArray(data.nodes)) throw new Error("Missing nodes array")
    if (!data.edges || !Array.isArray(data.edges)) throw new Error("Missing edges array")
    return data
  }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = parseWorkflowJson(event.target?.result as string)
        setPendingImportData(data)
      } catch (err) {
        toast.error("Invalid file: " + (err instanceof Error ? err.message : "Could not parse JSON"))
      }
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [])

  const handleClipboardImport = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      const data = parseWorkflowJson(text)
      setPendingImportData(data)
    } catch (err) {
      toast.error("Clipboard import failed: " + (err instanceof Error ? err.message : "Could not read clipboard or invalid JSON"))
    }
  }, [])

  // Build the portable WorkflowExport payload the backend expects from a parsed
  // file/clipboard blob. Coerces the version (older exports used "1.0") and lets
  // the backend Zod schema strip any extra asset fields (category, userId, …).
  function toWorkflowExportPayload(data: ExportedWorkflow): WorkflowExport {
    const name = ((data.name || "Untitled Workflow") + " (Imported)").slice(0, 200)
    return {
      version: 1,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
      name,
      nodes: data.nodes as unknown as WorkflowExport["nodes"],
      edges: data.edges as unknown as WorkflowExport["edges"],
      ...(data.settings ? { settings: data.settings } : {}),
      ...(data.assets ? { assets: data.assets as unknown as WorkflowExport["assets"] } : {}),
    }
  }

  const handleImportAsNew = useCallback(async (data: ExportedWorkflow) => {
    setImporting(true)
    try {
      // Backend re-creates bundled assets under the caller and remaps the entity
      // DB-id references on nodes, then inserts a fresh workflow row.
      const created = await importWorkflow({ ...toWorkflowExportPayload(data), projectId: projectId! })
      const assetCount = (data.assets?.characters.length ?? 0) + (data.assets?.objects.length ?? 0) + (data.assets?.locations.length ?? 0)
      toast.success(assetCount > 0 ? `Imported workflow with ${assetCount} assets` : "Imported workflow")
      onNavigate?.(`/projects/${created.projectId}/workflows/${created.id}`)
    } catch (err) {
      toast.error("Import failed: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setImporting(false)
    }
  }, [projectId, onNavigate])

  // Inject mode merges the imported nodes onto the *current* canvas (no new
  // workflow row). Bundled assets are re-created via the backend asset routes;
  // node/edge id remapping and the offset layout are pure client-side work.
  const handleInject = useCallback(async (data: ExportedWorkflow) => {
    setImporting(true)
    try {
      let nodesToImport = [...data.nodes]
      const assetIdMap: Record<string, string> = {}

      if (data.assets) {
        const { characters, objects, locations } = data.assets

        for (const char of characters || []) {
          try {
            const result = await saveCharacter(buildSaveCharacterPayloadFromExport(char, projectId))
            assetIdMap[char.id] = result.id
          } catch { /* skip — inject continues with remaining assets */ }
        }

        for (const obj of objects || []) {
          try {
            const result = await saveObject(buildSaveObjectPayloadFromExport(obj, projectId))
            assetIdMap[obj.id] = result.id
          } catch { /* skip */ }
        }

        for (const loc of locations || []) {
          try {
            // BUG FIX (Phase 2 #6): payload helper forwards Location Studio
            // Phase 1 fields (lighting, seasons, atmosphereMotions,
            // referencePhotos, canonicalDescription, styleLock) that the old
            // inline call silently dropped. Without these, opening Location
            // Studio on the re-imported node showed empty lighting / atmosphere
            // / mood-board, then any subsequent save would null out
            // canonical_description and reset style_lock.
            const result = await saveLocation(buildSaveLocationPayloadFromExport(loc, projectId))
            assetIdMap[loc.id] = result.id
          } catch { /* skip */ }
        }

        // Point node references at the freshly-created asset rows.
        nodesToImport = nodesToImport.map(node => {
          if (node.type === "character") {
            const nd = node.data as CharacterNodeData
            if (nd.characterDbId && assetIdMap[nd.characterDbId])
              return { ...node, data: { ...nd, characterDbId: assetIdMap[nd.characterDbId] } }
          } else if (node.type === "object") {
            const nd = node.data as ObjectNodeData
            if (nd.objectDbId && assetIdMap[nd.objectDbId])
              return { ...node, data: { ...nd, objectDbId: assetIdMap[nd.objectDbId] } }
          } else if (node.type === "location") {
            const nd = node.data as LocationNodeData
            if (nd.locationDbId && assetIdMap[nd.locationDbId])
              return { ...node, data: { ...nd, locationDbId: assetIdMap[nd.locationDbId] } }
          }
          return node
        })
      }

      // Generate new node IDs to avoid conflicts with the existing canvas.
      const nodeIdMap: Record<string, string> = {}
      nodesToImport = nodesToImport.map(node => {
        const newId = `${node.type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        nodeIdMap[node.id] = newId
        return { ...node, id: newId }
      })

      // Remap fieldMappings sourceNodeIds to new IDs
      nodesToImport = nodesToImport.map(node => {
        const fm = (node.data as Record<string, unknown>)?.fieldMappings as Record<string, { sourceNodeId: string }> | undefined
        if (!fm) return node
        let changed = false
        const newFm: Record<string, { sourceNodeId: string }> = {}
        for (const [field, mapping] of Object.entries(fm)) {
          if (mapping?.sourceNodeId && nodeIdMap[mapping.sourceNodeId]) {
            newFm[field] = { sourceNodeId: nodeIdMap[mapping.sourceNodeId] }
            changed = true
          } else {
            newFm[field] = mapping
          }
        }
        if (!changed) return node
        return { ...node, data: { ...node.data, fieldMappings: newFm } }
      })

      // Update edge references
      const edgesToImport = data.edges.map(edge => ({
        ...edge,
        id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        source: nodeIdMap[edge.source] || edge.source,
        target: nodeIdMap[edge.target] || edge.target,
      }))

      const importedFlowTemplates =
        (data.settings?.flowPromptTemplates as Record<string, string> | undefined) ?? {}

      // Inject: offset imported nodes to the right of existing nodes
      const state = useWorkflowStore.getState()
      let offsetX = 0
      if (state.nodes.length > 0 && nodesToImport.length > 0) {
        const maxX = Math.max(...state.nodes.map(n => n.position.x + (n.measured?.width ?? 260)))
        const minX = Math.min(...nodesToImport.map(n => n.position.x))
        offsetX = maxX - minX + 100
      }

      const offsetNodes = nodesToImport.map(n => ({
        ...n,
        position: { x: n.position.x + offsetX, y: n.position.y },
      }))

      useWorkflowStore.setState({
        nodes: [...state.nodes, ...offsetNodes],
        edges: [...state.edges, ...edgesToImport],
        isDirty: true,
      })

      if (Object.keys(importedFlowTemplates).length > 0) {
        state.setFlowPromptTemplates({
          ...state.flowPromptTemplates,
          ...importedFlowTemplates,
        })
      }

      const assetCount = Object.keys(assetIdMap).length
      toast.success(`Added ${nodesToImport.length} nodes to workflow${assetCount > 0 ? ` with ${assetCount} assets` : ""}`)
    } catch (err) {
      toast.error("Import failed: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setImporting(false)
    }
  }, [projectId])

  const handleImport = useCallback((mode: "new" | "inject") => {
    const data = pendingImportData
    if (!data) return
    setPendingImportData(null)
    if (mode === "new") {
      if (!projectId) {
        toast.error("Open a project to import a workflow")
        return
      }
      void handleImportAsNew(data)
    } else {
      void handleInject(data)
    }
  }, [pendingImportData, projectId, handleImportAsNew, handleInject])

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

        {flowTemplatesOpen && (
          <Suspense fallback={null}>
            <FlowTemplatesDialog
              open={flowTemplatesOpen}
              onOpenChange={setFlowTemplatesOpen}
              flowTemplates={flowTemplates}
              userTemplates={userTemplates}
              onSave={setFlowPromptTemplates}
            />
          </Suspense>
        )}

        {pendingImportData && (
          <AlertDialog open onOpenChange={(open) => { if (!open) setPendingImportData(null) }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Import Workflow</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingImportData.name ? `"${pendingImportData.name}" — ` : ""}
                  {pendingImportData.nodes.length} nodes, {pendingImportData.edges.length} connections
                  {pendingImportData.assets ? ` + assets` : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <Button variant="outline" onClick={() => handleImport("inject")}>
                  Add to Current
                </Button>
                <Button onClick={() => handleImport("new")}>
                  Import as New
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

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
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <FileJson className="h-4 w-4 mr-2" />
                  From File
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleClipboardImport}>
                  <ClipboardPaste className="h-4 w-4 mr-2" />
                  From Clipboard
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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

          if (hasError) {
            buttonStyle = { backgroundColor: '#ef4444', borderColor: '#ef4444' }
            buttonClassName += "text-white hover:opacity-90"
          } else if (isUnsaved || isSaving) {
            buttonClassName += "bg-gray-100 text-gray-800 border-gray-200 dark:bg-muted dark:text-white dark:border-border hover:opacity-90"
          } else {
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

        {(() => {
          const hasConnections = edges.length > 0
          return hasConnections ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  title="Variable display mode"
                  className={variableDisplayMode !== "raw" ? "text-white hover:opacity-90" : ""}
                  style={variableDisplayMode !== "raw" ? { backgroundColor: '#38BDF8', borderColor: '#38BDF8' } : undefined}
                >
                  <Braces className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setVariableDisplayMode("raw")}>
                  <span className={variableDisplayMode === "raw" ? "font-bold" : ""}>
                    {"{x}"} Raw
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setVariableDisplayMode("annotated")}>
                  <span className={variableDisplayMode === "annotated" ? "font-bold" : ""}>
                    {"{x: v}"} Annotated
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setVariableDisplayMode("resolved")}>
                  <span className={variableDisplayMode === "resolved" ? "font-bold" : ""}>
                    v Resolved
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
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
