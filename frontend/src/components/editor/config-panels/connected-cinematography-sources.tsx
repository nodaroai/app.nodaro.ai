"use client"

import { useMemo, type ReactNode } from "react"
import { Frame, Aperture, Film, Lightbulb, SwatchBook, CloudFog, Clock, Video, SlidersHorizontal, Palette, Brush, type LucideIcon } from "lucide-react"
import { getCameraMotion, getCameraMotionLabel } from "@nodaro/shared"
import { getFraming, FRAMING_FIELD_BY_CATEGORY, FRAMING_CATEGORY_LABELS } from "@nodaro/shared"
import { getLighting, LIGHTING_FIELD_BY_CATEGORY, LIGHTING_CATEGORY_LABELS } from "@nodaro/shared"
import { getLens, getLensLabel } from "@nodaro/shared"
import { getCameraFormat, getCameraFormatLabel } from "@nodaro/shared"
import { getColorLook, getColorLookLabel } from "@nodaro/shared"
import { getAtmosphere, getAtmosphereLabel } from "@nodaro/shared"
import { getStyle, getStyleLabel } from "@nodaro/shared"
import { getTemporal, TEMPORAL_FIELD_BY_CATEGORY, TEMPORAL_CATEGORY_LABELS } from "@nodaro/shared"
import { FramingPreview } from "./framing-preview"
import { LightingPreview } from "./lighting-preview"
import { LensPreview } from "./lens-preview"
import { CameraFormatPreview } from "./camera-format-preview"
import { ColorLookPreview } from "./color-look-preview"
import { AtmospherePreview } from "./atmosphere-preview"
import { StylePreview } from "./style-preview"
import { TemporalPreview } from "./temporal-preview"
import { CameraMotionPreview } from "./camera-motion-preview"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { cn } from "@/lib/utils"

interface Props {
  readonly consumerNodeId: string | undefined
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  readonly className?: string
}

interface SourceEntry {
  readonly key: string
  readonly icon: LucideIcon
  readonly title: string
  readonly description: string
  readonly preview: ReactNode
}

