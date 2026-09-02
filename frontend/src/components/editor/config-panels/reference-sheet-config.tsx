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
import { SHEET_TYPES, SHEET_SKINS, SHEET_ASPECTS, type SheetType, type SheetSkin, type SheetAspect, type SheetFlavour, type EntityKind } from "@nodaro/shared"
import { useT, tx } from "@/lib/i18n"
import type { ReferenceSheetData } from "@/types/nodes"
import type { ConfigProps } from "./types"

// Live getters, not module constants: a table built at import time would freeze
// the boot locale and never follow a language switch (reasoning-effort-select's
// EFFORT_LABELS() is the reference implementation).
function TYPE_LABELS(): Record<SheetType, string> {
  return {
    turnaround: tx("cfgext.refSheetTypeTurnaround"),
    "variation-board": tx("cfgext.refSheetTypeVariationBoard"),
    detail: tx("cfgext.refSheetTypeDetail"),
    "full-reference": tx("cfgext.refSheetTypeFullReference"),
  }
}
function SKIN_LABELS(): Record<SheetSkin, string> {
  return {
    studio: tx("cfgext.refSheetSkinStudio"),
    cinematic: tx("cfgext.refSheetSkinCinematic"),
    blueprint: tx("cfgext.refSheetSkinBlueprint"),
    illustrated: tx("cfgext.refSheetSkinIllustrated"),
  }
}
function ASPECT_LABELS(): Record<SheetAspect, string> {
  return {
    landscape: tx("cfgext.refSheetAspectLandscape"),
    square: tx("cfgext.refSheetAspectSquare"),
    story: tx("cfgext.refSheetAspectStory"),
  }
}

function ENTITY_META(): Record<EntityKind, { label: string; Icon: typeof User }> {
  return {
    character: { label: tx("assetlib.typeCharacter"), Icon: User },
    object: { label: tx("assetlib.typeObject"), Icon: Box },
    location: { label: tx("assetlib.typeLocation"), Icon: MapPin },
  }
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
  const t = useT()
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

  const entityMeta = connectedKind ? ENTITY_META()[connectedKind] : undefined

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Connected-entity indicator */}
      <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        {entityMeta ? (
          <div className="flex items-center gap-2 text-sm">
            <entityMeta.Icon className="w-4 h-4 text-[#ff0073]" />
            <span className="font-medium text-foreground">{t("cfgext.refSheetEntityConnected", { entity: entityMeta.label })}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Unplug className="w-4 h-4" />
            <span>{t("cfgext.refSheetConnectPrompt")}</span>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
          {t("cfgext.refSheetIntro")}
        </p>
      </div>

      {/* 2. Sheet type */}
      <div>
        <Label>{t("cfgext.refSheetSheetType")}</Label>
        <Select value={data.type ?? "full-reference"} onValueChange={(v) => onUpdate({ type: v as SheetType })}>
          <SelectTrigger aria-label={t("cfgext.refSheetSheetType")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHEET_TYPES.map((ty) => (
              <SelectItem key={ty} value={ty}>{TYPE_LABELS()[ty]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 3. Skin */}
      <div>
        <Label>{t("cfgext.refSheetSkinLabel")}</Label>
        <Select value={data.skin ?? "studio"} onValueChange={(v) => onUpdate({ skin: v as SheetSkin })}>
          <SelectTrigger aria-label={t("cfgext.refSheetSkinLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHEET_SKINS.map((s) => (
              <SelectItem key={s} value={s}>{SKIN_LABELS()[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 4. Layout */}
      <div>
        <Label>{t("cfgext.refSheetAspectLabel")}</Label>
        <Select value={flavour.aspect} onValueChange={(v) => updateFlavour({ aspect: v as SheetAspect })}>
          <SelectTrigger aria-label={t("cfgext.refSheetAspectLabel")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SHEET_ASPECTS.map((a) => (
              <SelectItem key={a} value={a}>{ASPECT_LABELS()[a]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="rs-with-text" className="cursor-pointer">{t("cfgext.refSheetWithText")}</Label>
        <Switch
          id="rs-with-text"
          checked={flavour.withText}
          onCheckedChange={(checked) => updateFlavour({ withText: checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="rs-show-labels" className="cursor-pointer">{t("cfgext.refSheetPanelLabels")}</Label>
        <Switch
          id="rs-show-labels"
          checked={flavour.showLabels}
          onCheckedChange={(checked) => updateFlavour({ showLabels: checked })}
        />
      </div>
    </div>
  )
}
