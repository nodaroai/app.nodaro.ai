import { listedSeedanceTaskType } from "@nodaro/shared/models"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  referenceVideoSecOfKey,
  seedanceTaskTypeAsRun,
  wiredReferenceVideoSecKey,
  type SeedanceTaskTypeAsRun,
} from "@/lib/seedance-task-type"
import type { WorkflowNode } from "@/types/nodes"

/**
 * What a Generate Video node's run declares and the length it runs at
 * (`seedanceTaskTypeAsRun`), from the reference clips wired into it in the
 * store — the same lengths the node's cost pill reads. The selector returns a
 * string, so it is stable; a node without the setting reads no graph.
 */
export function useSeedanceTaskTypeAsRun(
  nodeId: string,
  provider: string | undefined,
  duration: number | string | undefined,
  data: Readonly<Record<string, unknown>>,
): SeedanceTaskTypeAsRun {
  const listed = listedSeedanceTaskType(provider, data.referenceTaskType) !== undefined
  const key = useWorkflowStore((s) => (listed ? wiredReferenceVideoSecKey(nodeId, s.nodes as WorkflowNode[], s.edges) : "[]"))
  return seedanceTaskTypeAsRun({ provider, duration, data, referenceVideoSec: referenceVideoSecOfKey(key) })
}
