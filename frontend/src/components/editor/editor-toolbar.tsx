"use client"

import { useState, useRef, useCallback, useEffect, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { ArrowLeft, ChevronRight, Save, CheckCircle, Loader2, RefreshCw, Play, Pause, MoreVertical, Download, Upload, Package, FileJson, FileText, ClipboardPaste } from "lucide-react"
import { CreditBalance } from "@/ee/components/credits/CreditBalance"
import { Button } from "@/components/ui/button"
import { NodeDoubleClickToggle } from "./node-double-click-toggle"
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
import { ensureNodePositions } from "@/lib/node-position"
import type { WorkflowExport } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge, CharacterNodeData, ObjectNodeData, CreatureNodeData, LocationNodeData } from "@/types/nodes"
import { useT } from "@/lib/i18n"

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
  /** Media another instance cannot fetch — see `WorkflowPortability` (#866). */
  portability?: { unreachableMedia: Array<{ nodeId: string; nodeLabel?: string; field: string; url: string }> }
}

/** "Node A, Node B, …" for a media-ref list — labels first, ids as the fallback, capped. */
function describeMediaRefNodes(refs: ReadonlyArray<{ nodeId: string; nodeLabel?: string }>, max = 4): string {
  const names = [...new Set(refs.map((r) => r.nodeLabel || r.nodeId))]
  return names.slice(0, max).join(", ") + (names.length > max ? ", …" : "")
}

