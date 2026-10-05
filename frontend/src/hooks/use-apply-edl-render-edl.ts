/**
 * What an Apply EDL node would render now — the hook face of
 * `resolveApplyEdlRenderEdl` and `resolveApplyEdlRenderSources`. The EDL value
 * is a stable reference while nothing changed (a scalar is a string; the one
 * path that builds an array, a wire's fan-out list, is memoized per wire), and
 * the sources travel through the selector as one string, which compares by
 * value: a fresh array per call would never compare equal, and
 * `useSyncExternalStore` needs a stable snapshot.
 */
import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  resolveApplyEdlRenderEdl,
  resolveApplyEdlRenderSources,
  type ApplyEdlRenderEdl,
} from "@/lib/apply-edl-render-input"

export interface ApplyEdlRenderInput extends ApplyEdlRenderEdl {
  /** The `sources` wires' media URLs, positional (see `resolveApplyEdlRenderSources`). */
  readonly sources: readonly string[]
}

const NOTHING = { value: undefined, source: "inline", sourcesKey: "[]" } as const

export function useApplyEdlRenderEdl(nodeId: string | undefined): ApplyEdlRenderInput {
  const { value, source, sourcesKey } = useWorkflowStore(
    useShallow((s) => {
      const node = nodeId ? s.nodes.find((n) => n.id === nodeId) : undefined
      if (!node) return NOTHING
      const edl = resolveApplyEdlRenderEdl(node, s.nodes, s.edges)
      return {
        value: edl.value,
        source: edl.source,
        sourcesKey: JSON.stringify(resolveApplyEdlRenderSources(node, s.nodes, s.edges)),
      }
    }),
  )
  const sources = useMemo(() => JSON.parse(sourcesKey) as string[], [sourcesKey])
  return { value, source, sources }
}
