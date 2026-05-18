import { useCallback, useState, Suspense } from "react"
import { toast } from "sonner"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { UserCircle, Users, X, Loader2, AlertCircle, Plus, Trash2, ArchiveRestore } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { TrainedPill } from "@/components/editor/trained-pill"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { deleteCharacter, getCharacterUsage, restoreCharacter, type DbCharacter } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { useCharacters, useArchivedCharacters } from "@/hooks/queries/use-assets-queries"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import type { CharacterNodeData } from "@/types/nodes"

const CharacterPageModal = lazy(() => import("./character-page-modal").then((m) => ({ default: m.CharacterPageModal })))

type TabKey = "active" | "archived"

export function CharacterGalleryButton() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<TabKey>("active")
  const { user } = useAuth()

  const nodes = useWorkflowStore((s) => s.nodes)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const addNode = useWorkflowStore((s) => s.addNode)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const projectId = useWorkflowStore((s) => s.projectId)
  const [characterPageNodeId, setCharacterPageNodeId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: dbCharacters = [], isLoading: loadingActive, error: errorActive, refetch: refetchActive } = useCharacters(projectId ?? undefined, user?.id)
  const { data: archivedCharacters = [], isLoading: loadingArchived, error: errorArchived, refetch: refetchArchived } = useArchivedCharacters(projectId ?? undefined, user?.id)

  // Invalidate both lists after any archive/restore so each tab sees the move
  // (a character disappears from Active and appears in Archived, or vice versa).
  const invalidateLists = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.assets.characters(projectId ?? undefined, user?.id) })
    queryClient.invalidateQueries({ queryKey: [...queryKeys.assets.characters(projectId ?? undefined, user?.id), "archived"] })
  }, [queryClient, projectId, user?.id])

  // Find if a DB character already has a node on canvas
  const findNodeForCharacter = useCallback(
    (dbId: string): string | null => {
      for (const node of nodes) {
        if (node.type !== "character") continue
        const d = node.data as CharacterNodeData
        if (d.characterDbId === dbId) return node.id
      }
      return null
    },
    [nodes],
  )

  const openOnCanvas = useCallback(
    (dbChar: DbCharacter) => {
      const existingNodeId = findNodeForCharacter(dbChar.id)
      if (existingNodeId) {
        setCharacterPageNodeId(existingNodeId)
        setOpen(false)
        return
      }
      const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) + 300 : 200
      const avgY = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200
      const nodeId = addNode("character", { x: maxX, y: avgY })
      if (nodeId) {
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
        selectNode(nodeId)
        setCharacterPageNodeId(nodeId)
        setOpen(false)
      }
    },
    [nodes, findNodeForCharacter, addNode, updateNodeData, selectNode],
  )

  const handleAddToCanvas = useCallback(
    (e: React.MouseEvent, dbChar: DbCharacter) => {
      e.stopPropagation()
      const maxX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.position.x)) + 300 : 200
      const avgY = nodes.length > 0 ? nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length : 200
      const nodeId = addNode("character", { x: maxX, y: avgY })
      if (nodeId) {
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
        selectNode(nodeId)
        setOpen(false)
      }
    },
    [nodes, addNode, updateNodeData, selectNode],
  )

  // Archive flow: ask backend for usage count, show modal, on confirm soft-delete.
  const [archiveTarget, setArchiveTarget] = useState<{
    character: DbCharacter
    usage: { workflowCount: number; workflows: { id: string; name: string }[] } | null
  } | null>(null)
  const [archiving, setArchiving] = useState(false)

  const beginArchive = useCallback(
    async (e: React.MouseEvent, dbChar: DbCharacter) => {
      e.stopPropagation()
      // Open the modal immediately with `usage=null` (shows a loading hint);
      // fetch the count in the background. Keeps the UI responsive when the
      // usage RPC is slow or down.
      setArchiveTarget({ character: dbChar, usage: null })
      try {
        const usage = await getCharacterUsage(dbChar.id)
        setArchiveTarget((cur) => (cur && cur.character.id === dbChar.id ? { ...cur, usage } : cur))
      } catch {
        // Non-fatal — modal stays open with no usage count.
      }
    },
    [],
  )

  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return
    setArchiving(true)
    try {
      await deleteCharacter(archiveTarget.character.id)
      invalidateLists()
      toast.success(`Archived '${archiveTarget.character.name}'`)
      setArchiveTarget(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to archive character.")
    } finally {
      setArchiving(false)
    }
  }, [archiveTarget, invalidateLists])

  const handleRestore = useCallback(
    async (e: React.MouseEvent, dbChar: DbCharacter) => {
      e.stopPropagation()
      try {
        const result = await restoreCharacter(dbChar.id)
        invalidateLists()
        toast.success(
          result.name !== dbChar.name
            ? `Restored as '${result.name}' (the original name was taken)`
            : `Restored '${result.name}'`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to restore character.")
      }
    },
    [invalidateLists],
  )

  const activeCount = dbCharacters.length
  const archivedCount = archivedCharacters.length
  const charCount = activeCount

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
          <span className="ml-auto text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{charCount}</span>
        )}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border rounded-xl shadow-2xl w-[420px] max-w-[90vw] max-h-[70vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Character Library</h3>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Tabs */}
            <div className="flex border-b text-[11px]">
              <button
                onClick={() => setTab("active")}
                className={`flex-1 py-2 ${tab === "active" ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
              >
                Active{activeCount > 0 && <span className="ml-1 opacity-60">({activeCount})</span>}
              </button>
              <button
                onClick={() => setTab("archived")}
                className={`flex-1 py-2 ${tab === "archived" ? "text-primary border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
              >
                Archived{archivedCount > 0 && <span className="ml-1 opacity-60">({archivedCount})</span>}
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              {tab === "active" ? (
                <ActivePane
                  loading={loadingActive}
                  error={errorActive}
                  characters={dbCharacters}
                  findNodeForCharacter={findNodeForCharacter}
                  onCardClick={openOnCanvas}
                  onAdd={handleAddToCanvas}
                  onArchive={beginArchive}
                  refetch={refetchActive}
                />
              ) : (
                <ArchivedPane
                  loading={loadingArchived}
                  error={errorArchived}
                  characters={archivedCharacters}
                  onRestore={handleRestore}
                  refetch={refetchArchived}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive-confirmation modal — shows usage count if available so the user
          knows how many workflows reference this character before archiving. */}
      {archiveTarget && (
        <ArchiveConfirmModal
          target={archiveTarget}
          archiving={archiving}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={confirmArchive}
        />
      )}

      {characterPageNodeId && (
        <Suspense fallback={null}>
          <CharacterPageModal
            characterNodeId={characterPageNodeId}
            onClose={() => setCharacterPageNodeId(null)}
          />
        </Suspense>
      )}
    </>
  )
}

function ActivePane({
  loading,
  error,
  characters,
  findNodeForCharacter,
  onCardClick,
  onAdd,
  onArchive,
  refetch,
}: {
  loading: boolean
  error: unknown
  characters: DbCharacter[]
  findNodeForCharacter: (dbId: string) => string | null
  onCardClick: (c: DbCharacter) => void
  onAdd: (e: React.MouseEvent, c: DbCharacter) => void
  onArchive: (e: React.MouseEvent, c: DbCharacter) => void
  refetch: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mb-2" />
        <p className="text-sm">Loading characters...</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-destructive">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error instanceof Error ? error.message : "Failed to load characters"}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={refetch}>Retry</Button>
      </div>
    )
  }
  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <UserCircle className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No saved characters</p>
        <p className="text-xs mt-1">Generate a character portrait to save it here</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {characters.map((c) => {
        const isOnCanvas = !!findNodeForCharacter(c.id)
        return (
          <div key={c.id} className="relative group">
            <button
              type="button"
              className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/30 transition-colors cursor-pointer text-left w-full"
              onClick={() => onCardClick(c)}
              title={`View ${c.name}`}
            >
              <div className="relative">
                {c.sourceImageUrl ? (
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/30">
                    <CachedImage src={c.sourceImageUrl} alt={c.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
                    <UserCircle className="w-8 h-8 text-muted-foreground/30" />
                  </div>
                )}
                {c.loraTrainingStatus === "succeeded" && (
                  <div className="absolute -bottom-1 -right-1 z-10">
                    <TrainedPill size="xs" />
                  </div>
                )}
              </div>
              <span className="text-xs truncate w-full text-center">{c.name}</span>
              {isOnCanvas && <span className="text-[9px] text-muted-foreground">On canvas</span>}
            </button>
            {/* Top-right hover archive button. */}
            <button
              type="button"
              className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-muted text-muted-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => onArchive(e, c)}
              title="Archive character"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {/* Bottom-right hover add-to-canvas. */}
            <button
              type="button"
              className="absolute bottom-1 right-1 w-6 h-6 flex items-center justify-center bg-primary text-primary-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-primary/90"
              onClick={(e) => onAdd(e, c)}
              title={`Add ${c.name} to canvas`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function ArchivedPane({
  loading,
  error,
  characters,
  onRestore,
  refetch,
}: {
  loading: boolean
  error: unknown
  characters: DbCharacter[]
  onRestore: (e: React.MouseEvent, c: DbCharacter) => void
  refetch: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mb-2" />
        <p className="text-sm">Loading archive...</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-destructive">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error instanceof Error ? error.message : "Failed to load archived characters"}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={refetch}>Retry</Button>
      </div>
    )
  }
  if (characters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <ArchiveRestore className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No archived characters</p>
        <p className="text-xs mt-1">Archived characters land here. Restore any time.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      {characters.map((c) => (
        <div key={c.id} className="relative group rounded-lg border border-border/50 bg-muted/10 p-3 flex flex-col items-center gap-1.5">
          {c.sourceImageUrl ? (
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted/30 opacity-60">
              <CachedImage src={c.sourceImageUrl} alt={c.name} className="w-full h-full object-cover" thumbnail thumbnailWidth={160} />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-lg bg-muted/30 flex items-center justify-center">
              <UserCircle className="w-8 h-8 text-muted-foreground/30" />
            </div>
          )}
          <span className="text-xs truncate w-full text-center opacity-70">{c.name}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1 mt-1"
            onClick={(e) => onRestore(e, c)}
            title={`Restore ${c.name}`}
          >
            <ArchiveRestore className="w-3 h-3" />
            Restore
          </Button>
        </div>
      ))}
    </div>
  )
}

function ArchiveConfirmModal({
  target,
  archiving,
  onCancel,
  onConfirm,
}: {
  target: { character: DbCharacter; usage: { workflowCount: number; workflows: { id: string; name: string }[] } | null }
  archiving: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { character, usage } = target
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={archiving ? undefined : onCancel} />
      <div className="relative bg-card border rounded-xl shadow-2xl w-[400px] max-w-[90vw] p-5">
        <h4 className="text-sm font-semibold mb-2">Archive '{character.name}'?</h4>
        <p className="text-xs text-muted-foreground mb-3">
          The character will be hidden from the library but won't be destroyed. Workflows that reference it keep working — restore from the Archived tab any time.
        </p>
        {usage === null ? (
          <p className="text-[11px] text-muted-foreground italic mb-3">Checking workflow usage…</p>
        ) : usage.workflowCount === 0 ? (
          <p className="text-[11px] text-muted-foreground mb-3">Not used in any workflows.</p>
        ) : (
          <div className="text-[11px] mb-3">
            <p className="text-foreground/80 mb-1">
              Used in {usage.workflowCount} workflow{usage.workflowCount === 1 ? "" : "s"}:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-0.5 max-h-[120px] overflow-y-auto">
              {usage.workflows.slice(0, 10).map((w) => (
                <li key={w.id} className="truncate">{w.name}</li>
              ))}
              {usage.workflows.length > 10 && <li className="italic">+ {usage.workflows.length - 10} more…</li>}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={archiving}>Cancel</Button>
          <Button size="sm" variant="destructive" onClick={onConfirm} disabled={archiving}>
            {archiving ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
            Archive
          </Button>
        </div>
      </div>
    </div>
  )
}
