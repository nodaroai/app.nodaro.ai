// What is wired into an AI Avatar node right now — read reactively from the
// workflow store so the body can show "wired from Script Writer" / the
// upstream portrait, and the status bar can count a wired input as satisfied
// (the executor resolves inputs the same way: wired first, node data second).

import { useCallback } from "react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import type { AiAvatarWiring } from "./readiness"

export interface AiAvatarWiringInfo extends AiAvatarWiring {
  /** Label of the node feeding each input (undefined when not wired). */
  readonly scriptSourceLabel?: string
  readonly audioSourceLabel?: string
  readonly imageSourceLabel?: string
  /** The upstream text/image the wired input currently resolves to, when the
   *  source already has output (a typed text node, an uploaded/generated image). */
  readonly upstreamScript?: string
  readonly upstreamImageUrl?: string
}

const NOT_WIRED: AiAvatarWiringInfo = { script: false, audio: false, image: false }

export function useAiAvatarWiring(nodeId: string): AiAvatarWiringInfo {
  return useWorkflowStore(
    useShallow(
      useCallback(
        (s): AiAvatarWiringInfo => {
          const incoming = s.edges.filter((e) => e.target === nodeId)
          if (incoming.length === 0) return NOT_WIRED
          const feed = (handle: string) => {
            const edge = incoming.find((e) => e.targetHandle === handle)
            if (!edge) return undefined
            const src = s.nodes.find((n) => n.id === edge.source)
            if (!src) return undefined
            const label = (src.data as { label?: unknown } | undefined)?.label
            const output = extractNodeOutput(src, edge.sourceHandle ?? undefined)
            return {
              label: typeof label === "string" && label.trim() ? label : undefined,
              output: typeof output === "string" && output.trim() ? output : undefined,
            }
          }
          const script = feed("script")
          const audio = feed("audio")
          const image = feed("image")
          return {
            script: !!script,
            audio: !!audio,
            image: !!image,
            scriptSourceLabel: script?.label,
            audioSourceLabel: audio?.label,
            imageSourceLabel: image?.label,
            upstreamScript: script?.output,
            upstreamImageUrl: image?.output,
          }
        },
        [nodeId],
      ),
    ),
  )
}
