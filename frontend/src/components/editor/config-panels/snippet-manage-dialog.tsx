"use client"

import { useState } from "react"
import { Trash2, Pencil, Check, X } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/use-auth"
import { usePromptSnippets, usePromptSnippetMutations } from "@/hooks/queries/use-prompt-snippets-queries"
import { PromptSnippetNameTakenError, type PromptSnippet } from "@/lib/api"
import { SNIPPET_MEDIA_VALUES, type SnippetMedia, type SnippetTarget } from "@nodaro/shared"

interface SnippetManageDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** When set (possibly ""), the dialog opens with the create form expanded
   *  and the text field prefilled. */
  readonly createPrefillText?: string
  readonly defaultTarget: SnippetTarget
  readonly defaultMedia: SnippetMedia | undefined
}

interface FormState {
  name: string
  description: string
  text: string
  target: SnippetTarget
  media: SnippetMedia[]
  category: string
}

const FORBIDDEN_TEXT = /[{}@\n]/

function SnippetForm({
  initial, onSave, onCancel, saving, error,
}: {
  initial: FormState
  onSave: (f: FormState) => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  const [f, setF] = useState<FormState>(initial)
  const textInvalid = FORBIDDEN_TEXT.test(f.text)
  const valid = f.name.trim().length > 0 && f.text.trim().length > 0 && !textInvalid

  const toggleMedia = (m: SnippetMedia) =>
    setF((s) => ({ ...s, media: s.media.includes(m) ? s.media.filter((x) => x !== m) : [...s.media, m] }))

  return (
    <div className="space-y-2 rounded-md border border-border p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Name" maxLength={80} className="h-8 text-xs" />
        <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Category (optional)" maxLength={60} className="h-8 text-xs" />
      </div>
      <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description (optional — searched by the menu)" maxLength={300} className="h-8 text-xs" />
      <Textarea value={f.text} onChange={(e) => setF({ ...f, text: e.target.value.replace(/\n/g, " ") })} placeholder="The fragment inserted into the prompt…" rows={3} maxLength={2000} className="text-xs" />
      {textInvalid && <p className="text-[10px] text-destructive">Snippet text may not contain {"{ } @"} or line breaks.</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          {(["prompt", "negative"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setF({ ...f, target: t })}
              className={`rounded px-2 py-0.5 text-[10px] border transition-colors ${f.target === t ? "border-amber-400 bg-amber-500/15 text-amber-700 dark:text-amber-300" : "border-border text-muted-foreground hover:bg-muted"}`}>
              {t === "prompt" ? "Prompt" : "Negative"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {SNIPPET_MEDIA_VALUES.map((m) => (
            <button key={m} type="button" onClick={() => toggleMedia(m)}
              title="Empty selection = all node types"
              className={`rounded px-2 py-0.5 text-[10px] border transition-colors ${f.media.includes(m) ? "border-sky-400 bg-sky-500/15 text-sky-700 dark:text-sky-300" : "border-border text-muted-foreground hover:bg-muted"}`}>
              {m}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onCancel}><X className="w-3 h-3 mr-1" />Cancel</Button>
        <Button size="sm" className="h-7 text-[11px]" disabled={!valid || saving} onClick={() => onSave(f)}>
          <Check className="w-3 h-3 mr-1" />{saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

export function SnippetManageDialog({
  open, onOpenChange, createPrefillText, defaultTarget, defaultMedia,
}: SnippetManageDialogProps) {
  const { user } = useAuth()
  const { data: snippets = [] } = usePromptSnippets(user?.id)
  const { create, update, remove } = usePromptSnippetMutations()
  const [creating, setCreating] = useState(createPrefillText !== undefined)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const emptyForm: FormState = {
    name: "", description: "", text: createPrefillText ?? "",
    target: defaultTarget, media: defaultMedia ? [defaultMedia] : [], category: "",
  }

  const handleError = (e: unknown) =>
    setError(e instanceof PromptSnippetNameTakenError ? "A snippet with that name already exists." : "Save failed — try again.")

  const saveNew = (f: FormState) => {
    setError(null)
    create.mutate(
      { name: f.name.trim(), description: f.description.trim() || undefined, text: f.text.trim(), target: f.target, media: f.media, category: f.category.trim() || undefined },
      { onSuccess: () => setCreating(false), onError: handleError },
    )
  }
  const saveEdit = (s: PromptSnippet, f: FormState) => {
    setError(null)
    update.mutate(
      { id: s.id, patch: { name: f.name.trim(), description: f.description.trim() || null, text: f.text.trim(), target: f.target, media: f.media, category: f.category.trim() || null } },
      { onSuccess: () => setEditingId(null), onError: handleError },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>My snippets</DialogTitle>
          <DialogDescription>
            Reusable prompt fragments — insert with “/” in any prompt field. Factory snippets are built in and not editable.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {creating ? (
            <SnippetForm initial={emptyForm} saving={create.isPending} error={error}
              onSave={saveNew} onCancel={() => { setCreating(false); setError(null) }} />
          ) : (
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => { setCreating(true); setError(null) }}>
              + New snippet
            </Button>
          )}
          {snippets.length === 0 && !creating && (
            <p className="text-xs text-muted-foreground py-2">No custom snippets yet.</p>
          )}
          {snippets.map((s) =>
            editingId === s.id ? (
              <SnippetForm
                key={s.id}
                initial={{ name: s.name, description: s.description ?? "", text: s.text, target: s.target, media: s.media as SnippetMedia[], category: s.category ?? "" }}
                saving={update.isPending}
                error={error}
                onSave={(f) => saveEdit(s, f)}
                onCancel={() => { setEditingId(null); setError(null) }}
              />
            ) : (
              <div key={s.id} className="flex items-start gap-2 rounded-md border border-border p-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium truncate">
                    {s.name}
                    <span className="ml-2 text-[9px] uppercase tracking-wider text-muted-foreground">
                      {s.target}{s.media.length > 0 ? ` · ${s.media.join("/")}` : " · all"}
                    </span>
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{s.text}</p>
                </div>
                <button type="button" aria-label="Edit snippet" className="p-1 text-muted-foreground hover:text-foreground" onClick={() => { setEditingId(s.id); setError(null) }}>
                  <Pencil className="w-3 h-3" />
                </button>
                <button type="button" aria-label="Delete snippet" className="p-1 text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(s.id)}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ),
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
