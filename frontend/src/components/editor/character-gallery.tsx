"use client"

import { useState, useEffect, useCallback } from "react"
import { UserCircle, Users, X, Loader2, AlertCircle, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { CharacterPageModal } from "./character-page-modal"
import { getCharacters, type DbCharacter } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import type { CharacterNodeData } from "@/types/nodes"

export function CharacterGalleryButton() {
  const [open, setOpen] = useState(false)
  const [dbCharacters, setDbCharacters] = useState<DbCharacter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)
  const [characterPageNodeId, setCharacterPageNodeId] = useState<string | null>(null)

  // Fetch characters from DB when gallery opens
  const fetchCharacters = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const { characters } = await getCharacters(projectId, user?.id)
      setDbCharacters(characters)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load characters")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (open) {
      fetchCharacters()
    }
  }, [open, fetchCharacters])

  // Find if a DB character already has a node on canvas
  const findNodeForCharacter = useCallback(
    (dbId: string): string | null => {
      for (const node of nodes) {
        if (node.type !== "character") continue
        const d = node.data as CharacterNodeData
        if (d.characterDbId === dbId) {
          return node.id
        }
      }
      return null
    },
    [nodes],
  )

  // Handle clicking a character thumbnail - opens Character Page
  const handleCharacterClick = useCallback(
    (dbChar: DbCharacter) => {
      // Check if character already has a node on canvas
      const existingNodeId = findNodeForCharacter(dbChar.id)

      if (existingNodeId) {
        // Already on canvas - open Character Page for that node
        setCharacterPageNodeId(existingNodeId)
        setOpen(false)
      } else {
        // Not on canvas - create a temporary node to open Character Page
        // Position to the right of existing nodes
        const maxX = nodes.length > 0
          ? Math.max(...nodes.map((n) => n.position.x)) + 300
          : 200
        const avgY = nodes.length > 0
          ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
          : 200
        const nodeId = addNode("character", {
          x: maxX,
          y: avgY,
        })

        if (nodeId) {
          // Populate with DB data
          updateNodeData(nodeId, {
            characterDbId: dbChar.id,
            characterName: dbChar.name,
            description: dbChar.description ?? "",
            gender: dbChar.gender ?? "other",
            style: dbChar.style ?? "realistic",
            baseOutfit: dbChar.baseOutfit ?? "",
            sourceImageUrl: dbChar.sourceImageUrl ?? "",
            expressions: dbChar.expressions ?? [],
            poses: dbChar.poses ?? [],
            lightingVariations: dbChar.lightingVariations ?? [],
          })

          // Open Character Page for the new node
          selectNode(nodeId)
          setCharacterPageNodeId(nodeId)
          setOpen(false)
        }
      }
    },
    [nodes, findNodeForCharacter, addNode, updateNodeData, selectNode],
  )

  // Handle clicking "+" button - adds character to canvas without opening modal
  const handleAddToCanvas = useCallback(
    (e: React.MouseEvent, dbChar: DbCharacter) => {
      e.stopPropagation()

      // Position to the right of existing nodes
      const maxX = nodes.length > 0
        ? Math.max(...nodes.map((n) => n.position.x)) + 300
        : 200
      const avgY = nodes.length > 0
        ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
        : 200
      const nodeId = addNode("character", {
        x: maxX,
        y: avgY,
      })

      if (nodeId) {
        // Populate with DB data
        updateNodeData(nodeId, {
          characterDbId: dbChar.id,
          characterName: dbChar.name,
          description: dbChar.description ?? "",
          gender: dbChar.gender ?? "other",
          style: dbChar.style ?? "realistic",
          baseOutfit: dbChar.baseOutfit ?? "",
          sourceImageUrl: dbChar.sourceImageUrl ?? "",
          expressions: dbChar.expressions ?? [],
          poses: dbChar.poses ?? [],
          lightingVariations: dbChar.lightingVariations ?? [],
        })

        // Select the new node and close gallery
        selectNode(nodeId)
        setOpen(false)
      }
    },
    [nodes, addNode, updateNodeData, selectNode],
  )

  const charCount = dbCharacters.length

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-2 h-10 touch-manipulation"
        onClick={() => setOpen(true)}
      >
        <Users className="h-4 w-4" />
        Characters
        {charCount > 0 && (
          <span className="ml-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
            {charCount}
          </span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border rounded-xl shadow-2xl w-[420px] max-w-[90vw] max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Character Library</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <p className="text-sm">Loading characters...</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-8 text-destructive">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <p className="text-sm">{error}</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={fetchCharacters}>
                    Retry
                  </Button>
                </div>
              ) : charCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <UserCircle className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">No saved characters</p>
                  <p className="text-xs mt-1">Generate a character portrait to save it here</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {dbCharacters.map((c) => {
                    const isOnCanvas = !!findNodeForCharacter(c.id)
                    return (
                      <div key={c.id} className="relative group">
                        <button
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-colors cursor-pointer text-left w-full"
                          onClick={() => handleCharacterClick(c)}
                          title={`View ${c.name}`}
                        >
                          {c.sourceImageUrl ? (
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/30">
                              <img
                                src={c.sourceImageUrl}
                                alt={c.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
                              <UserCircle className="w-8 h-8 text-muted-foreground/30" />
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
                          className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center bg-primary text-primary-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-primary/90"
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

      {characterPageNodeId && (
        <CharacterPageModal
          characterNodeId={characterPageNodeId}
          onClose={() => setCharacterPageNodeId(null)}
        />
      )}
    </>
  )
}
