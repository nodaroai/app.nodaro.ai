/**
 * Connect dialog — shown after the user picks a node type in auto-connect mode
 * (Tab from a focused node). Lets them name the new node and choose how it wires
 * to the focused node: a handle option (both directions), a text-`{variable}`
 * shortcut (auto-names the node), or "Don't connect".
 *
 * Styled like add-node-popup (fixed z-[100] panel, not a Radix Dialog), Esc or
 * an outside click to cancel, no focus trap. Keyboard: ↑/↓ move the highlight
 * across the combined list, Enter confirms, Esc cancels.
 */
import { useCallback, useMemo, useRef, useState } from "react"
import { Link2, Unlink } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/hooks/use-click-outside"
import type { ConnectionOption, ConnectionOptions } from "@/lib/enumerate-connection-options"

export interface ConnectNodeChoice {
  /** null = "don't connect (just add)". */
  readonly option: ConnectionOption | null
  readonly name: string
}

interface ConnectNodeDialogProps {
  readonly focusedLabel: string
  readonly newLabel: string
  readonly options: ConnectionOptions
  readonly onConfirm: (choice: ConnectNodeChoice) => void
  readonly onCancel: () => void
}

type Row =
  | { kind: "handle"; opt: ConnectionOption }
  | { kind: "variable"; opt: ConnectionOption }
  | { kind: "none" }

