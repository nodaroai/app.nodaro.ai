/**
 * The two visibility surfaces of copilot memory (M1):
 *
 *  - `MemorySavedPins` — a pinned line per memory saved THIS turn, with a
 *    one-tap Undo. Every write shows one; there is no silent remembering.
 *  - `CopilotMemoriesButton` + dialog — "What the Copilot remembers": the
 *    durable list, each row deletable. Trust comes from the user seeing
 *    exactly what is stored, so the list is fetched fresh on every open.
 *
 * Undo calls DELETE FIRST and removes the pin only on success — a pin
 * vanishing while the row survives would be the exact false comfort this
 * surface exists to prevent.
 */
import { useEffect, useState } from "react"
import { Bookmark, Trash2, X } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { deleteCopilotMemory, listCopilotMemories, type CopilotMemory } from "@/ee/lib/copilot/api"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"

export function MemorySavedPins() {
  const memorySaves = useCopilotStore((s) => s.turn.memorySaves)
  const removeMemorySave = useCopilotStore((s) => s.removeMemorySave)
  const setNotice = useCopilotStore((s) => s.setNotice)
  const [undoing, setUndoing] = useState<string | null>(null)

  if (memorySaves.length === 0) return null

  const undo = async (id: string) => {
    setUndoing(id)
    try {
      await deleteCopilotMemory(id)
      removeMemorySave(id)
    } catch {
      setNotice(S.memoryUndoFailed)
    } finally {
      setUndoing(null)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {memorySaves.map((memory) => (
        <div
          key={memory.id}
          className="flex items-center gap-2 px-2.5 py-2 bg-[var(--copilot-card)] border border-border rounded-[10px]"
        >
          <Bookmark className="w-3 h-3 flex-none text-primary" strokeWidth={2.2} aria-hidden />
          <span className="min-w-0 flex-1 text-[11.5px] leading-[1.45] text-foreground break-words">
            <span className="text-[var(--copilot-dim)]">{S.memoryRemembered} · </span>
            {memory.content}
          </span>
          <button
            type="button"
            onClick={() => void undo(memory.id)}
            disabled={undoing === memory.id}
            className="flex-none text-[11px] text-[var(--copilot-muted)] hover:text-foreground underline disabled:opacity-50"
          >
            {S.memoryUndo}
          </button>
        </div>
      ))}
    </div>
  )
}

export function CopilotMemoriesButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={S.memoriesOpen}
        title={S.memoriesOpen}
        className="w-[26px] h-[26px] rounded-[7px] border border-border text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center transition-colors"
      >
        <Bookmark className="w-3 h-3" strokeWidth={2.2} />
      </button>
      {open && <MemoriesDialog onClose={() => setOpen(false)} />}
    </>
  )
}

function MemoriesDialog({ onClose }: { onClose: () => void }) {
  const [memories, setMemories] = useState<CopilotMemory[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    // A fast open/close must not set state on an unmounted dialog.
    let cancelled = false
    void (async () => {
      try {
        const { memories } = await listCopilotMemories()
        if (!cancelled) {
          setMemories(memories)
          setFailed(false)
        }
      } catch {
        if (!cancelled) {
          setFailed(true)
          setMemories([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const forget = async (id: string) => {
    try {
      await deleteCopilotMemory(id)
      setMemories((current) => (current ?? []).filter((m) => m.id !== id))
    } catch {
      setFailed(true)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal aria-label={S.memoriesTitle}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative w-[420px] max-w-[92vw] max-h-[70vh] flex flex-col bg-[var(--copilot-card)] border border-[var(--copilot-strong)] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Bookmark className="w-3.5 h-3.5 text-primary" strokeWidth={2.2} aria-hidden />
          <span className="text-[13px] font-semibold text-foreground">{S.memoriesTitle}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={S.close}
            className="ml-auto w-[26px] h-[26px] rounded-[7px] border border-border text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center"
          >
            <X className="w-3 h-3" strokeWidth={2.2} />
          </button>
        </div>

        <div className="px-4 py-2.5 text-[11.5px] leading-[1.5] text-[var(--copilot-muted)] border-b border-border">
          {S.memoriesBlurb}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {failed ? (
            <div className="px-2.5 py-4 text-[11.5px] text-[var(--copilot-fail)]">{S.memoriesLoadFailed}</div>
          ) : memories === null ? (
            <div className="px-2.5 py-4 text-[11.5px] text-[var(--copilot-muted)]">{S.pickerLoading}</div>
          ) : memories.length === 0 ? (
            <div className="px-2.5 py-4 text-[11.5px] text-[var(--copilot-muted)]">{S.memoriesEmpty}</div>
          ) : (
            memories.map((memory) => (
              <div key={memory.id} className="flex items-start gap-2 px-2.5 py-2 rounded-lg hover:bg-[var(--copilot-surface)]">
                <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-foreground break-words">{memory.content}</span>
                <button
                  type="button"
                  onClick={() => void forget(memory.id)}
                  aria-label={`${S.memoriesDelete}: ${memory.content.slice(0, 40)}`}
                  className="flex-none mt-0.5 inline-flex items-center gap-1 text-[11px] text-[var(--copilot-muted)] hover:text-[var(--copilot-fail)]"
                >
                  <Trash2 className="w-3 h-3" strokeWidth={2} aria-hidden />
                  {S.memoriesDelete}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
