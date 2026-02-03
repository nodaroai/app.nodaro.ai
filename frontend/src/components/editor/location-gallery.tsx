"use client"

import { useState, useEffect, useCallback } from "react"
import { MapPin, X, Loader2, AlertCircle, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { LocationPageModal } from "./location-page-modal"
import { getLocations, type DbLocation } from "@/lib/api"
import type { LocationNodeData } from "@/types/nodes"

export function LocationGalleryButton() {
  const [open, setOpen] = useState(false)
  const [dbLocations, setDbLocations] = useState<DbLocation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)
  const [locationPageNodeId, setLocationPageNodeId] = useState<string | null>(null)

  // Fetch locations from DB when gallery opens
  const fetchLocations = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const { locations } = await getLocations(projectId)
      setDbLocations(locations)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load locations")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) {
      fetchLocations()
    }
  }, [open, fetchLocations])

  // Find if a DB location already has a node on canvas
  const findNodeForLocation = useCallback(
    (dbId: string): string | null => {
      for (const node of nodes) {
        if (node.type !== "location") continue
        const d = node.data as LocationNodeData
        if (d.locationDbId === dbId) {
          return node.id
        }
      }
      return null
    },
    [nodes],
  )

  // Handle clicking a location thumbnail - opens Location Page
  const handleLocationClick = useCallback(
    (dbLoc: DbLocation) => {
      // Check if location already has a node on canvas
      const existingNodeId = findNodeForLocation(dbLoc.id)

      if (existingNodeId) {
        // Already on canvas - open Location Page for that node
        setLocationPageNodeId(existingNodeId)
        setOpen(false)
      } else {
        // Not on canvas - create a node to open Location Page
        // Position to the right of existing nodes
        const maxX = nodes.length > 0
          ? Math.max(...nodes.map((n) => n.position.x)) + 300
          : 200
        const avgY = nodes.length > 0
          ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
          : 200
        const nodeId = addNode("location", {
          x: maxX,
          y: avgY,
        })

        if (nodeId) {
          // Populate with DB data
          updateNodeData(nodeId, {
            locationDbId: dbLoc.id,
            locationName: dbLoc.name,
            description: dbLoc.description ?? "",
            category: dbLoc.category ?? "other",
            style: dbLoc.style ?? "realistic",
            sourceImageUrl: dbLoc.sourceImageUrl ?? "",
            timeOfDay: dbLoc.timeOfDay ?? [],
            weather: dbLoc.weather ?? [],
            angles: dbLoc.angles ?? [],
          })

          // Open Location Page for the new node
          selectNode(nodeId)
          setLocationPageNodeId(nodeId)
          setOpen(false)
        }
      }
    },
    [nodes, findNodeForLocation, addNode, updateNodeData, selectNode],
  )

  // Handle clicking "+" button - adds location to canvas without opening modal
  const handleAddToCanvas = useCallback(
    (e: React.MouseEvent, dbLoc: DbLocation) => {
      e.stopPropagation()

      // Position to the right of existing nodes
      const maxX = nodes.length > 0
        ? Math.max(...nodes.map((n) => n.position.x)) + 300
        : 200
      const avgY = nodes.length > 0
        ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
        : 200
      const nodeId = addNode("location", {
        x: maxX,
        y: avgY,
      })

      if (nodeId) {
        // Populate with DB data
        updateNodeData(nodeId, {
          locationDbId: dbLoc.id,
          locationName: dbLoc.name,
          description: dbLoc.description ?? "",
          category: dbLoc.category ?? "other",
          style: dbLoc.style ?? "realistic",
          sourceImageUrl: dbLoc.sourceImageUrl ?? "",
          timeOfDay: dbLoc.timeOfDay ?? [],
          weather: dbLoc.weather ?? [],
          angles: dbLoc.angles ?? [],
        })

        // Select the new node and close gallery
        selectNode(nodeId)
        setOpen(false)
      }
    },
    [nodes, addNode, updateNodeData, selectNode],
  )

  const locCount = dbLocations.length

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-10 touch-manipulation"
        onClick={() => setOpen(true)}
      >
        <MapPin className="h-4 w-4" />
        Locations
        {locCount > 0 && (
          <span className="ml-auto text-[10px] bg-cyan-500/10 text-cyan-600 px-1.5 py-0.5 rounded-full">
            {locCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border rounded-xl shadow-2xl w-[420px] max-w-[90vw] max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Location Library</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <p className="text-sm">Loading locations...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-8 text-destructive">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <p className="text-sm">{error}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={fetchLocations}>
                    Retry
                  </Button>
                </div>
              ) : locCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <MapPin className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">No saved locations</p>
                  <p className="text-xs mt-1">Generate a location image to save it here</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {dbLocations.map((loc) => {
                    const isOnCanvas = !!findNodeForLocation(loc.id)
                    return (
                      <div key={loc.id} className="relative group">
                        <button
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-colors cursor-pointer text-left w-full"
                          onClick={() => handleLocationClick(loc)}
                          title={`View ${loc.name}`}
                        >
                          {loc.sourceImageUrl ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/30">
                              <img
                                src={loc.sourceImageUrl}
                                alt={loc.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
                              <MapPin className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                          )}
                          <span className="text-xs truncate w-full text-center">{loc.name}</span>
                          {isOnCanvas && (
                            <span className="text-[9px] text-muted-foreground">On canvas</span>
                          )}
                        </button>
                        {/* Add to canvas button - always visible */}
                        <button
                          type="button"
                          className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center bg-cyan-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-cyan-600"
                          onClick={(e) => handleAddToCanvas(e, loc)}
                          title={`Add ${loc.name} to canvas`}
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

      {locationPageNodeId && (
        <LocationPageModal
          locationNodeId={locationPageNodeId}
          onClose={() => setLocationPageNodeId(null)}
        />
      )}
    </>
  )
}
