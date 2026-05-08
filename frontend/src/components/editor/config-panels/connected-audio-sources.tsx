"use client"

import { useMemo, type ReactNode } from "react"
import { Music, Activity, Piano, User, MessageCircle, type LucideIcon } from "lucide-react"
import { getParameterPromptHint } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { cn } from "@/lib/utils"

interface Props {
  readonly consumerNodeId: string | undefined
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  readonly className?: string
}

const ICON_BY_TYPE: Record<string, LucideIcon> = {
  "music-genre": Music,
  "music-mood": Activity,
  "instrumentation": Piano,
  "voice-character": User,
  "voice-delivery": MessageCircle,
}

const LABEL_BY_TYPE: Record<string, string> = {
  "music-genre": "Music Genre",
  "music-mood": "Music Mood",
  "instrumentation": "Instrumentation",
  "voice-character": "Voice Character",
  "voice-delivery": "Voice Delivery",
}

interface Source {
  readonly key: string
  readonly type: string
  readonly hint: string
}

function collect(
  consumerNodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Source[] {
  if (!consumerNodeId) return []
  const out: Source[] = []
  for (const e of edges) {
    if (e.target !== consumerNodeId) continue
    if (e.targetHandle !== "audio-style") continue
    const src = nodes.find((n) => n.id === e.source)
    if (!src) continue
    const type = src.type as string | undefined
    if (!type || !ICON_BY_TYPE[type]) continue
    const hint = getParameterPromptHint({ id: src.id, type, data: src.data })
    if (hint) out.push({ key: src.id, type, hint })
  }
  return out
}

/**
 * Read-only list of every Sound parameter node connected to a consumer's
 * `audio-style` input handle. One row per source, each with a type icon
 * (Music/Activity/Piano/User/MessageCircle), the node's label, and the
 * composed prompt hint that the aggregator will feed to the consumer.
 *
 * Empty state: renders nothing — less visual noise when no Sound nodes
 * are wired up.
 */
export function ConnectedAudioSources({ consumerNodeId, nodes, edges, className }: Props): ReactNode {
  const sources = useMemo(() => collect(consumerNodeId, nodes, edges), [consumerNodeId, nodes, edges])
  if (sources.length === 0) return null
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        Connected Sound
      </div>
      {sources.map((s) => {
        const Icon = ICON_BY_TYPE[s.type]
        return (
          <div key={s.key} className="flex items-start gap-2 text-xs">
            <Icon className="size-3.5 mt-0.5 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="font-medium">{LABEL_BY_TYPE[s.type]}</span>
              <span className="text-muted-foreground italic">{s.hint}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
