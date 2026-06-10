import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import { Check, ChevronDown, ChevronRight, Download, Folder, FolderOpen, Layers, Plus, RotateCcw, Settings2, Star, Trash2, Upload } from "lucide-react"
import {
  buildNodePresetExport,
  extractPresetData,
  getFactoryPresets,
  groupFactoryPresets,
  parseNodePresetExport,
  presetDataMatches,
  PRESET_APPLY_CLEAR_KEYS,
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
import {
  useNodePresets,
  useNodePresetGroups,
  useNodePresetMutations,
  useNodePresetFavorites,
  useNodePresetFavoriteMutations,
} from "@/hooks/queries/use-node-presets-queries"
import { NodePresetNameTakenError, type NodePreset, type NodePresetGroup } from "@/lib/api"
import { buildPresetTree, presetMatchesQuery, buildResetToDefaultData } from "@/lib/preset-tree"
import { NodePresetManageDialog } from "./node-preset-manage-dialog"
import { NODE_DEF_MAP } from "@/types/nodes"
import { cn } from "@/lib/utils"
import { NODE_TITLE_TYPOGRAPHY } from "@/lib/node-title-style"
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

/**
 * Build the data patch that applying a preset writes to the node. Spread order is
 * load-bearing: clear every generated composer-plan field (PRESET_APPLY_CLEAR_KEYS
 * -> undefined; use-workflow-store merges shallowly, so this drops the stale
 * plan/url from both the preview and the output handle) FIRST, then the preset's
 * own config (so a preset that ever sets a plan field could still override the
 * clear), then the active-preset marker. Pass empty presetData to only clear +
 * mark active (the no-config-change path). Exported pure for unit testing.
 */
export function buildPresetApplyPatch(
  presetData: Record<string, unknown>,
  presetId: string,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(PRESET_APPLY_CLEAR_KEYS.map((k) => [k, undefined])),
    ...presetData,
    __activePresetId: presetId,
  }
}

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
  // User-curated favorites (factory ids AND user-preset uuids), most-recent first.
  const { data: favoriteIds = [] } = useNodePresetFavorites(nodeType, user?.id)
  const favMutations = useNodePresetFavoriteMutations(nodeType)
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const toggleFavorite = (id: string) => {
    if (favoriteSet.has(id)) favMutations.remove.mutate(id)
    else favMutations.add.mutate(id)
  }
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
  // Resolve favorite ids against ALL presets (favorites can be user presets too); skip any
  // id that no longer resolves (deleted user preset / removed factory id).
  const favoriteRows = useMemo(
    () => favoriteIds.map((id) => all.find((p) => p.id === id)).filter((p): p is MergedPreset => p !== undefined),
    [favoriteIds, all],
  )

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
    if (!o) {
      setSaving(false)
      setSearch("")
      setNewName("")
    }
  }

  // Report "active" to the parent for the WHOLE interaction — the popover being open OR a
  // confirm/Manage dialog being pending — not just while the popover is open. The node-variant
  // dropdown lives in a hover toolbar gated by this signal (BaseNode: isVisible={isHovered ||
  // presetMenuOpen}). Reporting inactive the instant the popover closed (while a confirm was still
  // pending) unmounted the dropdown + its dialog before the user could click Apply, so the preset
  // never applied. Driving it from the derived state keeps the toolbar mounted through select-,
  // override-, reset-confirms and the Manage dialog.
  useEffect(() => {
    onOpenChange?.(open || confirm !== null || manageOpen)
  }, [open, confirm, manageOpen, onOpenChange])

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
    updateNodeData(nodeId, buildPresetApplyPatch(p.data, p.id))
    toast.success(`Applied preset "${p.name}"`)
  }

  const onSelect = (p: MergedPreset) => {
    if (isRunning) {
      toast.error("Can't apply a preset while the node is running.")
      return
    }
    if (presetDataMatches(data, p.data)) {
      // No config change needed — mark it active (no destructive confirm). Still
      // clear any stale generated plan-state: the node can match the preset's
      // config yet carry a plan/lottieUrl from a prior run, which would otherwise
      // keep showing the old animation under the now-active preset.
      updateNodeData(nodeId, buildPresetApplyPatch({}, p.id))
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

  const triggerLabel = activePreset ? activePreset.name : "PRESET"
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
        // Trigger name width — 2× wider so longer preset names show on the node before truncating.
        // Only this cap doubles; the icon/chevron/font stay glyph-sized to keep matching the title.
        maxName: Math.round(192 * zoom),
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
            {/* Always show a label — the node's chosen preset, or a muted "PRESET" hint when none. */}
            <span
              className={cn(
                "truncate",
                // Node variant: match the node's floating title (EditableNodeLabel) — 11px (via the
                // inline np.font) + the shared NODE_TITLE_TYPOGRAPHY (semibold/uppercase/tracking).
                isNode ? NODE_TITLE_TYPOGRAPHY : "text-sm",
                !activePreset && "text-muted-foreground",
                !activePreset && !isNode && "tracking-wide",
              )}
              style={np ? { maxWidth: np.maxName } : undefined}
            >
              {triggerLabel}
            </span>
            {dirty && <span className={cn("font-bold text-[#ff0073]", !isNode && "text-sm")}>*</span>}
            <ChevronDown className={cn("shrink-0 opacity-60", !isNode && "ml-auto h-3.5 w-3.5")} size={np?.icon} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[40rem] p-0" onClick={(e) => e.stopPropagation()}>
          <div className="border-b border-gray-200 p-2 dark:border-[#2D2D2D]">
            <Input
              placeholder="Search presets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {/* FAVORITES band — user-starred presets (factory or user), pinned to the top.
                Hidden while searching and when empty. */}
            {!searching && favoriteRows.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Star className="h-3 w-3 shrink-0" /> Favorites
                </div>
                {favoriteRows.map((p) => (
                  <PresetRow
                    key={`fav:${p.id}`}
                    preset={p}
                    active={p.id === activeId}
                    indented
                    onSelect={() => onSelect(p)}
                    isFavorite={favoriteSet.has(p.id)}
                    onToggleFavorite={() => toggleFavorite(p.id)}
                  />
                ))}
              </>
            )}

            {/* USER (custom) presets first — flat when searching, organized tree when browsing. */}
            {(searching ? userMatches.length > 0 : tree.length > 0) && (
              <>
                <GroupLabel>My Presets</GroupLabel>
                {searching
                  ? userMatches.map((p) => (
                      <PresetRow
                        key={p.id}
                        preset={p}
                        active={p.id === activeId}
                        onSelect={() => onSelect(p)}
                        onDelete={() => doDelete(p)}
                        isFavorite={favoriteSet.has(p.id)}
                        onToggleFavorite={() => toggleFavorite(p.id)}
                      />
                    ))
                  : tree.map((node) => {
                      if (node.kind === "preset") {
                        const mp = toMerged(node.preset)
                        return (
                          <PresetRow
                            key={mp.id}
                            preset={mp}
                            active={mp.id === activeId}
                            onSelect={() => onSelect(mp)}
                            onDelete={() => doDelete(mp)}
                            isFavorite={favoriteSet.has(mp.id)}
                            onToggleFavorite={() => toggleFavorite(mp.id)}
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
                            isFavorite={favoriteSet.has(mp.id)}
                            onToggleFavorite={() => toggleFavorite(mp.id)}
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
                    })}
              </>
            )}

            {/* FACTORY presets second — organized into folders/sections. */}
            {(searching ? factoryMatches.length > 0 : factory.length > 0) && (
              <>
                <GroupLabel>Factory</GroupLabel>
                {searching ? (
                  factoryMatches.map((p) => (
                    <PresetRow
                      key={p.id}
                      preset={p}
                      active={p.id === activeId}
                      onSelect={() => onSelect(p)}
                      isFavorite={favoriteSet.has(p.id)}
                      onToggleFavorite={() => toggleFavorite(p.id)}
                    />
                  ))
                ) : (
                  <>
                    {factoryGroups.map((g) => {
                      const isRoot = g.group === null
                      const folderKey = `factory:${g.key}`
                      const isFolder = !isRoot && g.groupKind === "folder"
                      const isCollapsed = isFolder && collapsed.has(folderKey)
                      return (
                        <div key={folderKey}>
                          {/* Root (ungrouped) presets render directly under the Factory header. */}
                          {isRoot ? null : isFolder ? (
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
                                isFavorite={favoriteSet.has(p.id)}
                                onToggleFavorite={() => toggleFavorite(p.id)}
                              />
                            ))}
                        </div>
                      )
                    })}
                  </>
                )}
              </>
            )}

            {(searching ? userMatches.length === 0 && factoryMatches.length === 0 : tree.length === 0 && factory.length === 0) && (
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
  isFavorite,
  onToggleFavorite,
}: {
  preset: MergedPreset
  active: boolean
  indented?: boolean
  onSelect: () => void
  onDelete?: () => void
  isFavorite: boolean
  onToggleFavorite: () => void
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
      {/* Favorite toggle — visible on hover, always visible once favorited. Shown on every row
          (factory + user), so it must NOT be gated behind onDelete. */}
      <button
        type="button"
        aria-label={isFavorite ? "Unfavorite" : "Favorite"}
        className={cn(
          "shrink-0 text-muted-foreground hover:text-[#ff0073]",
          isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
      >
        <Star className={cn("h-3.5 w-3.5", isFavorite && "fill-current text-[#ff0073]")} />
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
