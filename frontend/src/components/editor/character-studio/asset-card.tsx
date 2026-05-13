import { useEffect, useRef, useState } from "react"
import { Link as LinkIcon, Maximize2 } from "lucide-react"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { copyToClipboard } from "@/lib/utils"

export interface AssetCardItem {
  readonly name: string
  readonly url: string
}

interface AssetCardProps {
  readonly item: AssetCardItem
  readonly isVideo?: boolean
  readonly onDelete: () => void
  /** undefined → no refine button (e.g. motions in Phase 1) */
  readonly onRefine?: (refinementPrompt: string, mode: "replace" | "add") => void
  /** undefined → no regen buttons. "replace" deletes the current card and regenerates same variant;
   *  "add" appends a fresh variation as a new card. */
  readonly onRegenerate?: (mode: "replace" | "add") => void
  /** undefined → name label is read-only; defined → label becomes inline-editable */
  readonly onRename?: (newName: string) => void
  readonly errored?: boolean
  /** Model identifier used to look up CR cost for the regen + refine buttons. */
  readonly costModel?: string
  /** Called when the user clicks the Enlarge button. Caller manages the
   *  lightbox + decides which list to navigate across. Image-only — omit
   *  for video items. */
  readonly onEnlarge?: () => void
}

export function AssetCard({ item, isVideo, onDelete, onRefine, onRegenerate, onRename, errored, costModel, onEnlarge }: AssetCardProps) {
  const [refining, setRefining] = useState(false)
  const [prompt, setPrompt] = useState("")
  const cost = useModelCredits(costModel, 0)
  const costLabel = cost > 0 ? ` (${cost} CR)` : ""

  return (
    <div className="relative rounded-md overflow-hidden bg-[#1a1d27] group">
      <div className="aspect-[3/4] bg-gradient-to-br from-[#1e2535] to-[#252836] flex items-center justify-center">
        {isVideo ? (
          <video src={item.url} className="w-full h-full object-cover" muted playsInline />
        ) : (
          <img src={item.url} alt={item.name} className="w-full h-full object-cover" />
        )}
        {isVideo && (
          <span className="absolute inset-0 flex items-center justify-center text-white/80 pointer-events-none">▶</span>
        )}
        {errored && (
          <span className="absolute inset-0 flex items-center justify-center text-red-400 text-xs bg-black/50">failed</span>
        )}
        {/* Top-left hover overlay: matches the pattern used by canvas nodes
            (upload-image-node, generate-image-node, …). Image-only — videos
            already preview inline so the lightbox would be redundant; the
            video provider's URL isn't useful to copy as text. */}
        {!isVideo && (
          <div className="absolute top-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            {onEnlarge && (
              <button
                type="button"
                aria-label="Enlarge"
                title="Enlarge"
                className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onEnlarge()
                }}
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              aria-label="Copy URL"
              title="Copy URL"
              className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => {
                e.stopPropagation()
                copyToClipboard(item.url, "URL copied")
              }}
            >
              <LinkIcon className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5 flex items-center justify-between gap-1.5">
        <NameLabel name={item.name} onRename={onRename} />
        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition shrink-0">
          {onRegenerate && (
            <button
              title={`regenerate same — replace${costLabel}`}
              className="text-[11px] text-slate-500 hover:text-slate-200"
              onClick={() => onRegenerate("replace")}
            >
              ↻
            </button>
          )}
          {onRegenerate && (
            <button
              title={`add variation${costLabel}`}
              className="text-[11px] text-slate-500 hover:text-slate-200"
              onClick={() => onRegenerate("add")}
            >
              ＋
            </button>
          )}
          {onRefine && (
            <button
              title={`img2img refine${costLabel}`}
              className="text-[11px] text-slate-500 hover:text-slate-200"
              onClick={() => setRefining((v) => !v)}
            >
              ✏
            </button>
          )}
          <button
            title="delete"
            className="text-[11px] text-slate-500 hover:text-red-400"
            onClick={onDelete}
          >
            ✕
          </button>
        </div>
      </div>
      {refining && onRefine && (
        <div className="absolute inset-x-0 bottom-0 bg-[#0d1017]/95 p-2 space-y-1.5">
          <input
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="refine: e.g. same expression, more intense"
            className="w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1 text-slate-200"
          />
          <div className="flex gap-1.5">
            <button
              className="flex-1 text-[10px] bg-[#3b82f6] text-white rounded px-2 py-1"
              onClick={() => {
                onRefine(prompt, "replace")
                setRefining(false)
                setPrompt("")
              }}
            >
              Replace{costLabel}
            </button>
            <button
              className="flex-1 text-[10px] bg-[#1e293b] text-slate-300 rounded px-2 py-1"
              onClick={() => {
                onRefine(prompt, "add")
                setRefining(false)
                setPrompt("")
              }}
            >
              Add as new{costLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Renders the asset's structured tag. When `onRename` is provided the label is click-to-edit:
 * clicking the text (or the ✎ pencil) swaps in a minimal text input pre-filled with the current
 * name. Enter / blur commits the trimmed value via `onRename` (empty input → keep old name);
 * Escape cancels. With no `onRename` it stays plain truncated text (original behavior).
 */
function NameLabel({ name, onRename }: { name: string; onRename?: (newName: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const beginEdit = () => {
    setDraft(name)
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed.length > 0 && trimmed !== name && onRename) onRename(trimmed)
  }

  const cancel = () => {
    setEditing(false)
    setDraft(name)
  }

  if (!onRename) {
    return <span className="text-[11px] text-slate-300 truncate">{name}</span>
  }

  if (editing) {
    return (
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
            cancel()
          }
        }}
        className="min-w-0 flex-1 text-[11px] bg-[#13161f] border border-[#334155] rounded px-1 py-0.5 text-slate-200 outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      title="rename"
      onClick={beginEdit}
      className="min-w-0 flex items-center gap-1 text-left group/name"
    >
      <span className="text-[11px] text-slate-300 truncate">{name}</span>
      <span className="text-[9px] text-slate-600 opacity-0 group-hover:opacity-100 group-hover/name:text-slate-300 transition shrink-0">✎</span>
    </button>
  )
}