function collectSources(
  consumerNodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): SourceEntry[] {
  if (!consumerNodeId) return []
  const entries: SourceEntry[] = []
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    if (edge.targetHandle !== "cinematography") continue
    const src = nodes.find((n) => n.id === edge.source)
    if (!src) continue
    const data = src.data as Record<string, unknown>
    const srcNodeLabel = (data.label as string | undefined) || src.type || "Source"

    switch (src.type) {
      case "camera-motion": {
        const motionId = data.cameraMotion as string | undefined
        if (!motionId) continue
        const motion = getCameraMotion(motionId)
        entries.push({
          key: src.id,
          icon: Video,
          title: `${srcNodeLabel}: ${getCameraMotionLabel(motionId)}`,
          description: motion?.description ?? "",
          preview: <CameraMotionPreview motionId={motionId} className="w-full aspect-[16/9]" />,
        })
        break
      }
      case "framing": {
        // Show each enabled category as its own entry so the user can see exactly
        // what's contributing.
        for (const category of Object.keys(FRAMING_FIELD_BY_CATEGORY) as Array<keyof typeof FRAMING_FIELD_BY_CATEGORY>) {
          const field = FRAMING_FIELD_BY_CATEGORY[category]
          const id = data[field] as string | undefined
          if (!id) continue
          const entry = getFraming(id)
          if (!entry) continue
          entries.push({
            key: `${src.id}:${category}`,
            icon: Frame,
            title: `${srcNodeLabel} · ${FRAMING_CATEGORY_LABELS[category]}: ${entry.label}`,
            description: entry.description,
            preview: <FramingPreview framingId={id} className="w-full aspect-[16/9]" />,
          })
        }
        break
      }
      case "lighting": {
        for (const category of Object.keys(LIGHTING_FIELD_BY_CATEGORY) as Array<keyof typeof LIGHTING_FIELD_BY_CATEGORY>) {
          const field = LIGHTING_FIELD_BY_CATEGORY[category]
          const id = data[field] as string | undefined
          if (!id) continue
          const entry = getLighting(id)
          if (!entry) continue
          entries.push({
            key: `${src.id}:${category}`,
            icon: Lightbulb,
            title: `${srcNodeLabel} · ${LIGHTING_CATEGORY_LABELS[category]}: ${entry.label}`,
            description: entry.description,
            preview: <LightingPreview lightingId={id} className="w-full aspect-[16/9]" />,
          })
        }
        break
      }
      case "temporal": {
        for (const category of Object.keys(TEMPORAL_FIELD_BY_CATEGORY) as Array<keyof typeof TEMPORAL_FIELD_BY_CATEGORY>) {
          const field = TEMPORAL_FIELD_BY_CATEGORY[category]
          const id = data[field] as string | undefined
          if (!id) continue
          const entry = getTemporal(id)
          if (!entry) continue
          entries.push({
            key: `${src.id}:${category}`,
            icon: Clock,
            title: `${srcNodeLabel} · ${TEMPORAL_CATEGORY_LABELS[category]}: ${entry.label}`,
            description: entry.description,
            preview: <TemporalPreview temporalId={id} className="w-full aspect-[16/9]" />,
          })
        }
        break
      }
      case "lens": {
        const id = data.lens as string | undefined
        if (!id) continue
        const entry = getLens(id)
        if (!entry) continue
        entries.push({
          key: src.id,
          icon: Aperture,
          title: `${srcNodeLabel}: ${getLensLabel(id)}`,
          description: entry.description,
          preview: <LensPreview lensId={id} className="w-full aspect-[16/9]" />,
        })
        break
      }
      case "camera-format": {
        const id = data.cameraFormat as string | undefined
        if (!id) continue
        const entry = getCameraFormat(id)
        if (!entry) continue
        entries.push({
          key: src.id,
          icon: Film,
          title: `${srcNodeLabel}: ${getCameraFormatLabel(id)}`,
          description: entry.description,
          preview: <CameraFormatPreview cameraFormatId={id} className="w-full aspect-[16/9]" />,
        })
        break
      }
      case "color-look": {
        const id = data.colorLook as string | undefined
        if (!id) continue
        const entry = getColorLook(id)
        if (!entry) continue
        entries.push({
          key: src.id,
          icon: SwatchBook,
          title: `${srcNodeLabel}: ${getColorLookLabel(id)}`,
          description: entry.description,
          preview: <ColorLookPreview colorLookId={id} className="w-full aspect-[16/9]" />,
        })
        break
      }
      case "atmosphere": {
        const id = data.atmosphere as string | undefined
        if (!id) continue
        const entry = getAtmosphere(id)
        if (!entry) continue
        entries.push({
          key: src.id,
          icon: CloudFog,
          title: `${srcNodeLabel}: ${getAtmosphereLabel(id)}`,
          description: entry.description,
          preview: <AtmospherePreview atmosphereId={id} className="w-full aspect-[16/9]" />,
        })
        break
      }
      case "style": {
        const id = data.style as string | undefined
        if (!id) continue
        const entry = getStyle(id)
        if (!entry) continue
        entries.push({
          key: src.id,
          icon: Brush,
          title: `${srcNodeLabel}: ${getStyleLabel(id)}`,
          description: entry.description,
          preview: <StylePreview styleId={id} className="w-full aspect-[16/9]" />,
        })
        break
      }
      case "tone": {
        const toneText = data.tone as string | undefined
        if (!toneText) continue
        entries.push({
          key: src.id,
          icon: Palette,
          title: `${srcNodeLabel}: ${toneText}`,
          description: "Tone",
          preview: null,
        })
        break
      }
      case "motion": {
        const motion = data.motion as string | undefined
        if (!motion) continue
        entries.push({
          key: src.id,
          icon: SlidersHorizontal,
          title: `${srcNodeLabel}: ${motion}`,
          description: "Motion",
          preview: null,
        })
        break
      }
    }
  }
  return entries
}

/**
 * Read-only list of every cinematography source connected to this AI gen
 * node's `cinematography` input handle. One row per source (or per enabled
 * sub-category for multi-category nodes like Framing / Lighting / Temporal),
 * each with a mini preview illustration, icon, title (`<label>: <selection>`
 * or `<label> · <category>: <entry>`), and short description.
 *
 * Empty state: renders nothing. No "no connections" header — less visual
 * noise when the user isn't using cinematography yet.
 */
export function ConnectedCinematographySources({ consumerNodeId, nodes, edges, className }: Props) {
  const entries = useMemo(
    () => collectSources(consumerNodeId, nodes, edges),
    [consumerNodeId, nodes, edges],
  )

  if (entries.length === 0) return null

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
        Connected cinematography ({entries.length})
      </p>
      <div className="flex flex-col gap-2">
        {entries.map((e) => {
          const Icon = e.icon
          return (
            <div
              key={e.key}
              className="flex gap-2 rounded-lg border border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] p-2"
            >
              {e.preview && (
                <div className="w-24 shrink-0 self-start rounded overflow-hidden">
                  {e.preview}
                </div>
              )}
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Icon className="size-3 text-muted-foreground shrink-0" />
                  <p className="text-[11px] font-medium text-foreground truncate">{e.title}</p>
                </div>
                {e.description && (
                  <p className="text-[10px] text-muted-foreground leading-snug break-words">{e.description}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