export function ConnectNodeDialog({ focusedLabel, newLabel, options, onConfirm, onCancel }: ConnectNodeDialogProps) {
  const rows = useMemo<Row[]>(
    () => [
      ...options.handles.map((opt) => ({ kind: "handle" as const, opt })),
      ...options.variables.map((opt) => ({ kind: "variable" as const, opt })),
      { kind: "none" as const },
    ],
    [options],
  )

  const [name, setName] = useState(newLabel)
  const [highlight, setHighlight] = useState(options.handles.length > 0 ? 0 : rows.length - 1)

  const dialogRef = useRef<HTMLDivElement>(null)
  useClickOutside(dialogRef, onCancel)

  const select = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, i))
      setHighlight(clamped)
      const row = rows[clamped]
      if (row?.kind === "variable" && row.opt.variableName) setName(row.opt.variableName)
    },
    [rows],
  )

  const confirm = useCallback(
    (i: number) => {
      const row = rows[i]
      if (!row) return
      const option = row.kind === "none" ? null : row.opt
      const finalName = row.kind === "variable" && row.opt.variableName ? row.opt.variableName : name
      onConfirm({ option, name: finalName.trim() || newLabel })
    },
    [rows, name, newLabel, onConfirm],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        select(highlight + 1)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        select(highlight - 1)
      } else if (e.key === "Enter") {
        e.preventDefault()
        confirm(highlight)
      } else if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    },
    [highlight, select, confirm, onCancel],
  )

  const rowClass = (active: boolean) =>
    cn(
      "w-full flex items-center gap-3 px-4 py-2 text-left transition-colors relative",
      active ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]" : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]",
    )

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`Connect ${newLabel} to ${focusedLabel}`}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] w-[28rem] max-w-[calc(100vw-16px)] flex flex-col",
        "bg-white dark:bg-[#1E1E1E] border border-[#E2E8F0] dark:border-[#2D2D2D] rounded-xl shadow-xl overflow-hidden",
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
        <h3 className="text-[15px] font-semibold text-[#1E293B] dark:text-white flex items-center gap-2">
          <span>Add &ldquo;{newLabel}&rdquo;</span>
          <span className="text-[#94A3B8]">&rarr;</span>
          <span className="text-[#ff0073]">{focusedLabel}</span>
        </h3>
      </div>

      {/* Name */}
      <div className="px-4 pt-3 pb-1">
        <label className="block text-xs font-semibold text-[#475569] dark:text-[#cbd5e1] mb-1.5">Name</label>
        <input
          autoFocus
          aria-label="Node name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-lg border",
            "bg-[#F8FAFC] dark:bg-[#121212] border-[#E2E8F0] dark:border-[#2D2D2D] text-[#1E293B] dark:text-white",
            "focus:outline-none focus:ring-2 focus:ring-[#ff0073]/50 focus:border-[#ff0073]",
          )}
        />
      </div>

      <div className="py-1 max-h-[50vh] overflow-y-auto">
        {options.handles.length > 0 && (
          <div className="px-4 pt-2 pb-1 text-[10.5px] font-bold tracking-wider uppercase text-[#94A3B8]">Handles</div>
        )}
        {rows.map((row, i) => {
          if (row.kind !== "handle") return null
          // Direction relative to the focused ("Current") node: `source` = the
          // focused node feeds the new one (new runs AFTER current); `target` =
          // the new node feeds the focused one (new runs BEFORE current). Shown as
          // a Before/After chip + the New/Current role the wire feeds into, which
          // replaced the older "from/to {focusedLabel}" wording.
          const isAfter = row.opt.direction === "source"
          return (
            <button
              key={`h-${row.opt.direction}-${row.opt.fHandle}-${row.opt.nHandle}`}
              type="button"
              aria-label={`${isAfter ? "After" : "Before"}: wires into ${isAfter ? "new" : "current"} node, ${row.opt.label}`}
              className={rowClass(i === highlight)}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => confirm(i)}
            >
              {i === highlight && <span className="absolute left-0 top-1 bottom-1 w-[2.5px] rounded bg-[#ff0073]" />}
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.opt.color ?? "#94A3B8" }} />
              <span className="flex flex-1 items-center gap-1.5 min-w-0">
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    isAfter
                      // green-800 (not -600) so the small uppercase text clears WCAG AA on the pale tint
                      ? "bg-[#22C55E]/15 text-[#166534] dark:text-[#4ADE80]"
                      : "bg-[#3B82F6]/15 text-[#2563EB] dark:text-[#60A5FA]",
                  )}
                >
                  {isAfter ? "After" : "Before"}
                </span>
                <span className="shrink-0 text-xs text-[#94A3B8]">wires into</span>
                <span
                  className={cn(
                    "shrink-0 text-xs font-semibold",
                    isAfter ? "text-[#1E293B] dark:text-[#e8eaed]" : "text-[#ff0073]",
                  )}
                >
                  {isAfter ? "New" : "Current"}
                </span>
                <span className="shrink-0 text-[#94A3B8]" aria-hidden="true">&rsaquo;</span>
                <span className="flex-1 truncate text-sm font-medium text-[#1E293B] dark:text-[#e8eaed]">{row.opt.label}</span>
              </span>
            </button>
          )
        })}

        {options.variables.length > 0 && (
          <div className="px-4 pt-2 pb-1 text-[10.5px] font-bold tracking-wider uppercase text-[#94A3B8]">Missing variables</div>
        )}
        {rows.map((row, i) => {
          if (row.kind === "variable") {
            return (
              <button
                key={`v-${row.opt.variableName}`}
                type="button"
                className={rowClass(i === highlight)}
                onMouseEnter={() => select(i)}
                onClick={() => confirm(i)}
              >
                {i === highlight && <span className="absolute left-0 top-1 bottom-1 w-[2.5px] rounded bg-[#ff0073]" />}
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-[#F59E0B]" />
                <span className="flex-1 text-sm font-semibold text-[#d97706] dark:text-[#F59E0B]">{`{${row.opt.variableName}}`}</span>
                <span className="text-xs text-[#94A3B8]">{`names node "${row.opt.variableName}" · wires ${row.opt.label}`}</span>
              </button>
            )
          }
          return null
        })}

        <div className="h-px my-1.5 mx-4 bg-[#E2E8F0] dark:bg-[#2D2D2D]" />
        {(() => {
          const i = rows.length - 1
          return (
            <button type="button" className={rowClass(i === highlight)} onMouseEnter={() => setHighlight(i)} onClick={() => confirm(i)}>
              {i === highlight && <span className="absolute left-0 top-1 bottom-1 w-[2.5px] rounded bg-[#ff0073]" />}
              <Unlink className="w-[15px] h-[15px] text-[#94A3B8]" />
              <span className="flex-1 text-sm font-medium text-[#94A3B8]">Don&rsquo;t connect (just add)</span>
            </button>
          )
        })()}
      </div>

      <div className="px-4 py-2.5 border-t border-[#E2E8F0] dark:border-[#2D2D2D] flex gap-3.5 text-[11.5px] text-[#94A3B8]">
        <span className="flex items-center gap-1">
          <Link2 className="w-3 h-3" /> auto-connect
        </span>
        <span>
          <b className="text-[#64748B] dark:text-[#cbd5e1]">↑↓</b> navigate
        </span>
        <span>
          <b className="text-[#64748B] dark:text-[#cbd5e1]">↵</b> confirm
        </span>
        <span>
          <b className="text-[#64748B] dark:text-[#cbd5e1]">esc</b> cancel
        </span>
      </div>
    </div>
  )
}
