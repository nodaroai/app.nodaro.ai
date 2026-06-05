import { useMemo, useRef, useState, type ChangeEvent } from "react"
import { Bookmark, Download, Plus, Trash2, Upload } from "lucide-react"
import {
  buildNodePresetExport,
  extractPresetData,
  getFactoryPresets,
  parseNodePresetExport,
  type FactoryPreset,
} from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useAuth } from "@/hooks/use-auth"
import { useNodePresets, useNodePresetMutations } from "@/hooks/queries/use-node-presets-queries"
import { NodePresetNameTakenError, type NodePreset } from "@/lib/api"
import { NODE_DEF_MAP } from "@/types/nodes"
import { toast } from "sonner"

/**
 * Asset/entity node categories are DB-backed (Character/Object/Location/Face/Scene have their own
 * galleries + records); a config "preset" doesn't apply to them and could desync the node from its
 * record. Gated by category so new entity node types are excluded automatically.
 */
const ASSET_CATEGORIES = new Set(["character", "object", "location", "face", "scene"])

interface NodePresetsMenuProps {
  readonly nodeType: string
  readonly data: Record<string, unknown>
  readonly onApply: (presetData: Record<string, unknown>) => void
}

type MergedPreset = {
  source: "factory" | "user"
  id: string
  name: string
  description?: string
  data: Record<string, unknown>
}

export function NodePresetsMenu({ nodeType, data, onApply }: NodePresetsMenuProps) {
  const { user } = useAuth()
  const captured = useMemo(() => extractPresetData(data), [data])
  const isAssetNode = ASSET_CATEGORIES.has(NODE_DEF_MAP.get(nodeType)?.category ?? "")
  const hasConfig = Object.keys(captured).length > 0 && !isAssetNode
  // Mirrors the config panel's run-lock: don't let a preset sneak a config change past the
  // disabled fieldset while a job is in flight (it would only affect the next run, but reads as
  // editing the running node).
  const isRunning = data.executionStatus === "running" || data.executionStatus === "pending"

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: userPresets = [] } = useNodePresets(nodeType, user?.id)
  const { create, remove, importMany } = useNodePresetMutations()

  const factory = useMemo<MergedPreset[]>(
    () =>
      getFactoryPresets(nodeType).map((p: FactoryPreset) => ({
        source: "factory" as const,
        id: p.id,
        name: p.name,
        description: p.description,
        data: p.data as Record<string, unknown>,
      })),
    [nodeType],
  )
  const userMerged = useMemo<MergedPreset[]>(
    () =>
      (userPresets as NodePreset[]).map((p) => ({
        source: "user" as const,
        id: p.id,
        name: p.name,
        description: p.description,
        data: p.data,
      })),
    [userPresets],
  )
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (p: MergedPreset) =>
      !q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)
    return { factory: factory.filter(match), user: userMerged.filter(match) }
  }, [factory, userMerged, search])

  if (!hasConfig) return null

  const apply = (p: MergedPreset) => {
    if (isRunning) {
      toast.error("Can't apply a preset while the node is running.")
      return
    }
    onApply(p.data)
    setOpen(false)
    toast.success(`Applied preset "${p.name}"`)
  }

  const doSave = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await create.mutateAsync({ nodeType, name, data: captured })
      toast.success(`Saved preset "${name}"`)
      setNewName("")
      setSaving(false)
    } catch (e) {
      if (e instanceof NodePresetNameTakenError) toast.error("A preset with that name already exists.")
      else toast.error("Failed to save preset.")
    }
  }

  const doExport = () => {
    const env = buildNodePresetExport(
      userMerged.map((p) => ({ nodeType, name: p.name, description: p.description, data: p.data })),
      new Date().toISOString(),
    )
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${nodeType}-presets.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    try {
      const env = parseNodePresetExport(JSON.parse(await file.text()))
      const count = await importMany.mutateAsync(env.presets)
      toast.success(`Imported ${count} preset${count === 1 ? "" : "s"}`)
    } catch {
      toast.error("Invalid preset file.")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="Presets"
          aria-label="Presets"
          className="text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#2D2D2D]"
        >
          <Bookmark className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-2 border-b border-gray-200 dark:border-[#2D2D2D]">
          <Input
            placeholder="Search presets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.factory.length > 0 && (
            <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Factory
            </div>
          )}
          {filtered.factory.map((p) => (
            <PresetRow key={p.id} preset={p} onApply={() => apply(p)} />
          ))}
          {filtered.user.length > 0 && (
            <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              My Presets
            </div>
          )}
          {filtered.user.map((p) => (
            <PresetRow
              key={p.id}
              preset={p}
              onApply={() => apply(p)}
              onDelete={async () => {
                try {
                  await remove.mutateAsync(p.id)
                  toast.success("Deleted")
                } catch {
                  toast.error("Failed to delete preset.")
                }
              }}
            />
          ))}
          {filtered.factory.length === 0 && filtered.user.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No presets yet. Configure this node, then “Save current as preset”.
            </div>
          )}
        </div>
        <div className="border-t border-gray-200 dark:border-[#2D2D2D] p-2 space-y-2">
          {saving ? (
            <div className="flex gap-1">
              <Input
                autoFocus
                placeholder="Preset name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doSave()
                }}
                className="h-8"
              />
              <Button
                size="sm"
                className="h-8"
                onClick={() => void doSave()}
                disabled={!newName.trim() || create.isPending}
              >
                Save
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 justify-start gap-2"
              onClick={() => setSaving(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Save current as preset
            </Button>
          )}
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-8 gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 h-8 gap-2"
              onClick={doExport}
              disabled={userMerged.length === 0}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function PresetRow({
  preset,
  onApply,
  onDelete,
}: {
  preset: MergedPreset
  onApply: () => void
  onDelete?: () => void
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
      <button type="button" className="flex-1 text-left" onClick={onApply}>
        <div className="text-sm">{preset.name}</div>
        {preset.description && (
          <div className="text-[11px] text-muted-foreground line-clamp-1">{preset.description}</div>
        )}
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${preset.name}`}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            void onDelete()
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
