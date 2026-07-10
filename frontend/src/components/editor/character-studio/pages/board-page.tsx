import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { Copy, LayoutGrid, Loader2, Pencil, Plus, RefreshCw, Star, Trash2, X } from "lucide-react"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import type { CharacterBoardEntry } from "@/types/nodes"
import { optimizedImageUrl } from "@/lib/image"
import { characterBoardItems } from "@nodaro/shared"
import { imageCollageApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { injectAssetAsCanvasNode, setCharacterNodeDefaultAsset } from "../inject-helpers"
import { BoardCreateModal } from "../board-create-modal"
import { STUDIO_CHILD_DIALOG_Z } from "../../studio-shell/studio-modal-z"
import {
  BOARD_COLLAGE_PARAMS,
  MAX_CHARACTER_BOARDS,
  buildBoardImageGroups,
  uniqueBoardName,
} from "../board-constants"

/**
 * Board page — the character's named composite reference boards, now MANAGED:
 * create identity boards from the big selection modal (all character-owned
 * images, ordered multi-select), duplicate an identity board (pre-selects its
 * sourceImages), delete column boards, and the existing ★ set-default / ＋
 * add-to-canvas actions. Legacy/studio boards without recorded sourceImages
 * render view-only (no Duplicate; no Delete for shim-only entries — they live
 * in selectedAssetByVariant, not the boards column).
 *
 * Persistence is worker-first: the generation carries attach fields so the
 * backend appends the finished board to the character row even if the studio
 * closes mid-flight; the modal-level onResolved ALSO appends locally for
 * instant UX (deduped by URL, converging with the worker write).
 */
export function BoardPage({ state, jobs }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerInitial, setComposerInitial] = useState<{ name: string; selectedUrls: readonly string[] } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<CharacterBoardEntry | null>(null)

  const defaultUrl = (state.staged as { defaultAssetUrl?: string }).defaultAssetUrl
  const columnBoards = (state.staged.boards ?? []) as readonly CharacterBoardEntry[]

  // Legacy shim boards (pre-column studioBoard:* keys) — view-only rows.
  // characterBoardItems returns column + shim MERGED, renaming empty-name
  // column boards to "board", so subtract the column by URL (its identity):
  // a name-based subtraction misses the renamed copy and double-renders the
  // board (live bug — studio.nodaro.ai saves identity sheets with name "").
  const legacyBoards = useMemo(() => {
    const columnUrls = new Set(columnBoards.map((b) => b.url))
    return characterBoardItems(state.staged as unknown as Record<string, unknown>)
      .filter((b) => !columnUrls.has(b.url))
      .map((b): CharacterBoardEntry => ({ name: b.name, url: b.url }))
  }, [columnBoards, state.staged])

  const allBoards = useMemo(() => [...columnBoards, ...legacyBoards], [columnBoards, legacyBoards])

  const groups = useMemo(() => buildBoardImageGroups(state.staged), [state.staged])

  // In-flight board generations (spinner tiles) + failed tiles with Retry.
  const pendingBoards = [...jobs.pending.entries()].filter(([, p]) => p.assetType === "boards")
  const failedBoards = [...jobs.failed.entries()].filter(([, f]) => f.assetType === "boards")
  const generatingNames = pendingBoards.map(([, p]) => p.name)

  const takenNames = useMemo(
    () => [...allBoards.map((b) => b.name), ...generatingNames],
    [allBoards, generatingNames],
  )

  // Cap check shared by the modal (disables Generate + shows a hint instead
  // of discarding the composed selection) and startGeneration below (belt-
  // and-braces for a cap reached between open and submit).
  const capReached = allBoards.length + pendingBoards.length >= MAX_CHARACTER_BOARDS

  async function startGeneration(args: { name: string; imageUrls: string[] }) {
    if (capReached) {
      toast.error(`Up to ${MAX_CHARACTER_BOARDS} boards — delete one first.`)
      return
    }
    // The modal suffixed against its snapshot; re-suffix against the live set
    // (a concurrent generation may have claimed the name meanwhile).
    const finalName = uniqueBoardName(args.name, takenNames.filter((n) => n !== args.name))
    const tempId = jobs.begin("boards", finalName, { sourceImages: args.imageUrls, type: "identity" })
    try {
      const dbId = await state.ensureSaved()
      const { jobId } = await imageCollageApi(args.imageUrls, {
        ...BOARD_COLLAGE_PARAMS,
        attachToCharacterId: dbId,
        attachToColumn: "boards",
        attachName: finalName,
        attachBoardType: "identity",
      })
      jobs.settle(tempId, jobId)
    } catch (e) {
      jobs.abort(tempId)
      toast.error(e instanceof Error ? e.message : "Couldn't start the board generation")
    }
  }

  function openNew() {
    setComposerInitial(null)
    setComposerOpen(true)
  }

  function openDuplicate(b: CharacterBoardEntry) {
    setComposerInitial({
      name: uniqueBoardName(b.name, takenNames),
      selectedUrls: b.sourceImages ?? [],
    })
    setComposerOpen(true)
  }

  function deleteBoard(b: CharacterBoardEntry) {
    state.patchWith((prev) => ({
      boards: (prev.boards ?? []).filter((x) => !(x.name === b.name && x.url === b.url)),
    }))
  }

  function renameBoard(b: CharacterBoardEntry, newName: string) {
    state.patchWith((prev) => {
      const arr = prev.boards ?? []
      // Suffix against every OTHER board + in-flight names, same policy as
      // create/duplicate — board names shadow legacy shim entries and feed
      // uniqueBoardName everywhere, so collisions must stay impossible.
      const taken = [
        ...arr.filter((x) => !(x.name === b.name && x.url === b.url)).map((x) => x.name),
        ...generatingNames,
      ]
      const finalName = uniqueBoardName(newName, taken)
      return { boards: arr.map((x) => (x.name === b.name && x.url === b.url ? { ...x, name: finalName } : x)) }
    })
  }

  function retryFailed(jobId: string, name: string, meta: Record<string, unknown> | undefined) {
    const sourceImages = Array.isArray(meta?.sourceImages) ? (meta.sourceImages as string[]) : null
    if (!sourceImages) return
    jobs.dismissFailed(jobId)
    void startGeneration({ name, imageUrls: sourceImages })
  }

  const isEmpty = allBoards.length === 0 && pendingBoards.length === 0 && failedBoards.length === 0

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Identity boards composite your picked images into one dense reference sheet.
        </p>
        <Button type="button" size="sm" onClick={openNew}>
          <Plus className="size-4" /> New board
        </Button>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center px-3 py-10 text-center">
          <LayoutGrid className="mb-2 size-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No boards yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Create one from this character's images — it preserves identity in a single reference.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allBoards.map((b, i) => {
            const isColumn = i < columnBoards.length
            const canDuplicate = b.type === "identity" && (b.sourceImages?.length ?? 0) > 0
            return (
              <figure
                key={`${b.name}-${i}`}
                className="group relative overflow-hidden rounded-md border border-border bg-[#1a1d27]"
              >
                <a href={b.url} target="_blank" rel="noopener noreferrer" title="Open full size">
                  <img src={optimizedImageUrl(b.url)} alt={b.name} className="w-full object-contain" loading="lazy" />
                </a>
                {b.type === "identity" && (
                  <span className="absolute left-1.5 top-1.5 rounded bg-primary/90 px-1 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground">
                    Identity
                  </span>
                )}
                <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    title="Set as the character node's default image"
                    onClick={() => setCharacterNodeDefaultAsset(state.staged, state.patch, b)}
                    className={cn(
                      "rounded p-1",
                      defaultUrl === b.url ? "bg-yellow-400 text-black" : "bg-black/60 text-white hover:bg-black/80",
                    )}
                  >
                    <Star className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Use on canvas (creates an upload-image node)"
                    onClick={() => injectAssetAsCanvasNode({ sourceCharacterNodeId: state.nodeId, item: b, isVideo: false })}
                    className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  {canDuplicate && (
                    <button
                      type="button"
                      title="Duplicate — reopen the composer with this board's images selected"
                      aria-label={`Duplicate board ${b.name}`}
                      onClick={() => openDuplicate(b)}
                      className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
                    >
                      <Copy className="size-3.5" />
                    </button>
                  )}
                  {isColumn && (
                    <button
                      type="button"
                      title="Delete board"
                      aria-label={`Delete board ${b.name}`}
                      onClick={() => setConfirmDelete(b)}
                      className="rounded bg-black/60 p-1 text-white hover:bg-red-600/90"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                {isColumn ? (
                  <BoardCaption name={b.name} onRename={(next) => renameBoard(b, next)} />
                ) : (
                  b.name && (
                    <figcaption className="truncate px-2 py-1.5 text-xs text-muted-foreground">{b.name}</figcaption>
                  )
                )}
              </figure>
            )
          })}

          {pendingBoards.map(([jobId, p]) => (
            <div
              key={jobId}
              className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" />
              <span className="px-2 text-center text-xs">
                Generating "{p.name}"… {p.progress > 0 ? `${p.progress}%` : ""}
              </span>
              <button
                type="button"
                title="Cancel this generation — reserved credits are refunded"
                className="text-[11px] underline"
                onClick={() => void jobs.cancel(jobId)}
              >
                Cancel
              </button>
            </div>
          ))}

          {failedBoards.map(([jobId, f]) => (
            <div
              key={jobId}
              className="relative flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-red-500/50 text-muted-foreground"
            >
              <span className="px-2 text-center text-xs">"{f.name}" failed.</span>
              {Array.isArray(f.meta?.sourceImages) && (
                <Button type="button" size="sm" variant="outline" onClick={() => retryFailed(jobId, f.name, f.meta)}>
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              )}
              <button
                type="button"
                aria-label="Dismiss failed board"
                onClick={() => jobs.dismissFailed(jobId)}
                className="absolute right-1.5 top-1.5 rounded bg-black/60 p-1 text-white hover:bg-black/80"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <BoardCreateModal
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        groups={groups}
        boards={columnBoards}
        generatingNames={generatingNames}
        initial={composerInitial}
        capReached={capReached}
        onGenerate={(args) => void startGeneration(args)}
      />

      <DeleteConfirmationDialog
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) deleteBoard(confirmDelete)
        }}
        title="Delete board?"
        description={confirmDelete ? `"${confirmDelete.name}" will be removed from this character.` : undefined}
        className={STUDIO_CHILD_DIALOG_Z}
        overlayClassName={STUDIO_CHILD_DIALOG_Z}
      />
    </div>
  )
}

