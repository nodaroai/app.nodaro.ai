"use client"

import { useMemo, useState } from "react"
import { UserCircle, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import type { CharacterNodeData } from "@/types/nodes"

export function CharacterGalleryButton() {
  const [open, setOpen] = useState(false)
  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const characters = useMemo(() => {
    const result: { id: string; name: string; imageUrl: string | undefined }[] = []
    for (const node of nodes) {
      if (node.type !== "character") continue
      const d = node.data as CharacterNodeData
      const activeResult = (d.generatedResults ?? [])[d.activeResultIndex ?? 0]
      const imageUrl = activeResult?.url ?? d.sourceImageUrl ?? undefined
      result.push({
        id: node.id,
        name: d.characterName || "Unnamed",
        imageUrl,
      })
    }
    return result
  }, [nodes])

  const charCount = characters.length

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
              <h3 className="text-sm font-semibold">Characters</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {charCount === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <UserCircle className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">No characters yet</p>
                  <p className="text-xs mt-1">Add a Character node to get started</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {/* Current workflow group */}
                  <div>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase mb-2 px-1">
                      {workflowName || "Untitled Workflow"}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {characters.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex flex-col items-center gap-1.5 p-2 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-colors group"
                          onClick={() => {
                            selectNode(c.id)
                            setOpen(false)
                          }}
                          title={`Select ${c.name}`}
                        >
                          {c.imageUrl ? (
                            <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-muted/30">
                              <img
                                src={c.imageUrl}
                                alt={c.name}
                                className="w-full h-full object-cover"
                              />
                              <button
                                type="button"
                                className="absolute inset-0 bg-black/0 hover:bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (c.imageUrl) setLightboxSrc(c.imageUrl)
                                }}
                              >
                                <span className="text-white text-[10px]">Enlarge</span>
                              </button>
                            </div>
                          ) : (
                            <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
                              <UserCircle className="w-8 h-8 text-muted-foreground/30" />
                            </div>
                          )}
                          <span className="text-xs truncate w-full text-center">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ImageLightbox
        src={lightboxSrc}
        alt="Character"
        onClose={() => setLightboxSrc(null)}
      />
    </>
  )
}
