import { useState, useCallback } from "react"
import { PawPrint, X, Loader2, AlertCircle, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { type DbCreature } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useCreatures } from "@/hooks/queries/use-assets-queries"
import type { CreatureNodeData } from "@/types/nodes"

// Animal/Creature gallery. Mirrors ObjectGalleryButton (object-gallery.tsx)
// with the creature DELTA: object→creature, objectName→creatureName,
// objectDbId→creatureDbId, materials→poses, + species; PawPrint icon + violet
// (#A78BFA) accent. Clicking a creature opens the Creature Studio via the
// store's setCreatureStudioNodeId — the creature equivalent of the object
// gallery's ObjectPageModal-on-click (CreatureStudioModal is rendered globally
// in workflow-editor-main.tsx, driven by that store field, so we don't render a
// second instance here).
export function CreatureGalleryButton() {
  const [open, setOpen] = useState(false)
  const { user } = useAuth()

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)
  const setCreatureStudioNodeId = useWorkflowStore((s) => s.setCreatureStudioNodeId)

  const { data: dbCreatures = [], isLoading: loading, error, refetch } = useCreatures(projectId ?? undefined, user?.id)

  // Find if a DB creature already has a node on canvas
  const findNodeForCreature = useCallback(
    (dbId: string): string | null => {
      for (const node of nodes) {
        if (node.type !== "creature") continue
        const d = node.data as CreatureNodeData
        if (d.creatureDbId === dbId) {
          return node.id
        }
      }
      return null
    },
    [nodes],
  )

  // Handle clicking a creature thumbnail - opens Creature Studio
  const handleCreatureClick = useCallback(
    (dbCre: DbCreature) => {
      // Check if creature already has a node on canvas
      const existingNodeId = findNodeForCreature(dbCre.id)

      if (existingNodeId) {
        // Already on canvas - open Creature Studio for that node
        setCreatureStudioNodeId(existingNodeId)
        setOpen(false)
      } else {
        // Not on canvas - create a node to open Creature Studio
        // Position to the right of existing nodes
        const maxX = nodes.length > 0
          ? Math.max(...nodes.map((n) => n.position.x)) + 300
          : 200
        const avgY = nodes.length > 0
          ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
          : 200
        const nodeId = addNode("creature", {
          x: maxX,
          y: avgY,
        })

        if (nodeId) {
          // Populate with DB data
          updateNodeData(nodeId, {
            creatureDbId: dbCre.id,
            creatureName: dbCre.name,
            description: dbCre.description ?? "",
            species: dbCre.species ?? "",
            category: dbCre.category ?? "",
            style: dbCre.style ?? "realistic",
            sourceImageUrl: dbCre.sourceImageUrl ?? "",
            angles: dbCre.angles ?? [],
            poses: dbCre.poses ?? [],
            variations: dbCre.variations ?? [],
          })

          // Open Creature Studio for the new node
          selectNode(nodeId)
          setCreatureStudioNodeId(nodeId)
          setOpen(false)
        }
      }
    },
    [nodes, findNodeForCreature, addNode, updateNodeData, selectNode, setCreatureStudioNodeId],
  )

  // Handle clicking "+" button - adds creature to canvas without opening modal
  const handleAddToCanvas = useCallback(
    (e: React.MouseEvent, dbCre: DbCreature) => {
      e.stopPropagation()

      // Position to the right of existing nodes
      const maxX = nodes.length > 0
        ? Math.max(...nodes.map((n) => n.position.x)) + 300
        : 200
      const avgY = nodes.length > 0
        ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
        : 200
      const nodeId = addNode("creature", {
        x: maxX,
        y: avgY,
      })

      if (nodeId) {
        // Populate with DB data
        updateNodeData(nodeId, {
          creatureDbId: dbCre.id,
          creatureName: dbCre.name,
          description: dbCre.description ?? "",
          species: dbCre.species ?? "",
          category: dbCre.category ?? "",
          style: dbCre.style ?? "realistic",
          sourceImageUrl: dbCre.sourceImageUrl ?? "",
          angles: dbCre.angles ?? [],
          poses: dbCre.poses ?? [],
          variations: dbCre.variations ?? [],
        })

        // Select the new node and close gallery
        selectNode(nodeId)
        setOpen(false)
      }
    },
    [nodes, addNode, updateNodeData, selectNode],
  )

  const creCount = dbCreatures.length

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-10 touch-manipulation"
        onClick={() => setOpen(true)}
      >
        <PawPrint className="h-4 w-4" />
        Animal/Creature
        {creCount > 0 && (
          <span className="ml-auto text-[10px] bg-violet-500/10 text-violet-600 px-1.5 py-0.5 rounded-full">
            {creCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border rounded-xl shadow-2xl w-[420px] max-w-[90vw] max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Animal/Creature Library</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <p className="text-sm">Loading creatures...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-8 text-destructive">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <p className="text-sm">{error instanceof Error ? error.message : "Failed to load creatures"}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
                    Retry
                  </Button>
                </div>
              ) : creCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <PawPrint className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">No saved creatures</p>
                  <p className="text-xs mt-1">Generate a creature image to save it here</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {dbCreatures.map((c) => {
                    const isOnCanvas = !!findNodeForCreature(c.id)
                    return (
                      <div key={c.id} className="relative group">
                        <button
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-colors cursor-pointer text-left w-full"
                          onClick={() => handleCreatureClick(c)}
                          title={`View ${c.name}`}
                        >
                          {c.sourceImageUrl ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/30">
                              <CachedImage
                                src={c.sourceImageUrl}
                                alt={c.name}
                                className="w-full h-full object-cover"
                                thumbnail
                                thumbnailWidth={160}
                              />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
                              <PawPrint className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                          )}
                          <span className="text-xs truncate w-full text-center">{c.name}</span>
                          {isOnCanvas && (
                            <span className="text-[9px] text-muted-foreground">On canvas</span>
                          )}
                        </button>
                        {/* Add to canvas button - always visible */}
                        <button
                          type="button"
                          className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center bg-violet-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-violet-600"
                          onClick={(e) => handleAddToCanvas(e, c)}
                          title={`Add ${c.name} to canvas`}
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
    </>
  )
}
