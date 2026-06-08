"use client"

import { useEffect, useMemo } from "react"
import { User, Box, MapPin, Unplug } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  SHEET_TYPES,
  SHEET_SKINS,
  SHEET_ASPECTS,
  type SheetType,
  type SheetSkin,
  type SheetAspect,
  type SheetFlavour,
  type EntityKind,
} from "@nodaro/shared"
import type { ReferenceSheetData } from "@/types/nodes"
import type { ConfigProps } from "./types"

const TYPE_LABELS: Record<SheetType, string> = {
  turnaround: "Turnaround",
  "variation-board": "Variation Board",
  detail: "Detail",
  "full-reference": "Full Reference",
}
const SKIN_LABELS: Record<SheetSkin, string> = {
  studio: "Studio",
  cinematic: "Cinematic",
  blueprint: "Blueprint",
  illustrated: "Illustrated",
}
const ASPECT_LABELS: Record<SheetAspect, string> = {
  landscape: "Landscape",
  square: "Square",
  story: "Story (9:16)",
}

const ENTITY_META: Record<EntityKind, { label: string; Icon: typeof User }> = {
  character: { label: "Character", Icon: User },
  object: { label: "Object", Icon: Box },
  location: { label: "Location", Icon: MapPin },
}

const ENTITY_TYPES = new Set<string>(["character", "object", "location"])

/**
 * Settings panel for the Reference Sheet node. On Run the node generates any
 * panels the chosen type needs but the connected entity lacks (off its main
 * image), then composites them into the sheet — a one-click reference sheet
 * (Stage A + B live in execute-node's reference-sheet block). The panel exposes:
 *   1. Connected-entity indicator (read from nodes+edges on the `in` handle) —
 *      mirrors the ConnectedCinematographySources pattern.
 *   2. Sheet TYPE (turnaround / variation-board / detail / full-reference).
 *   3. SKIN (studio / cinematic / blueprint / illustrated).
 *   4. Layout: aspect + withText / showLabels toggles. (`flavour.background` is
 *      defaulted to "grey" but has no user-facing control — the compositor's
 *      background is skin-driven, so the lever was inert.)
 *
 * All four sheet types are valid for every entity kind (see DEFAULT_SECTIONS in
 * the shared catalog), so the type menu is NOT filtered by entity — the
 * `useEffect([connectedEntityKind])` below is a fail-safe that only re-clamps a
 * `type` value that has somehow drifted outside SHEET_TYPES.
 */
export function ReferenceSheetConfig({
  data,
  onUpdate,
  nodes,
  edges,
  nodeId,
}: ConfigProps<ReferenceSheetData> & { nodeId?: string }) {
  const flavour: SheetFlavour =
    data.flavour ?? { outputFormat: "still", withText: true, showLabels: true, aspect: "landscape", background: "grey" }

  // Resolve the connected entity on the `in` handle (character / object /
  // location). Walk this node's incoming edges to the upstream entity node.
  const connectedKind = useMemo<EntityKind | undefined>(() => {
    if (!nodeId) return undefined
    for (const edge of edges ?? []) {
      if (edge.target !== nodeId) continue
      if (edge.targetHandle && edge.targetHandle !== "in") continue
      const src = nodes.find((n) => n.id === edge.source)
      if (src && ENTITY_TYPES.has(src.type ?? "")) return src.type as EntityKind
    }
    return undefined
  }, [nodes, edges, nodeId])

  // Keep `connectedEntityKind` on node data in sync (informational — used by the
  // node card / downstream). Fail-safe: re-clamp `type` if it ever drifts out of
  // the valid SHEET_TYPES set when the connected kind changes.
  useEffect(() => {
    const patch: Record<string, unknown> = {}
    if (connectedKind !== data.connectedEntityKind) patch.connectedEntityKind = connectedKind
    if (!SHEET_TYPES.includes(data.type)) patch.type = SHEET_TYPES[SHEET_TYPES.length - 1] // full-reference
    if (Object.keys(patch).length > 0) onUpdate(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedKind])

  const updateFlavour = (partial: Partial<SheetFlavour>) => onUpdate({ flavour: { ...flavour, ...partial } })

  const entityMeta = connectedKind ? ENTITY_META[connectedKind] : undefined

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Connected-entity indicator */}
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        {entityMeta ? (
          <div className="flex items-center gap-2 text-sm">
            <entityMeta.Icon className="w-4 h-4 text-[#ff0073]" />
            <span className="font-medium text-foreground">{entityMeta.label} connected</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Unplug className="w-4 h-4" />
            <span>Connect a character, object, or location</span>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
          Generates any missing panels from the main image, then composes the sheet. The entity needs a main image.
        </p>
      </div>

      {/* 2. Sheet type */}
      <div>
        <Label>Sheet type</Label>
        <Select value={data.type ?? "full-reference"} onValueChange={(v) => onUpdate({ type: v as SheetType })}>
          <SelectTrigger aria-label="Sheet type"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHEET_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 3. Skin */}
      <div>
        <Label>Skin</Label>
        <Select value={data.skin ?? "studio"} onValueChange={(v) => onUpdate({ skin: v as SheetSkin })}>
          <SelectTrigger aria-label="Skin"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHEET_SKINS.map((s) => (
              <SelectItem key={s} value={s}>{SKIN_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 4. Layout */}
      <div>
        <Label>Aspect</Label>
        <Select value={flavour.aspect} onValueChange={(v) => updateFlavour({ aspect: v as SheetAspect })}>
          <SelectTrigger aria-label="Aspect"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHEET_ASPECTS.map((a) => (
              <SelectItem key={a} value={a}>{ASPECT_LABELS[a]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="rs-with-text" className="cursor-pointer">Title & metadata text</Label>
        <Switch
          id="rs-with-text"
          checked={flavour.withText}
          onCheckedChange={(checked) => updateFlavour({ withText: checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="rs-show-labels" className="cursor-pointer">Panel labels</Label>
        <Switch
          id="rs-show-labels"
          checked={flavour.showLabels}
          onCheckedChange={(checked) => updateFlavour({ showLabels: checked })}
        />
      </div>
    </div>
  )
}
