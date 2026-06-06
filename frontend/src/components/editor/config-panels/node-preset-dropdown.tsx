import { useMemo, useRef, useState, type ChangeEvent } from "react"
import { Check, ChevronDown, ChevronRight, Download, Folder, FolderOpen, Layers, Plus, RotateCcw, Settings2, Trash2, Upload } from "lucide-react"
import {
  buildNodePresetExport,
  extractPresetData,
  getFactoryPresets,
  groupFactoryPresets,
  parseNodePresetExport,
  presetDataMatches,
  type FactoryPreset,
} from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useAuth } from "@/hooks/use-auth"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useNodePresets, useNodePresetGroups, useNodePresetMutations } from "@/hooks/queries/use-node-presets-queries"
import { NodePresetNameTakenError, type NodePreset, type NodePresetGroup } from "@/lib/api"
import { buildPresetTree, presetMatchesQuery, buildResetToDefaultData } from "@/lib/preset-tree"
import { NodePresetManageDialog } from "./node-preset-manage-dialog"
import { NODE_DEF_MAP } from "@/types/nodes"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

/** Asset/entity nodes are DB-backed (own galleries) — no config preset applies. Gated by category
 *  so new entity node types are excluded automatically. */
const ASSET_CATEGORIES = new Set(["character", "object", "location", "face", "scene"])

type MergedPreset = {
  source: "factory" | "user"
  id: string
  name: string
  description?: string
  /** Factory-only: folder/section label for grouping in the picker. */
  group?: string
  groupKind?: "folder" | "section"
  data: Record<string, unknown>
}

const toMerged = (p: NodePreset): MergedPreset => ({
  source: "user",
  id: p.id,
  name: p.name,
  description: p.description,
  data: p.data,
})

interface PresetDropdownProps {
  readonly nodeId: string
  /** "panel" = full config-panel trigger, "node" = compact trigger in the node hover toolbar. */
  readonly variant: "panel" | "node"
  /** Node canvas zoom (node variant only) — sizes the trigger to the zoom-scaled node title. */
  readonly zoom?: number
  readonly className?: string
  /** Notifies the parent when the menu opens/closes (BaseNode pins its hover toolbar while open). */
  readonly onOpenChange?: (open: boolean) => void
}

/**
 * Preset selector dropdown. Self-contained: reads its node's `{type,data}` from the store by id
 * (so each instance re-renders only when ITS node changes) and applies via `updateNodeData`.
 *
 * This OUTER component gates on eligibility using ONLY the store — so ineligible nodes (no portable
 * config, or asset/structural nodes) never mount the data hooks (no preset query is fired, no
 * QueryClient/auth needed). The inner component (with React Query + auth) renders only when eligible.
 */
export function PresetDropdown({ nodeId, variant, zoom, className, onOpenChange }: PresetDropdownProps) {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const nodeType = node?.type as string | undefined
  const data = (node?.data ?? {}) as Record<string, unknown>
  const hasConfig = Object.keys(extractPresetData(data)).length > 0
  const isAssetNode = ASSET_CATEGORIES.has(NODE_DEF_MAP.get(nodeType ?? "")?.category ?? "")

  if (!node || !nodeType || !hasConfig || isAssetNode) return null
  return (
    <PresetDropdownInner
      nodeId={nodeId}
      nodeType={nodeType}
      data={data}
      updateNodeData={updateNodeData}
      variant={variant}
      zoom={zoom}
      className={className}
      onOpenChange={onOpenChange}
    />
  )
}

interface InnerProps extends PresetDropdownProps {
  readonly nodeType: string
  readonly data: Record<string, unknown>
  readonly updateNodeData: (nodeId: string, data: Record<string, unknown>) => void
}

