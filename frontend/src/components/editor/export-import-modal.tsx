"use client"

import { useState, useRef, useCallback } from "react"
import { Download, Upload, X, Loader2, FileJson, Package, AlertCircle, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
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

interface ExportImportModalProps {
  isOpen: boolean
  onClose: () => void
  projectId?: string
}

export function ExportImportModal({ isOpen, onClose, projectId }: ExportImportModalProps) {
  const [mode, setMode] = useState<"export" | "import" | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importData, setImportData] = useState<ExportedWorkflow | null>(null)
  const [importAssets, setImportAssets] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow)

  const handleExport = useCallback(async (includeAssets: boolean) => {
    setExporting(true)
    try {
      const workflowData: ExportedWorkflow = {
        name: workflowName || "Untitled Workflow",
        nodes,
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
      onClose()
    } catch (err) {
      console.error("Export failed:", err)
      toast.error("Export failed: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setExporting(false)
    }
  }, [nodes, edges, workflowName, onClose])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string) as ExportedWorkflow

        // Validate structure
        if (!data.nodes || !Array.isArray(data.nodes)) {
          throw new Error("Invalid workflow file: missing nodes array")
        }
        if (!data.edges || !Array.isArray(data.edges)) {
          throw new Error("Invalid workflow file: missing edges array")
        }

        setImportData(data)
        setMode("import")
      } catch (err) {
        console.error("Invalid file:", err)
        toast.error("Invalid file: " + (err instanceof Error ? err.message : "Could not parse JSON"))
      }
    }
    reader.readAsText(file)

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [])

  const handleImport = useCallback(async () => {
    if (!importData) return

    setImporting(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const userId = user?.id

      let nodesToImport = [...importData.nodes]
      const assetIdMap: Record<string, string> = {} // old ID -> new ID mapping

      // Import assets if requested and they exist
      if (importAssets && importData.assets) {
        const { characters, objects, locations } = importData.assets

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
            const data = node.data as CharacterNodeData
            if (data.characterDbId && assetIdMap[data.characterDbId]) {
              return {
                ...node,
                data: {
                  ...data,
                  characterDbId: assetIdMap[data.characterDbId],
                },
              }
            }
          } else if (node.type === "object") {
            const data = node.data as ObjectNodeData
            if (data.objectDbId && assetIdMap[data.objectDbId]) {
              return {
                ...node,
                data: {
                  ...data,
                  objectDbId: assetIdMap[data.objectDbId],
                },
              }
            }
          } else if (node.type === "location") {
            const data = node.data as LocationNodeData
            if (data.locationDbId && assetIdMap[data.locationDbId]) {
              return {
                ...node,
                data: {
                  ...data,
                  locationDbId: assetIdMap[data.locationDbId],
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
      const edgesToImport = importData.edges.map(edge => ({
        ...edge,
        id: `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        source: nodeIdMap[edge.source] || edge.source,
        target: nodeIdMap[edge.target] || edge.target,
      }))

      // Set the imported workflow using loadWorkflow
      // Use existing workflowId if available, otherwise use a temporary one
      const importedName = (importData.name || "Untitled Workflow") + " (Imported)"
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
      onClose()
    } catch (err) {
      console.error("Import failed:", err)
      toast.error("Import failed: " + (err instanceof Error ? err.message : "Unknown error"))
    } finally {
      setImporting(false)
      setImportData(null)
      setMode(null)
    }
  }, [importData, importAssets, projectId, workflowId, loadWorkflow, onClose])

  const handleClose = useCallback(() => {
    setMode(null)
    setImportData(null)
    onClose()
  }, [onClose])

  const assetCount = importData?.assets
    ? (importData.assets.characters?.length || 0) +
      (importData.assets.objects?.length || 0) +
      (importData.assets.locations?.length || 0)
    : 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export / Import Workflow</DialogTitle>
          <DialogDescription>
            Export your workflow to share or backup, or import a workflow from a JSON file.
          </DialogDescription>
        </DialogHeader>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json,application/json"
          onChange={handleFileSelect}
        />

        {!mode && !importData && (
          <div className="grid gap-4 py-4">
            {/* Export Section */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Export</h4>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleExport(true)}
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Package className="h-4 w-4 mr-2" />
                  )}
                  With Assets
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => handleExport(false)}
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileJson className="h-4 w-4 mr-2" />
                  )}
                  Template Only
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                &quot;With Assets&quot; includes character, object, and location data.
                &quot;Template Only&quot; exports just the workflow structure.
              </p>
            </div>

            {/* Import Section */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Import</h4>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                Select JSON File
              </Button>
              <p className="text-xs text-muted-foreground">
                Import a workflow from a previously exported JSON file.
              </p>
            </div>
          </div>
        )}

        {mode === "import" && importData && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium truncate">{importData.name || "Untitled Workflow"}</p>
                <p className="text-xs text-muted-foreground">
                  {importData.nodes.length} nodes, {importData.edges.length} connections
                </p>
              </div>
            </div>

            {assetCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Include Assets</span>
                  <Button
                    variant={importAssets ? "default" : "outline"}
                    size="sm"
                    onClick={() => setImportAssets(!importAssets)}
                  >
                    {importAssets ? "Yes" : "No"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This workflow contains {assetCount} assets:
                  {importData.assets?.characters?.length ? ` ${importData.assets.characters.length} characters` : ""}
                  {importData.assets?.objects?.length ? `, ${importData.assets.objects.length} objects` : ""}
                  {importData.assets?.locations?.length ? `, ${importData.assets.locations.length} locations` : ""}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <p className="text-xs">
                This will replace your current workflow. Make sure to save any unsaved changes first.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setMode(null)
                  setImportData(null)
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleImport}
                disabled={importing}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Import
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