/**
 * Column-board caption — click-to-edit rename, mirroring asset-card's
 * NameLabel interaction: clicking the name (or pencil) swaps in an input;
 * Enter/blur commits the trimmed value (empty → keep the old name), Escape
 * cancels. Unnamed boards (studio.nodaro.ai identity sheets save with
 * name "") get an "Add name…" affordance instead of no caption at all.
 */
function BoardCaption({ name, onRename }: { name: string; onRename: (newName: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed.length > 0 && trimmed !== name) onRename(trimmed)
  }

  if (editing) {
    return (
      <figcaption className="px-2 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            } else if (e.key === "Escape") {
              e.preventDefault()
              setEditing(false)
              setDraft(name)
            }
          }}
          maxLength={200}
          aria-label="Board name"
          className="w-full rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground outline-none"
        />
      </figcaption>
    )
  }

  return (
    <figcaption className="px-2 py-1.5 text-xs text-muted-foreground">
      <button
        type="button"
        title="Rename"
        aria-label={`Rename board ${name}`}
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        className="flex w-full min-w-0 items-center gap-1 text-left"
      >
        {name ? (
          <span className="truncate">{name}</span>
        ) : (
          <span className="italic text-muted-foreground/60">Add name…</span>
        )}
        <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>
    </figcaption>
  )
}
