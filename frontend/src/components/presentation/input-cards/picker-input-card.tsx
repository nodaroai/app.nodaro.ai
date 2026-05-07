"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Pencil, X } from "lucide-react"
import { pickIds } from "@nodaro/shared"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { GlassCard } from "../output-cards/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { DimensionTileGrid } from "@/components/editor/config-panels/dimension-tile-grid"
import { LocalePicker } from "@/components/editor/locale-picker"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { useLocaleDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import {
  getParameterPickerMeta,
  type MultiDimParameterPickerMeta,
  type MultiDimValue,
  type ParameterPickerMeta,
  type SingleDimParameterPickerMeta,
} from "@/lib/parameter-picker-registry"

export type PickerDisplayMode = "inline" | "modal" | "compact"

interface PickerInputCardProps {
  nodeId: string
  label: string
  nodeType: string
  data: Record<string, unknown>
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  /** Display mode — defaults to "inline". */
  displayMode?: PickerDisplayMode
  /** Subset of catalog entry ids the user is allowed to pick (single-dim only). */
  allowedValues?: ReadonlyArray<string>
}

/**
 * Renders a parameter picker (Setting, Material, Animal, Camera Motion,
 * Framing, Lighting, Person, Styling, Temporal, Exposure …) inside a
 * presentation-mode input card.
 *
 * Two display modes:
 * - inline: full picker UI is mounted in the card.
 * - modal: shows a preview chip + "Change" button → opens a dialog with
 *   the picker; for single-dim, picking closes the dialog.
 *
 * Per-card config (mode, allowed values) is set in the editor; defaults
 * apply if absent.
 */
export function PickerInputCard(props: PickerInputCardProps) {
  const meta = getParameterPickerMeta(props.nodeType)
  if (!meta) return null
  if (meta.kind === "multi") return <MultiPickerCard {...props} meta={meta} />
  return <SinglePickerCard {...props} meta={meta} />
}

const LABEL_CLS =
  "text-xs font-medium text-muted-foreground uppercase tracking-wider"

// ===========================================================================
// Single-dimension picker
// ===========================================================================

function SinglePickerCard({
  nodeId,
  label,
  data,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  displayMode = "inline",
  allowedValues,
  meta,
}: PickerInputCardProps & { meta: SingleDimParameterPickerMeta }) {
  const dir = useLocaleDir()
  const { resolveLabel, resolveDescription } = useLocalizedCatalog(meta.catalogId)
  const [modalOpen, setModalOpen] = useState(false)

  const field = meta.valueField

  const rawValue = isFullscreen
    ? inputValues[nodeId]?.[field] ?? data[field]
    : data[field]
  // Canvas may store multi-pick as string[] — presentation mode is single-pick.
  const currentValue = pickIds(rawValue)[0] ?? meta.defaultValue
  const isCleared = !rawValue || (Array.isArray(rawValue) && rawValue.length === 0)

  const filteredEntries = useMemo(() => {
    if (!allowedValues || allowedValues.length === 0) return meta.entries
    const allow = new Set(allowedValues)
    const subset = meta.entries.filter((e) => allow.has(e.id))
    return subset.length > 0 ? subset : meta.entries
  }, [meta.entries, allowedValues])

  const writeValue = (next: string) => {
    if (next === currentValue) return
    if (isFullscreen) {
      onUpdateInput(nodeId, field, next)
    } else {
      useWorkflowStore.getState().updateNodeData(nodeId, { [field]: next })
    }
  }

  const handleClear = () => {
    if (isCleared) return
    writeValue(meta.defaultValue)
  }

  const grid = (
    <DimensionTileGrid
      entries={filteredEntries}
      value={currentValue}
      onChange={(v) => {
        if (typeof v === "string") {
          writeValue(v)
          if (displayMode === "modal") setModalOpen(false)
        }
      }}
      renderIcon={(entry) =>
        meta.renderIcon ? (
          <div className="size-full">{meta.renderIcon(entry.id)}</div>
        ) : (
          <div className="flex size-full items-center justify-center text-[10px] font-medium text-muted-foreground/80 px-1 text-center leading-tight">
            {resolveLabel(entry.id, entry.label)}
          </div>
        )
      }
      searchPlaceholder={`Search ${meta.label.toLowerCase()}…`}
      catalog={meta.catalogId}
      gridClassName="grid grid-cols-3 sm:grid-cols-4 gap-2"
    />
  )

  if (displayMode === "compact") {
    const selected = meta.entries.find((e) => e.id === currentValue)
    const selectedLabel = selected
      ? resolveLabel(selected.id, selected.label)
      : currentValue

    return (
      <GlassCard>
        <div className="flex items-center justify-between mb-2 gap-2">
          <Label className={LABEL_CLS}>{label}</Label>
          <LocalePicker />
        </div>
        <div className="flex items-center gap-2" dir={dir}>
          <Select
            value={currentValue}
            onValueChange={writeValue}
            disabled={readOnly}
          >
            <SelectTrigger className="flex-1 h-9">
              <div className="flex items-center gap-2 min-w-0">
                {meta.renderIcon && (
                  <div className="size-5 shrink-0 flex items-center justify-center [&>*]:size-full">
                    {meta.renderIcon(currentValue)}
                  </div>
                )}
                <SelectValue placeholder={`Select ${meta.label.toLowerCase()}…`}>
                  <span className="truncate text-sm">{selectedLabel}</span>
                </SelectValue>
              </div>
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {filteredEntries.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  <span className="flex items-center gap-2">
                    {meta.renderIcon && (
                      <span className="size-4 shrink-0 flex items-center justify-center [&>*]:size-full">
                        {meta.renderIcon(entry.id)}
                      </span>
                    )}
                    <span>{resolveLabel(entry.id, entry.label)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!readOnly && !isCleared && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-9 w-9 p-0 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Clear selection"
              title="Reset to default"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </GlassCard>
    )
  }

  if (displayMode === "modal") {
    const selected = meta.entries.find((e) => e.id === currentValue)
    const selectedLabel = selected
      ? resolveLabel(selected.id, selected.label)
      : currentValue
    const selectedDesc = selected
      ? resolveDescription(selected.id, selected.description)
      : ""

    return (
      <GlassCard>
        <div className="flex items-center justify-between mb-2 gap-2">
          <Label className={LABEL_CLS}>{label}</Label>
          <LocalePicker />
        </div>
        <div className="flex items-center gap-3" dir={dir}>
          <button
            type="button"
            onClick={() => !readOnly && setModalOpen(true)}
            disabled={readOnly}
            className={cn(
              "size-14 shrink-0 rounded-lg overflow-hidden bg-muted/30 border border-border flex items-center justify-center transition-colors",
              !readOnly && "hover:border-[#ff0073]/50 cursor-pointer",
            )}
            aria-label={`Change ${meta.label}`}
          >
            {meta.renderIcon ? (
              meta.renderIcon(currentValue)
            ) : (
              <span className="text-[10px] font-medium text-muted-foreground/80 text-center px-1 leading-tight">
                {selectedLabel}
              </span>
            )}
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {selectedLabel}
            </p>
            {selectedDesc && (
              <p className="text-xs text-muted-foreground truncate">
                {selectedDesc}
              </p>
            )}
          </div>
          {!readOnly && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setModalOpen(true)}
                className="h-8 px-2 gap-1"
              >
                <Pencil className="size-3.5" />
                <span className="text-xs">Change</span>
              </Button>
              {!isCleared && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                  aria-label="Clear selection"
                  title="Reset to default"
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-auto" dir={dir}>
            <DialogHeader>
              <DialogTitle>{`Select ${meta.label}`}</DialogTitle>
            </DialogHeader>
            {grid}
          </DialogContent>
        </Dialog>
      </GlassCard>
    )
  }

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2 gap-2">
        <Label className={LABEL_CLS}>{label}</Label>
        <LocalePicker />
      </div>
      <div
        className={cn(readOnly && "opacity-70 pointer-events-none")}
        dir={dir}
      >
        {grid}
      </div>
    </GlassCard>
  )
}

// ===========================================================================
// Multi-dimension picker
// ===========================================================================

function MultiPickerCard({
  nodeId,
  label,
  data,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  displayMode = "inline",
  meta,
}: PickerInputCardProps & { meta: MultiDimParameterPickerMeta }) {
  const dir = useLocaleDir()
  const { resolveLabel } = useLocalizedCatalog(meta.catalogId)
  const [modalOpen, setModalOpen] = useState(false)

  // Build the value object from the right source — fullscreen reads from
  // inputValues first, falls back to node.data for unset fields.
  const value = useMemo<MultiDimValue>(() => {
    const out: Record<string, string | ReadonlyArray<string> | undefined> = {}
    const overrides = isFullscreen ? inputValues[nodeId] ?? {} : {}
    for (const f of meta.fields) {
      const raw =
        overrides[f] !== undefined ? overrides[f] : data[f]
      if (typeof raw === "string") {
        out[f] = raw
      } else if (Array.isArray(raw)) {
        out[f] = raw.filter((v): v is string => typeof v === "string")
      } else {
        out[f] = undefined
      }
    }
    return out
  }, [meta.fields, isFullscreen, inputValues, nodeId, data])

  const handlePatch = (patch: MultiDimValue) => {
    if (isFullscreen) {
      for (const [k, v] of Object.entries(patch)) {
        onUpdateInput(nodeId, k, v)
      }
    } else {
      useWorkflowStore.getState().updateNodeData(nodeId, patch as Record<string, unknown>)
    }
  }

  const Picker = meta.Picker

  // Summary (modal preview chip): list of resolved labels for non-empty dims.
  const summaryParts = useMemo(() => {
    const map = new Map(meta.catalogEntries.map((e) => [e.id, e.label]))
    const parts: string[] = []
    const seen = new Set<string>()
    for (const f of meta.fields) {
      const v = value[f]
      const ids = pickIds(v)
      for (const id of ids) {
        if (seen.has(id)) continue
        seen.add(id)
        const fallback = map.get(id) ?? id
        parts.push(resolveLabel(id, fallback))
      }
    }
    return parts
  }, [meta.fields, meta.catalogEntries, value, resolveLabel])

  // Compact mode for multi-dim — same shape as modal but denser (smaller chip
  // strip, no preview button, single line). Multi-dim doesn't have a true
  // dropdown; this is the densest sensible variant.
  if (displayMode === "compact") {
    return (
      <GlassCard>
        <div className="flex items-center justify-between mb-2 gap-2">
          <Label className={LABEL_CLS}>{label}</Label>
          <LocalePicker />
        </div>
        <button
          type="button"
          onClick={() => !readOnly && setModalOpen(true)}
          disabled={readOnly}
          className={cn(
            "w-full rounded-md bg-muted/30 border border-border px-3 py-1.5 text-left text-sm transition-colors flex items-center justify-between gap-2",
            !readOnly && "hover:border-[#ff0073]/50 cursor-pointer",
          )}
          dir={dir}
          aria-label={`Configure ${meta.label}`}
        >
          <span className="flex-1 min-w-0 truncate">
            {summaryParts.length === 0 ? (
              <span className="text-muted-foreground italic">
                {`Configure ${meta.label.toLowerCase()}…`}
              </span>
            ) : (
              <span className="text-foreground">{summaryParts.join(" · ")}</span>
            )}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        </button>

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-auto" dir={dir}>
            <DialogHeader>
              <DialogTitle>{`Configure ${meta.label}`}</DialogTitle>
            </DialogHeader>
            <Picker value={value} onChange={handlePatch} />
          </DialogContent>
        </Dialog>
      </GlassCard>
    )
  }

  if (displayMode === "modal") {
    return (
      <GlassCard>
        <div className="flex items-center justify-between mb-2 gap-2">
          <Label className={LABEL_CLS}>{label}</Label>
          <LocalePicker />
        </div>
        <div className="flex items-center gap-3" dir={dir}>
          <button
            type="button"
            onClick={() => !readOnly && setModalOpen(true)}
            disabled={readOnly}
            className={cn(
              "flex-1 min-w-0 rounded-lg bg-muted/30 border border-border px-3 py-2 text-left transition-colors",
              !readOnly && "hover:border-[#ff0073]/50 cursor-pointer",
            )}
            aria-label={`Configure ${meta.label}`}
          >
            {summaryParts.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                {`No ${meta.label.toLowerCase()} selected — click to configure`}
              </p>
            ) : (
              <p className="text-sm text-foreground line-clamp-2">
                {summaryParts.join(" · ")}
              </p>
            )}
          </button>
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setModalOpen(true)}
              className="h-8 px-2 gap-1 shrink-0"
            >
              <Pencil className="size-3.5" />
              <span className="text-xs">Edit</span>
            </Button>
          )}
        </div>

        <Dialog open={modalOpen} onOpenChange={setModalOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-auto" dir={dir}>
            <DialogHeader>
              <DialogTitle>{`Configure ${meta.label}`}</DialogTitle>
            </DialogHeader>
            <Picker value={value} onChange={handlePatch} />
          </DialogContent>
        </Dialog>
      </GlassCard>
    )
  }

  // Inline mode
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2 gap-2">
        <Label className={LABEL_CLS}>{label}</Label>
        <LocalePicker />
      </div>
      <div
        className={cn(readOnly && "opacity-70 pointer-events-none")}
        dir={dir}
      >
        <Picker value={value} onChange={handlePatch} />
      </div>
    </GlassCard>
  )
}
