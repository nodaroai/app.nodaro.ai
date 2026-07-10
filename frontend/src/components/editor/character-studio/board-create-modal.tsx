"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, LayoutGrid, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { STUDIO_CHILD_DIALOG_Z } from "../studio-shell/studio-modal-z"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { hasCredits } from "@/lib/edition"
import { optimizedImageUrl } from "@/lib/image"
import { cn } from "@/lib/utils"
import type { CharacterBoardEntry } from "@/types/nodes"
import {
  BOARD_CREDIT_MODEL_ID,
  MAX_BOARD_IMAGES,
  MAX_CHARACTER_BOARDS,
  MIN_BOARD_IMAGES,
  uniqueBoardName,
  type BoardImageGroup,
} from "./board-constants"

/**
 * The big identity-board composer: every character-owned image in a grouped
 * grid, click-to-toggle with NUMBERED selection order (= collage input
 * order), a "Start from a board" strip that re-applies an existing identity
 * board's sourceImages, and a name field that collision-suffixes on
 * generate. Purely presentational about jobs — `onGenerate` hands the final
 * name + urls to the Board page, which owns ensureSaved/begin/settle.
 */
export interface BoardCreateModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly groups: readonly BoardImageGroup[]
  readonly boards: readonly CharacterBoardEntry[]
  readonly generatingNames: readonly string[]
  readonly initial?: { readonly name: string; readonly selectedUrls: readonly string[] } | null
  /** Board cap reached — Generate disables with a hint instead of discarding the selection at submit time. */
  readonly capReached?: boolean
  readonly onGenerate: (args: { name: string; imageUrls: string[] }) => void
}

export function BoardCreateModal({
  open,
  onClose,
  groups,
  boards,
  generatingNames,
  initial,
  capReached,
  onGenerate,
}: BoardCreateModalProps) {
  const [name, setName] = useState("")
  const [selected, setSelected] = useState<readonly string[]>([])
  const cost = useModelCredits(BOARD_CREDIT_MODEL_ID, 0)

  const poolUrls = useMemo(() => new Set(groups.flatMap((g) => g.items.map((i) => i.url))), [groups])

  // (Re)apply the initial name/selection each time the modal opens — covers
  // both "New board" (blank) and "Duplicate" (pre-selected) entries.
  // Reset only on the closed→open TRANSITION — a groups/initial identity
  // change mid-edit (studio staged-state patches rebuild `groups` on every
  // debounced save / job-poll append) must NOT clobber the user's
  // in-progress selection.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setName(initial?.name ?? "")
      setSelected((initial?.selectedUrls ?? []).filter((u) => poolUrls.has(u)).slice(0, MAX_BOARD_IMAGES))
    }
    wasOpen.current = open
  }, [open, initial, poolUrls])

  const startFromBoards = boards.filter((b) => b.type === "identity" && (b.sourceImages?.length ?? 0) > 0)

  const toggle = (url: string) => {
    setSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url)
      if (prev.length >= MAX_BOARD_IMAGES) {
        toast.error(`Up to ${MAX_BOARD_IMAGES} images per board.`)
        return prev
      }
      return [...prev, url]
    })
  }

  const applyBoard = (b: CharacterBoardEntry) => {
    setSelected((b.sourceImages ?? []).filter((u) => poolUrls.has(u)).slice(0, MAX_BOARD_IMAGES))
    if (!name.trim()) setName(b.name)
  }

  const takenNames = useMemo(
    () => [...boards.map((b) => b.name), ...generatingNames],
    [boards, generatingNames],
  )

  const canGenerate = selected.length >= MIN_BOARD_IMAGES && !capReached

  const handleGenerate = () => {
    if (!canGenerate) return
    const finalName = uniqueBoardName(name.trim() || "Identity board", takenNames)
    onGenerate({ name: finalName, imageUrls: [...selected] })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      {/* STUDIO_CHILD_DIALOG_Z on content + overlay: the composer opens from
          inside the opaque z-[100] studio modal — at the stock z-50 it lands
          BEHIND the studio and "New board" looks dead. */}
      <DialogContent
        className={`flex max-h-[85vh] w-[min(64rem,92vw)] max-w-5xl flex-col gap-3 ${STUDIO_CHILD_DIALOG_Z}`}
        overlayClassName={STUDIO_CHILD_DIALOG_Z}
      >
        <DialogHeader>
          <DialogTitle>Create identity board</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Board name — the look, e.g. "Evening gown"'
            aria-label="Board name"
            className="h-8 max-w-sm text-sm"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            {selected.length}/{MAX_BOARD_IMAGES} selected
          </span>
        </div>

        {startFromBoards.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Start from a board — re-selects its source images
            </p>
            <div className="flex flex-wrap gap-1.5">
              {startFromBoards.map((b) => (
                <button
                  key={`${b.name}-${b.url}`}
                  type="button"
                  aria-label={`Start from ${b.name}`}
                  onClick={() => applyBoard(b)}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:border-primary/60"
                >
                  <LayoutGrid className="size-3.5 text-muted-foreground" />
                  {/* Unnamed boards (legacy studio sheets) fall back to "board"
                      so the chip never renders as a bare icon. */}
                  <span className="max-w-32 truncate">{b.name || "board"}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-1">
          {groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              This character has no images yet — generate a portrait or some variants first.
            </p>
          ) : (
            groups.map((g) => (
              <section key={g.id} className="mb-4">
                <h3 className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
                  {g.items.map((it) => {
                    const order = selected.indexOf(it.url)
                    const on = order !== -1
                    return (
                      <button
                        key={it.url}
                        type="button"
                        aria-label={it.name || it.url}
                        aria-pressed={on}
                        onClick={() => toggle(it.url)}
                        className={cn(
                          "group relative aspect-square overflow-hidden rounded-md border transition-all",
                          on ? "border-primary ring-2 ring-primary" : "border-border opacity-80 hover:opacity-100",
                        )}
                      >
                        <img
                          src={optimizedImageUrl(it.url, { width: 240, quality: 80 })}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                        {on && (
                          <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                            {order + 1}
                          </span>
                        )}
                        {on && (
                          <span className="absolute right-1 top-1 rounded-sm bg-primary p-0.5 text-primary-foreground">
                            <Check className="size-3" />
                          </span>
                        )}
                        {it.name && (
                          <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-left text-[10px] text-white">
                            {it.name}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {capReached
              ? `Up to ${MAX_CHARACTER_BOARDS} boards — delete one first.`
              : `Composites ${selected.length >= MIN_BOARD_IMAGES ? selected.length : `${MIN_BOARD_IMAGES}+`} images into one 4K identity sheet.`}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={!canGenerate} onClick={handleGenerate}>
              <Sparkles className="size-4" />
              {hasCredits() && cost > 0 ? `Generate (${cost} CR)` : "Generate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
