import { useState, useCallback, lazy, Suspense } from "react"
import { Package, X, Loader2, AlertCircle, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
const ObjectPageModal = lazy(() => import("./object-page-modal").then(m => ({ default: m.ObjectPageModal })))
import { type DbObject } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useObjects } from "@/hooks/queries/use-assets-queries"
import type { ObjectNodeData } from "@/types/nodes"

export function ObjectGalleryButton() {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)
  const [objectPageNodeId, setObjectPageNodeId] = useState<string | null>(null)

  const { data: dbObjects = [], isLoading: loading, error, refetch } = useObjects(projectId ?? undefined, user?.id)

  // Find if a DB object already has a node on canvas
  const findNodeForObject = useCallback(
    (dbId: string): string | null => {
      for (const node of nodes) {
        if (node.type !== "object") continue
        const d = node.data as ObjectNodeData
        if (d.objectDbId === dbId) {
          return node.id
        }
      }
      return null
    },
    [nodes],
  )

  // Handle clicking an object thumbnail - opens Object Page
  const handleObjectClick = useCallback(
    (dbObj: DbObject) => {
      // Check if object already has a node on canvas
      const existingNodeId = findNodeForObject(dbObj.id)

      if (existingNodeId) {
        // Already on canvas - open Object Page for that node
        setObjectPageNodeId(existingNodeId)
        setOpen(false)
      } else {
        // Not on canvas - create a node to open Object Page
        // Position to the right of existing nodes
        const maxX = nodes.length > 0
          ? Math.max(...nodes.map((n) => n.position.x)) + 300
          : 200
        const avgY = nodes.length > 0
          ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
          : 200
        const nodeId = addNode("object", {
          x: maxX,
          y: avgY,
        })

        if (nodeId) {
          // Populate with DB data
          updateNodeData(nodeId, {
            objectDbId: dbObj.id,
            objectName: dbObj.name,
            description: dbObj.description ?? "",
            category: dbObj.category ?? "other",
            style: dbObj.style ?? "realistic",
            sourceImageUrl: dbObj.sourceImageUrl ?? "",
            angles: dbObj.angles ?? [],
            materials: dbObj.materials ?? [],
            variations: dbObj.variations ?? [],
          })

          // Open Object Page for the new node
          selectNode(nodeId)
          setObjectPageNodeId(nodeId)
          setOpen(false)
        }
      }
    },
    [nodes, findNodeForObject, addNode, updateNodeData, selectNode],
  )

  // Handle clicking "+" button - adds object to canvas without opening modal
  const handleAddToCanvas = useCallback(
    (e: React.MouseEvent, dbObj: DbObject) => {
      e.stopPropagation()

      // Position to the right of existing nodes
      const maxX = nodes.length > 0
        ? Math.max(...nodes.map((n) => n.position.x)) + 300
        : 200
      const avgY = nodes.length > 0
        ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
        : 200
      const nodeId = addNode("object", {
        x: maxX,
        y: avgY,
      })

      if (nodeId) {
        // Populate with DB data
        updateNodeData(nodeId, {
          objectDbId: dbObj.id,
          objectName: dbObj.name,
          description: dbObj.description ?? "",
          category: dbObj.category ?? "other",
          style: dbObj.style ?? "realistic",
          sourceImageUrl: dbObj.sourceImageUrl ?? "",
          angles: dbObj.angles ?? [],
          materials: dbObj.materials ?? [],
          variations: dbObj.variations ?? [],
        })

        // Select the new node and close gallery
        selectNode(nodeId)
        setOpen(false)
      }
    },
    [nodes, addNode, updateNodeData, selectNode],
  )

  const objCount = dbObjects.length

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-10 touch-manipulation"
        onClick={() => setOpen(true)}
      >
        <Package className="h-4 w-4" />
        Objects
        {objCount > 0 && (
          <span className="ml-auto text-[10px] bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded-full">
            {objCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border rounded-xl shadow-2xl w-[420px] max-w-[90vw] max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Object Library</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <p className="text-sm">Loading objects...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-8 text-destructive">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <p className="text-sm">{error instanceof Error ? error.message : "Failed to load objects"}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
                    Retry
                  </Button>
                </div>
              ) : objCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Package className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">No saved objects</p>
                  <p className="text-xs mt-1">Generate an object image to save it here</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {dbObjects.map((o) => {
                    const isOnCanvas = !!findNodeForObject(o.id)
                    return (
                      <div key={o.id} className="relative group">
                        <button
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-colors cursor-pointer text-left w-full"
                          onClick={() => handleObjectClick(o)}
                          title={`View ${o.name}`}
                        >
                          {o.sourceImageUrl ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/30">
                              <CachedImage
                                src={o.sourceImageUrl}
                                alt={o.name}
                                className="w-full h-full object-cover"
                                thumbnail
                                thumbnailWidth={160}
                              />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
                              <Package className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                          )}
                          <span className="text-xs truncate w-full text-center">{o.name}</span>
                          {isOnCanvas && (
                            <span className="text-[9px] text-muted-foreground">On canvas</span>
                          )}
                        </button>
                        {/* Add to canvas button - always visible */}
                        <button
                          type="button"
                          className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center bg-emerald-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-emerald-600"
                          onClick={(e) => handleAddToCanvas(e, o)}
                          title={`Add ${o.name} to canvas`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {objectPageNodeId && (
        <Suspense fallback={null}>
          <ObjectPageModal
            objectNodeId={objectPageNodeId}
            onClose={() => setObjectPageNodeId(null)}
          />
        </Suspense>
      )}
    </>
  )
}
