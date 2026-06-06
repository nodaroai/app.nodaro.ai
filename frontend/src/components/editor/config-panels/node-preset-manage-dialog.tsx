import { useState, type KeyboardEvent } from "react"
import { ChevronDown, ChevronUp, Folder, FolderPlus, Heading, ListPlus, Trash2, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/use-auth"
import { useNodePresets, useNodePresetGroups, useNodePresetMutations } from "@/hooks/queries/use-node-presets-queries"
import type { NodePreset, NodePresetGroup } from "@/lib/api"
import { buildPresetTree, type PresetTreeNode } from "@/lib/preset-tree"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface ManageDialogProps {
  readonly nodeType: string
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly activeId?: string
}

export function NodePresetManageDialog({ nodeType, open, onOpenChange, activeId }: ManageDialogProps) {
  const { user } = useAuth()
  const { data: presets = [] } = useNodePresets(nodeType, user?.id)
  const { data: groups = [] } = useNodePresetGroups(nodeType, user?.id)
  const { update, remove, reorder, createGroup, updateGroup, removeGroup } = useNodePresetMutations()

  const tree = buildPresetTree(presets as NodePreset[], groups as NodePresetGroup[])
  const groupList = groups as NodePresetGroup[]

  // Reorder a level by swapping an item with its neighbor, then normalizing sort_order = index.
  const moveRoot = (index: number, dir: -1 | 1) => {
    const items = [...tree]
    const j = index + dir
    if (j < 0 || j >= items.length) return
    ;[items[index], items[j]] = [items[j], items[index]]
    void reorder.mutateAsync({
      groups: items.flatMap((n, i) => (n.kind === "group" ? [{ id: n.group.id, sortOrder: i }] : [])),
      presets: items.flatMap((n, i) => (n.kind === "preset" ? [{ id: n.preset.id, sortOrder: i }] : [])),
    })
  }
  const moveInGroup = (node: Extract<PresetTreeNode, { kind: "group" }>, index: number, dir: -1 | 1) => {
    const items = [...node.presets]
    const j = index + dir
    if (j < 0 || j >= items.length) return
    ;[items[index], items[j]] = [items[j], items[index]]
    // Send groupId explicitly so the intent ("these belong to this group") is asserted, not implied.
    void reorder.mutateAsync({ presets: items.map((p, i) => ({ id: p.id, groupId: node.group.id, sortOrder: i })) })
  }

  const addGroup = (kind: "folder" | "section") => {
    void createGroup.mutateAsync({ nodeType, name: kind === "folder" ? "New folder" : "New section", kind, sortOrder: tree.length })
  }

  const moveToGroup = (preset: NodePreset, groupId: string | null) => {
    // Append to the end of the target level: max existing sortOrder + 1 (robust vs sparse order).
    const siblings = groupId
      ? presets.filter((p) => p.groupId === groupId)
      : tree.flatMap((n) => (n.kind === "preset" ? [n.preset] : []))
    const next = siblings.length ? Math.max(...siblings.map((p) => p.sortOrder)) + 1 : 0
    void update.mutateAsync({ id: preset.id, patch: { groupId, sortOrder: next } })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage presets</DialogTitle>
          <DialogDescription>
            Organize your custom presets into folders and sections, add tags, and reorder them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => addGroup("folder")}>
            <FolderPlus className="h-4 w-4" /> New folder
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => addGroup("section")}>
            <ListPlus className="h-4 w-4" /> New section
          </Button>
        </div>

        <div className="max-h-[55vh] space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2 dark:border-[#2D2D2D]">
          {tree.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No custom presets yet. Save one from a node, then organize it here.
            </div>
          )}
          {tree.map((node, i) =>
            node.kind === "group" ? (
              <div key={node.group.id} className="rounded-md bg-gray-50 dark:bg-[#171717]">
                <GroupRow
                  group={node.group}
                  canUp={i > 0}
                  canDown={i < tree.length - 1}
                  onUp={() => moveRoot(i, -1)}
                  onDown={() => moveRoot(i, 1)}
                  onRename={(name) => void updateGroup.mutateAsync({ id: node.group.id, patch: { name } })}
                  onDelete={() => {
                    if (window.confirm(`Delete ${node.group.kind} “${node.group.name}”? Its presets move back to the top level.`)) {
                      void removeGroup.mutateAsync(node.group.id).then(() => toast.success("Deleted"))
                    }
                  }}
                />
                <div className="space-y-1 px-2 pb-2 pl-6">
                  {node.presets.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">Empty — move presets here.</div>
                  )}
                  {node.presets.map((p, pi) => (
                    <PresetRow
                      key={p.id}
                      preset={p}
                      active={p.id === activeId}
                      groups={groupList}
                      canUp={pi > 0}
                      canDown={pi < node.presets.length - 1}
                      onUp={() => moveInGroup(node, pi, -1)}
                      onDown={() => moveInGroup(node, pi, 1)}
                      onPatch={(patch) => void update.mutateAsync({ id: p.id, patch })}
                      onMove={(gid) => moveToGroup(p, gid)}
                      onDelete={() => void remove.mutateAsync(p.id).then(() => toast.success("Deleted"))}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <PresetRow
                key={node.preset.id}
                preset={node.preset}
                active={node.preset.id === activeId}
                groups={groupList}
                canUp={i > 0}
                canDown={i < tree.length - 1}
                onUp={() => moveRoot(i, -1)}
                onDown={() => moveRoot(i, 1)}
                onPatch={(patch) => void update.mutateAsync({ id: node.preset.id, patch })}
                onMove={(gid) => moveToGroup(node.preset, gid)}
                onDelete={() => void remove.mutateAsync(node.preset.id).then(() => toast.success("Deleted"))}
              />
            ),
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReorderButtons({ canUp, canDown, onUp, onDown }: { canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex shrink-0 flex-col">
      <button type="button" aria-label="Move up" disabled={!canUp} onClick={onUp} className="text-muted-foreground hover:text-foreground disabled:opacity-25">
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" aria-label="Move down" disabled={!canDown} onClick={onDown} className="text-muted-foreground hover:text-foreground disabled:opacity-25">
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function GroupRow({
  group,
  canUp,
  canDown,
  onUp,
  onDown,
  onRename,
  onDelete,
}: {
  group: NodePresetGroup
  canUp: boolean
  canDown: boolean
  onUp: () => void
  onDown: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(group.name)
  const commit = () => {
    const n = name.trim()
    if (n && n !== group.name) onRename(n)
    else setName(group.name)
  }
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <ReorderButtons canUp={canUp} canDown={canDown} onUp={onUp} onDown={onDown} />
      {group.kind === "folder" ? <Folder className="h-4 w-4 shrink-0 opacity-70" /> : <Heading className="h-4 w-4 shrink-0 opacity-70" />}
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
        className="h-7 flex-1 font-medium"
      />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{group.kind}</span>
      <button type="button" aria-label={`Delete ${group.name}`} onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-destructive">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function PresetRow({
  preset,
  active,
  groups,
  canUp,
  canDown,
  onUp,
  onDown,
  onPatch,
  onMove,
  onDelete,
}: {
  preset: NodePreset
  active: boolean
  groups: NodePresetGroup[]
  canUp: boolean
  canDown: boolean
  onUp: () => void
  onDown: () => void
  onPatch: (patch: { name?: string; description?: string; tags?: string[] }) => void
  onMove: (groupId: string | null) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(preset.name)
  const [description, setDescription] = useState(preset.description ?? "")

  return (
    <div className={cn("flex items-start gap-2 rounded-md border border-transparent bg-white px-2 py-1.5 dark:bg-[#1E1E1E]", active && "border-[#ff0073]/40")}>
      <ReorderButtons canUp={canUp} canDown={canDown} onUp={onUp} onDown={onDown} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const n = name.trim()
              if (n && n !== preset.name) onPatch({ name: n })
              else setName(preset.name)
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
            className="h-7 flex-1 text-sm"
          />
          <Select value={preset.groupId ?? "__root__"} onValueChange={(v) => onMove(v === "__root__" ? null : v)}>
            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__root__">Top level</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button type="button" aria-label={`Delete ${preset.name}`} onClick={onDelete} className="shrink-0 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <Input
          value={description}
          placeholder="Description (optional)"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== (preset.description ?? "")) onPatch({ description })
          }}
          className="h-7 text-xs"
        />
        <TagEditor tags={preset.tags} onChange={(tags) => onPatch({ tags })} />
      </div>
    </div>
  )
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const t = draft.trim()
    if (!t || tags.includes(t) || tags.length >= 32) {
      setDraft("")
      return
    }
    onChange([...tags, t])
    setDraft("")
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      add()
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px]">
          {t}
          <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder="add tag…"
        className="h-6 min-w-[72px] flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
