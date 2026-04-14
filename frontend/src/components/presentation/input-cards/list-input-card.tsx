import { useCallback, useMemo } from "react"
import { Plus, X } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import type { WorkflowNode } from "@/types/nodes"
import { GlassCard } from "../output-cards/shared"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import type { PromptContext } from "@/lib/prompt-context"

interface ListInputCardProps {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  maxItems: number
  promptHelper?: PromptContext
}

export function ListInputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  maxItems,
  promptHelper,
}: ListInputCardProps) {
  const items: string[] = useMemo(() => {
    if (isFullscreen) {
      const stored = inputValues[node.id]?.items
      if (Array.isArray(stored) && stored.length > 0) return stored as string[]
    } else {
      // Modern format (columns+rows) wins — legacy items string is a fallback
      // for older list nodes. Without the modern branch, modern lists in
      // presentation input cards rendered as a single empty row.
      const d = node.data as Record<string, unknown>
      if (d.columns) {
        const rows = (d.rows as string[][] | undefined) ?? []
        const cells = rows.map((r) => r[0] ?? "").filter((v, i, arr) => v.trim() || i === arr.length - 1)
        if (cells.length > 0) return cells
      }
      const raw = d.items as string | undefined
      if (raw && typeof raw === "string" && raw.trim()) {
        return raw.split("\n")
      }
    }
    return [""]
  }, [isFullscreen, inputValues, node.id, node.data])

  const updateItems = useCallback(
    (newItems: string[]) => {
      if (isFullscreen) {
        onUpdateInput(node.id, "items", newItems)
      } else {
        // Write to whichever format the list is in — writing items on a
        // modern list would create stale legacy data that gets ignored by
        // readers but leaves the rows unchanged.
        const d = node.data as Record<string, unknown>
        if (d.columns) {
          useWorkflowStore.getState().updateNodeData(node.id, { rows: newItems.map((v) => [v]) })
        } else {
          useWorkflowStore.getState().updateNodeData(node.id, { items: newItems.join("\n") })
        }
      }
    },
    [isFullscreen, node.id, node.data, onUpdateInput],
  )

  const handleItemChange = useCallback(
    (index: number, value: string) => {
      const next = [...items]
      next[index] = value
      updateItems(next)
    },
    [items, updateItems],
  )

  const handleAdd = useCallback(() => {
    if (items.length >= maxItems) return
    updateItems([...items, ""])
  }, [items, maxItems, updateItems])

  const handleRemove = useCallback(
    (index: number) => {
      if (items.length <= 1) return
      updateItems(items.filter((_, i) => i !== index))
    },
    [items, updateItems],
  )

  const atMax = items.length >= maxItems
  const label = (node.data.label as string) || "List"

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-3">
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground/70">
            {items.length} of {maxItems} max
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={handleAdd}
              disabled={atMax}
              className="flex items-center justify-center w-6 h-6 rounded-md bg-[#ff0073] text-white transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
              title="Add item"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={index} className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <div className="flex items-center justify-between pl-1">
                <span className="text-[11px] text-muted-foreground/60">
                  #{index + 1}
                </span>
                {promptHelper && (
                  <PromptHelperButton
                    nodeType={promptHelper.nodeType}
                    currentPrompt={item}
                    provider={promptHelper.provider}
                    aspectRatio={promptHelper.aspectRatio}
                    duration={promptHelper.duration}
                    onAccept={(text) => handleItemChange(index, text)}
                  />
                )}
              </div>
              <textarea
                value={item}
                onChange={(e) => handleItemChange(index, e.target.value)}
                readOnly={readOnly}
                placeholder={`Item ${index + 1}...`}
                className={`w-full min-h-[56px] bg-muted/30 border border-border rounded-lg px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200${readOnly ? " opacity-70 cursor-default" : ""}`}
              />
            </div>
            {!readOnly && items.length > 1 && (
              <>
                {/* Desktop: small X button */}
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="hidden sm:flex items-start pt-6 shrink-0"
                  title="Remove item"
                >
                  <span className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </span>
                </button>
                {/* Mobile: text button */}
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  className="sm:hidden self-end shrink-0 text-[11px] text-muted-foreground/50 hover:text-red-400 pb-1 transition-colors"
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Mobile-only full-width add button */}
      {!readOnly && !atMax && (
        <button
          type="button"
          onClick={handleAdd}
          className="sm:hidden w-full mt-3 py-2 border-2 border-dashed border-muted-foreground/20 rounded-lg text-xs text-muted-foreground/60 hover:border-[#ff0073]/40 hover:text-muted-foreground transition-colors"
        >
          + Add Prompt
        </button>
      )}

      {hasCredits() && (
        <div className="mt-3 px-3 py-2 rounded-md bg-[#ff007310] border border-[#ff007330] flex justify-between items-center">
          <span className="text-xs text-[#ff0073]">Fan-out</span>
          <span className="text-sm font-semibold text-[#ff0073]">
            {items.length} {items.length === 1 ? "iteration" : "iterations"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