export function EditorToolbar({ projectId, onSave, saving, onNavigate, activeTab = "editor", onTabChange }: EditorToolbarProps) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const isReadOnly = useWorkflowStore((s) => s.isReadOnly)
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
  const focusedNodeId = useWorkflowStore((s) => s.focusedNodeId)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const selectNode = useWorkflowStore((s) => s.selectNode)
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
      toast.error(t("editor.saveBeforeExport"))
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

      toast.success(includeAssets ? t("editor.exportedWithAssets") : t("editor.exportedTemplate"))
      // The bundle points at media only THIS install can serve (#866) — say
      // so now, not on someone else's canvas at Run time.
      const unreachable = workflowData.portability?.unreachableMedia ?? []
      if (unreachable.length > 0) {
        const n = unreachable.length
        toast.warning(
          t("editor.unreachableExportWarn", { n, suffix: n === 1 ? "" : "s", refs: describeMediaRefNodes(unreachable) }),
          { duration: 12_000 },
        )
      }
    } catch (err) {
      toast.error(t("editor.exportFailed", { error: err instanceof Error ? err.message : "Unknown error" }))
    } finally {
      setExporting(false)
    }
  }, [workflowId, workflowName, t])

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
        toast.error(t("editor.invalidFile", { error: err instanceof Error ? err.message : t("editor.couldNotParseJson") }))
      }
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [t])

  const handleClipboardImport = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      const data = parseWorkflowJson(text)
      setPendingImportData(data)
    } catch (err) {
      toast.error(t("editor.clipboardImportFailed", { error: err instanceof Error ? err.message : t("editor.couldNotReadClipboard") }))
    }
  }, [t])

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
      const report = created.importReport
      const copied = report?.rehosted ? t("editor.mediaCopiedSuffix", { n: report.rehosted, suffix: report.rehosted === 1 ? "" : "s" }) : ""
      toast.success((assetCount > 0 ? t("editor.importedWithAssetsCount", { n: assetCount }) : t("editor.importedPlain")) + copied)
      // Media this instance could not fetch stays as-is and those nodes will
      // not run until it is re-uploaded here (#866).
      const unreachable = report?.unreachable ?? []
      if (unreachable.length > 0) {
        const n = unreachable.length
        toast.warning(
          t("editor.unreachableImportWarn", { n, suffix: n === 1 ? "" : "s", refs: describeMediaRefNodes(unreachable) }),
          { duration: 12_000 },
        )
      }
      onNavigate?.(`/projects/${created.projectId}/workflows/${created.id}`)
    } catch (err) {
      toast.error(t("editor.importFailed", { error: err instanceof Error ? err.message : "Unknown error" }))
    } finally {
      setImporting(false)
    }
  }, [projectId, onNavigate, t])

  // Inject mode merges the imported nodes onto the *current* canvas (no new
  // workflow row). Bundled assets are re-created via the backend asset routes;
  // node/edge id remapping and the offset layout are pure client-side work.
  const handleInject = useCallback(async (data: ExportedWorkflow) => {
    if (useWorkflowStore.getState().isReadOnly) return
    // Inject never goes through the backend import, so nothing is copied
    // here — but the exporter's own note (#866) still tells us which media
    // will not load; say so rather than let those nodes fail at Run time.
    const unreachable = data.portability?.unreachableMedia ?? []
    if (unreachable.length > 0) {
      const n = unreachable.length
      toast.warning(
        t("editor.unreachableImportWarn", { n, suffix: n === 1 ? "" : "s", refs: describeMediaRefNodes(unreachable) }),
        { duration: 12_000 },
      )
    }
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
          } else if (node.type === "creature") {
            const nd = node.data as CreatureNodeData
            if (nd.creatureDbId && assetIdMap[nd.creatureDbId])
              return { ...node, data: { ...nd, creatureDbId: assetIdMap[nd.creatureDbId] } }
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

      // Studio/SDK exports can omit positions; guarantee them before the offset
      // math (reads n.position.x) and before React Flow renders the merged graph.
      nodesToImport = ensureNodePositions(nodesToImport).nodes

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
      toast.success(assetCount > 0
        ? t("editor.addedNodesWithAssets", { n: nodesToImport.length, a: assetCount })
        : t("editor.addedNodes", { n: nodesToImport.length }))
    } catch (err) {
      toast.error(t("editor.importFailed", { error: err instanceof Error ? err.message : "Unknown error" }))
    } finally {
      setImporting(false)
    }
  }, [projectId, t])

  const handleImport = useCallback((mode: "new" | "inject") => {
    const data = pendingImportData
    if (!data) return
    setPendingImportData(null)
    if (mode === "new") {
      if (!projectId) {
        toast.error(t("editor.openProjectToImport"))
        return
      }
      void handleImportAsNew(data)
    } else {
      void handleInject(data)
    }
  }, [pendingImportData, projectId, handleImportAsNew, handleInject, t])

  return (
    <div className="flex items-center justify-between gap-2 px-2 sm:px-4 h-[41px] border-b border-gray-200 dark:border-border bg-white dark:bg-card">
      {/* Left section: Back, Breadcrumbs, Workflow name */}
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        {projectId && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("editor.backToProject")}
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => onNavigate ? onNavigate(`/projects/${projectId}`) : undefined}
          >
            <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} />
          </Button>
        )}

        {/* Breadcrumbs - hidden on small screens */}
        <nav className="hidden sm:flex items-center gap-1 text-sm shrink-0">
          <button
            type="button"
            onClick={() => onNavigate?.("/projects")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("crumb.dashboard")}
          </button>
          {project && (
            <>
              <ChevronRight className={cn("h-3 w-3 text-muted-foreground", isRtl && "rotate-180")} />
              <button
                type="button"
                onClick={() => onNavigate?.(`/projects/${projectId}`)}
                className="text-muted-foreground hover:text-foreground transition-colors max-w-[120px] truncate"
              >
                {project.name}
              </button>
            </>
          )}
          <ChevronRight className={cn("h-3 w-3 text-muted-foreground", isRtl && "rotate-180")} />
        </nav>

        <div className="flex items-center gap-0.5 min-w-0">
          <Input
            aria-label={t("editor.workflowName")}
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
                aria-label={t("editor.promptTemplates")}
                className="relative"
                onClick={() => setFlowTemplatesOpen(true)}
              >
                <FileText className="h-4 w-4" />
                {Object.keys(flowTemplates).length > 0 && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[#ff0073] border-2 border-white dark:border-card" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("editor.promptTemplates")}</TooltipContent>
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
                <AlertDialogTitle>{t("editor.importWorkflow")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingImportData.name ? `"${pendingImportData.name}" — ` : ""}
                  {t("editor.importCounts", { nodes: pendingImportData.nodes.length, edges: pendingImportData.edges.length })}
                  {pendingImportData.assets ? ` ${t("editor.plusAssets")}` : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                {!isReadOnly && (
                  <Button variant="outline" onClick={() => handleImport("inject")}>
                    {t("editor.addToCurrent")}
                  </Button>
                )}
                <Button onClick={() => handleImport("new")}>
                  {t("editor.importAsNew")}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label={t("editor.moreOptions")} disabled={exporting || importing}>
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
                <Download className="h-4 w-4 me-2" />
                {t("editor.export")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => handleExport(true)}>
                  <Package className="h-4 w-4 me-2" />
                  {t("editor.withAssets")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport(false)}>
                  <FileJson className="h-4 w-4 me-2" />
                  {t("editor.templateOnly")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Upload className="h-4 w-4 me-2" />
                {t("editor.import")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                  <FileJson className="h-4 w-4 me-2" />
                  {t("editor.fromFile")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleClipboardImport}>
                  <ClipboardPaste className="h-4 w-4 me-2" />
                  {t("editor.fromClipboard")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Save Button with integrated state indicator. Hidden in read-only
            (Studio/shared) workflows — save is already a no-op via the store's
            persistence guards, so this is cosmetic. */}
        {!isReadOnly && (() => {
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
          let buttonText = t("editor.saved")
          if (isSaving) buttonText = t("editor.saving")
          else if (isSaved) buttonText = t("editor.saved")
          else if (hasError) buttonText = t("editor.retry")
          else if (isUnsaved) buttonText = t("editor.unsaved")

          return (
            <Button
              variant="outline"
              size="sm"
              onClick={onSave}
              disabled={isSaving || isIdle}
              aria-label={buttonText}
              className={buttonClassName}
              style={buttonStyle}
              title={hasError ? saveError ?? t("editor.saveFailed") : undefined}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin sm:me-1" />
              ) : isSaved ? (
                <CheckCircle className="h-4 w-4 text-green-300 sm:me-1" />
              ) : hasError ? (
                <RefreshCw className="h-4 w-4 sm:me-1" />
              ) : isUnsaved ? (
                <Save className="h-4 w-4 sm:me-1" />
              ) : (
                <CheckCircle className="h-4 w-4 sm:me-1" />
              )}
              <span className="hidden sm:inline">{buttonText}</span>
            </Button>
          )
        })()}

        {/* The `{}` variable-display dropdown used to sit here. It is a
            preference, not a per-session action, so it moved to
            Settings → Editor. The mode itself is unchanged — every prompt field
            still reads it from the workflow store. */}

        {/* Was a momentary "open the settings panel for the focused node".
            That role moved onto the nodes themselves — each one carries a
            settings control in its run strip — so this slot now owns the CHOICE
            of what a double-click does, and is never disabled: it sets a
            preference rather than acting on a selection. */}
        <NodeDoubleClickToggle />

        <Button
          variant="outline"
          size="sm"
          onClick={() => setVideoAutoplay(!videoAutoplay)}
          aria-label={videoAutoplay ? t("editor.pauseAutoplay") : t("editor.enableAutoplay")}
          title={videoAutoplay ? t("editor.autoPlayingVideos") : t("editor.videosPaused")}
          className={videoAutoplay ? "text-white hover:opacity-90" : ""}
          style={videoAutoplay ? { backgroundColor: '#ff0073', borderColor: '#ff0073' } : undefined}
        >
          {videoAutoplay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}
