"use client"

import { useMemo, useRef, useState } from "react"
import { CodeXml, Plus, Settings2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { appendSnippetText, filterSnippets, groupSnippetsByCategory, type SnippetPoolItem } from "@/lib/snippet-pool"
import { SnippetCategoryHeader, SnippetRowContent } from "./snippet-row"
import { SnippetManageDialog } from "./snippet-manage-dialog"
import type { SnippetMedia, SnippetTarget } from "@nodaro/shared"

interface SnippetMenuButtonProps {
  readonly pool: readonly SnippetPoolItem[]
  readonly value: string
  /** Receives the NEW full field value (append semantics). */
  readonly onInsert: (next: string) => void
  /** Defaults for the "New snippet" form. */
  readonly target: SnippetTarget
  readonly media: SnippetMedia | undefined
}

/**
 * Discoverability companion to the in-editor "/" trigger: a small `</>`
 * button in the field's label row. Selecting a snippet APPENDS it to the
 * field (the "/" menu owns caret-position inserts). Footer opens the manage
 * dialog (also used to create — optionally prefilled from the current text
 * selection, captured on mousedown before focus moves).
 */
export function SnippetMenuButton({ pool, value, onInsert, target, media }: SnippetMenuButtonProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [manageOpen, setManageOpen] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<string | null>(null)
  const selectionRef = useRef("")

  const filtered = useMemo(() => filterSnippets(pool, query), [pool, query])
  const groups = useMemo(() => groupSnippetsByCategory(filtered), [filtered])

  return (
    <>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery("") }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Insert snippet"
            title="Insert snippet (or type / in the field)"
            className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onMouseDown={() => {
              // Capture the selection BEFORE the popover steals focus.
              selectionRef.current = window.getSelection()?.toString() ?? ""
            }}
          >
            <CodeXml className="w-3.5 h-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] p-0">
          <div className="p-2 border-b border-border">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search snippets…"
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {groups.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">No snippets match.</p>
            )}
            {groups.map((g) => (
              <div key={g.category}>
                <SnippetCategoryHeader category={g.category} />
                {g.entries.map((item) => (
                  <button
                    key={item.source + item.id}
                    type="button"
                    className="w-full text-left px-2.5 py-1.5 hover:bg-muted transition-colors flex items-start gap-2"
                    onClick={() => {
                      onInsert(appendSnippetText(value, item.text))
                      setOpen(false)
                      setQuery("")
                    }}
                  >
                    <SnippetRowContent item={item} />
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1 border-t border-border p-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] flex-1"
              onClick={() => {
                setCreatePrefill(selectionRef.current || "")
                setManageOpen(true)
                setOpen(false)
              }}
            >
              <Plus className="w-3 h-3 mr-1" /> New snippet
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] flex-1"
              onClick={() => {
                setCreatePrefill(null)
                setManageOpen(true)
                setOpen(false)
              }}
            >
              <Settings2 className="w-3 h-3 mr-1" /> Manage
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {manageOpen && (
        <SnippetManageDialog
          open={manageOpen}
          onOpenChange={(o) => { setManageOpen(o); if (!o) setCreatePrefill(null) }}
          createPrefillText={createPrefill ?? undefined}
          defaultTarget={target}
          defaultMedia={media}
        />
      )}
    </>
  )
}