function PresetDropdownInner({ nodeId, nodeType, data, updateNodeData, variant, zoom = 1, className, onOpenChange }: InnerProps) {
  const { user } = useAuth()
  const captured = useMemo(() => extractPresetData(data), [data])

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState("")
  const [manageOpen, setManageOpen] = useState(false)
  // Factory folders start collapsed (there can be ~10 of them) so the menu opens
  // as a scannable list of category headers; user folders default expanded.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    const init = new Set<string>()
    for (const g of groupFactoryPresets(getFactoryPresets(nodeType))) {
      if (g.group !== null && g.groupKind === "folder") init.add(`factory:${g.key}`)
    }
    return init
  })
  const [confirm, setConfirm] = useState<
    { kind: "select"; preset: MergedPreset } | { kind: "override" } | { kind: "reset" } | null
  >(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: userPresets = [] } = useNodePresets(nodeType, user?.id)
  const { data: groups = [] } = useNodePresetGroups(nodeType, user?.id)
  const { create, update, remove, importMany } = useNodePresetMutations()

  const factory = useMemo<MergedPreset[]>(
    () =>
      getFactoryPresets(nodeType ?? "").map((p: FactoryPreset) => ({
        source: "factory" as const,
        id: p.id,
        name: p.name,
        description: p.description,
        group: p.group,
        groupKind: p.groupKind,
        data: p.data as Record<string, unknown>,
      })),
    [nodeType],
  )
  // Factory presets bucketed into folders/sections for the browse (non-search) view.
  const factoryGroups = useMemo(() => groupFactoryPresets(factory), [factory])
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
  const all = useMemo(() => [...factory, ...userMerged], [factory, userMerged])

  const activeId = data.__activePresetId as string | undefined
  const activePreset = useMemo(() => all.find((p) => p.id === activeId), [all, activeId])
  const dirty = activePreset ? !presetDataMatches(data, activePreset.data) : false
  const isRunning = data.executionStatus === "running" || data.executionStatus === "pending"

  const q = search.trim().toLowerCase()
  const searching = q.length > 0
  const factoryMatches = useMemo(
    () => factory.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)),
    [factory, q],
  )
  // When searching, present a flat list of matching user presets (ignore folder collapse). When
  // not searching, present the organized tree.
  const userMatches = useMemo(
    () => (userPresets as NodePreset[]).filter((p) => presetMatchesQuery(p, search)).map(toMerged),
    [userPresets, search],
  )
  const tree = useMemo(
    () => buildPresetTree(userPresets as NodePreset[], groups as NodePresetGroup[]),
    [userPresets, groups],
  )

  const setOpenState = (o: boolean) => {
    setOpen(o)
    onOpenChange?.(o)
    if (!o) {
      setSaving(false)
      setSearch("")
      setNewName("")
    }
  }

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyPreset = (p: MergedPreset) => {
    if (isRunning) {
      toast.error("Can't apply a preset while the node is running.")
      return
    }
    updateNodeData(nodeId, { ...p.data, __activePresetId: p.id })
    toast.success(`Applied preset "${p.name}"`)
  }

  const onSelect = (p: MergedPreset) => {
    if (isRunning) {
      toast.error("Can't apply a preset while the node is running.")
      return
    }
    if (presetDataMatches(data, p.data)) {
      // No config change needed — just mark it active (no destructive confirm).
      updateNodeData(nodeId, { __activePresetId: p.id })
      setOpenState(false)
      return
    }
    setConfirm({ kind: "select", preset: p })
    setOpenState(false)
  }

  const doSaveNew = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const created = await create.mutateAsync({ nodeType, name, data: captured })
      updateNodeData(nodeId, { __activePresetId: created.id })
      toast.success(`Saved preset "${name}"`)
      setOpenState(false)
    } catch (e) {
      if (e instanceof NodePresetNameTakenError) toast.error("A preset with that name already exists.")
      else toast.error("Failed to save preset.")
    }
  }

  const doOverride = async () => {
    if (!activePreset || activePreset.source !== "user") return
    try {
      await update.mutateAsync({ id: activePreset.id, patch: { data: captured } })
      toast.success(`Updated preset "${activePreset.name}"`)
    } catch {
      toast.error("Failed to update preset.")
    }
  }

  // Clear the active preset and restore the node's default config ("go back to no preset").
  const doReset = () => {
    if (isRunning) {
      toast.error("Can't reset while the node is running.")
      return
    }
    const defaultData = NODE_DEF_MAP.get(nodeType)?.defaultData as Record<string, unknown> | undefined
    updateNodeData(nodeId, buildResetToDefaultData(data, defaultData))
    toast.success("Reset to default")
  }

  const doDelete = async (p: MergedPreset) => {
    try {
      await remove.mutateAsync(p.id)
      if (p.id === activeId) updateNodeData(nodeId, { __activePresetId: undefined })
      toast.success("Deleted")
    } catch {
      toast.error("Failed to delete preset.")
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

  const triggerLabel = activePreset ? activePreset.name : "Preset"
  const canOverride = !!activePreset && activePreset.source === "user"

  // Node-variant sizing scales with `zoom` so the trigger tracks the node title (text-[11px], which
  // lives inside the node's `scale(zoom)` wrapper). 13px icon matches the 3-dots glyph (zoom*13).
  const isNode = variant === "node"
  const np = isNode
    ? {
        font: 11 * zoom,
        icon: Math.round(13 * zoom),
        h: Math.round(18 * zoom),
        px: Math.round(6 * zoom),
        gap: Math.round(3 * zoom),
        radius: Math.round(5 * zoom),
        maxName: Math.round(96 * zoom),
      }
    : null

  return (
    <>
      <Popover open={open} onOpenChange={setOpenState}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            title="Presets"
            aria-label="Presets"
            style={np ? { fontSize: np.font, height: np.h, paddingLeft: np.px, paddingRight: np.px, gap: np.gap, borderRadius: np.radius } : undefined}
            className={cn(
              "inline-flex items-center border border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#2D2D2D] transition-colors",
              isNode ? "" : "h-8 gap-1.5 rounded-md px-2.5 text-sm",
              className,
            )}
          >
            <Layers className={cn("shrink-0 opacity-70", !isNode && "h-3.5 w-3.5")} size={np?.icon} />
            {(variant === "panel" || activePreset) && (
              <span className={cn("truncate", !isNode && "text-sm")} style={np ? { maxWidth: np.maxName } : undefined}>
                {triggerLabel}
              </span>
            )}
            {dirty && <span className={cn("font-bold text-[#ff0073]", !isNode && "text-sm")}>*</span>}
            <ChevronDown className={cn("shrink-0 opacity-60", !isNode && "ml-auto h-3.5 w-3.5")} size={np?.icon} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0" onClick={(e) => e.stopPropagation()}>
          <div className="border-b border-gray-200 p-2 dark:border-[#2D2D2D]">
            <Input
              placeholder="Search presets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {/* Factory presets: flat list when searching, collapsible folders when browsing. */}
            {searching
              ? factoryMatches.length > 0 && (
                  <>
                    <GroupLabel>Factory</GroupLabel>
                    {factoryMatches.map((p) => (
                      <PresetRow key={p.id} preset={p} active={p.id === activeId} onSelect={() => onSelect(p)} />
                    ))}
                  </>
                )
              : factoryGroups.map((g) => {
                  const isRoot = g.group === null
                  const folderKey = `factory:${g.key}`
                  const isFolder = !isRoot && g.groupKind === "folder"
                  const isCollapsed = isFolder && collapsed.has(folderKey)
                  return (
                    <div key={folderKey}>
                      {isRoot ? (
                        <GroupLabel>Factory</GroupLabel>
                      ) : isFolder ? (
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                          onClick={() => toggleCollapsed(folderKey)}
                        >
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                          {isCollapsed ? <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                          <span className="truncate text-sm font-medium">{g.group}</span>
                          <span className="ml-auto text-[11px] text-muted-foreground">{g.presets.length}</span>
                        </button>
                      ) : (
                        <GroupLabel>{g.group}</GroupLabel>
                      )}
                      {!isCollapsed &&
                        g.presets.map((p) => (
                          <PresetRow
                            key={p.id}
                            preset={p}
                            active={p.id === activeId}
                            indented={!isRoot}
                            onSelect={() => onSelect(p)}
                          />
                        ))}
                    </div>
                  )
                })}

            {searching ? (
              <>
                {userMatches.length > 0 && <GroupLabel>My Presets</GroupLabel>}
                {userMatches.map((p) => (
                  <PresetRow
                    key={p.id}
                    preset={p}
                    active={p.id === activeId}
                    onSelect={() => onSelect(p)}
                    onDelete={() => doDelete(p)}
                  />
                ))}
              </>
            ) : (
              tree.map((node) => {
                if (node.kind === "preset") {
                  const mp = toMerged(node.preset)
                  return (
                    <PresetRow
                      key={mp.id}
                      preset={mp}
                      active={mp.id === activeId}
                      onSelect={() => onSelect(mp)}
                      onDelete={() => doDelete(mp)}
                    />
                  )
                }
                const g = node.group
                const isFolder = g.kind === "folder"
                const isCollapsed = isFolder && collapsed.has(g.id)
                const rows = node.presets.map((p) => {
                  const mp = toMerged(p)
                  return (
                    <PresetRow
                      key={mp.id}
                      preset={mp}
                      active={mp.id === activeId}
                      indented
                      onSelect={() => onSelect(mp)}
                      onDelete={() => doDelete(mp)}
                    />
                  )
                })
                return (
                  <div key={g.id}>
                    {isFolder ? (
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                        onClick={() => toggleCollapsed(g.id)}
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                        {isCollapsed ? <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" /> : <FolderOpen className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                        <span className="truncate text-sm font-medium">{g.name}</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">{node.presets.length}</span>
                      </button>
                    ) : (
                      <GroupLabel>{g.name}</GroupLabel>
                    )}
                    {!isCollapsed && rows}
                  </div>
                )
              })
            )}

            {factoryMatches.length === 0 &&
              (searching ? userMatches.length === 0 : tree.length === 0) && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {searching ? "No presets match your search." : "No presets yet. Configure this node, then “Save as new”."}
                </div>
              )}
          </div>
          <div className="space-y-2 border-t border-gray-200 p-2 dark:border-[#2D2D2D]">
            {saving ? (
              <div className="flex gap-1">
                <Input
                  autoFocus
                  placeholder="Preset name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doSaveNew()
                  }}
                  className="h-8"
                />
                <Button size="sm" className="h-8" onClick={() => void doSaveNew()} disabled={!newName.trim() || create.isPending}>
                  Save
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="h-8 w-full justify-start gap-2" onClick={() => setSaving(true)}>
                <Plus className="h-3.5 w-3.5" /> Save as new
              </Button>
            )}
            {canOverride && !saving && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-full justify-start gap-2"
                disabled={!dirty}
                onClick={() => {
                  setConfirm({ kind: "override" })
                  setOpenState(false)
                }}
              >
                <Check className="h-3.5 w-3.5" /> Override “{activePreset?.name}”
              </Button>
            )}
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-8 flex-1 gap-2" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 flex-1 gap-2"
                onClick={doExport}
                disabled={userMerged.length === 0}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2"
              onClick={() => {
                setConfirm({ kind: "reset" })
                setOpenState(false)
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to default
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start gap-2"
              onClick={() => {
                setManageOpen(true)
                setOpenState(false)
              }}
            >
              <Settings2 className="h-3.5 w-3.5" /> Manage presets…
            </Button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
          </div>
        </PopoverContent>
      </Popover>

      <NodePresetManageDialog
        nodeType={nodeType}
        open={manageOpen}
        onOpenChange={setManageOpen}
        activeId={activeId}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <AlertDialogContent>
          {confirm?.kind === "select" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Apply preset “{confirm.preset.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will overwrite this node’s current settings.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const p = confirm.preset
                    setConfirm(null)
                    applyPreset(p)
                  }}
                >
                  Apply
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : confirm?.kind === "override" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Overwrite preset “{activePreset?.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  The preset will be updated with this node’s current settings.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirm(null)
                    void doOverride()
                  }}
                >
                  Overwrite
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : confirm?.kind === "reset" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset to default?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears the selected preset and restores this node’s default settings.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirm(null)
                    doReset()
                  }}
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

function PresetRow({
  preset,
  active,
  indented,
  onSelect,
  onDelete,
}: {
  preset: MergedPreset
  active: boolean
  indented?: boolean
  onSelect: () => void
  onDelete?: () => void
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent",
        indented && "ml-3",
        active && "bg-accent/60",
      )}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onSelect}>
        <Check className={cn("h-3.5 w-3.5 shrink-0", active ? "opacity-100 text-[#ff0073]" : "opacity-0")} />
        <span className="min-w-0">
          <span className="block truncate text-sm">{preset.name}</span>
          {preset.description && (
            <span className="block truncate text-[11px] text-muted-foreground">{preset.description}</span>
          )}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          aria-label={`Delete ${preset.name}`}
          className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
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
