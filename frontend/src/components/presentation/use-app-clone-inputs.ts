// @registry-lookup localizes the label of the one clone node it is given (useLocalizeNodeLabel)
import { useMemo } from "react"
import type { PresentationItem } from "@nodaro/shared/types"
import type { WorkflowNode } from "@/types/nodes"
import { getNodeLabel } from "@/lib/presentation-utils"
import { useT } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import { appCloneInputNode, appCloneNodes, appClonesReady, appRunNodeIds } from "@/lib/app-clone-inputs"
import { useOneOffCloneWithheld } from "@/lib/voice-clone-availability"

const NO_NODES: readonly WorkflowNode[] = []

interface AppCloneInputsArgs {
  /** The runner (an app, a share link, an embed): never the editor's own preview, where the author edits the node. */
  readonly enabled: boolean
  /** The graph as it ships (a published app's snapshot, a share link's graph). */
  readonly nodes: readonly WorkflowNode[]
  readonly inputValues: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>
  /** The runner's inputs as curated. */
  readonly orderedInputNodes: WorkflowNode[]
  readonly inputItems: PresentationItem[] | null
  /** Who runs it: only their own consent counts. */
  readonly userId: string | undefined
  /** The graph's wires and the app's settings: a baked route narrows the nodes the run executes. */
  readonly edges?: ReadonlyArray<{ source: string; target: string }>
  readonly settings?: { readonly runTarget?: string; readonly selectedRouteId?: string } | null
}

/**
 * The runner's inputs with one "Your voice" card per clone node appended
 * (decided 2026-11-13: recordings as app inputs), whatever the author curated
 * or hid — to the curated nodes AND, when the runner renders the curated items,
 * to the items — and whether every clone the run sends is filled with the
 * runner's own recordings and tick (Run waits until then). The desktop runner
 * and the phone's app shell read the same hook.
 */
export function useAppCloneInputs({ enabled, nodes, inputValues, orderedInputNodes, inputItems, userId, edges, settings }: AppCloneInputsArgs) {
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()
  const runNodeIds = useMemo(() => (enabled ? appRunNodeIds(nodes, edges ?? [], settings) : undefined), [enabled, nodes, edges, settings?.runTarget, settings?.selectedRouteId])
  const targets = enabled ? appCloneNodes(nodes, inputValues, runNodeIds) : NO_NODES
  // Keyed by which nodes they are, so a keystroke elsewhere keeps the cards' nodes (and their memoized cards) as they were.
  const targetsKey = targets.map((n) => n.id).join("\n")
  const cloneNodes = useMemo(() => {
    const several = targets.length > 1
    return targets.map((n) =>
      appCloneInputNode(n, several ? t("appClone.titleFor", { label: localizeNode(getNodeLabel(n)) }) : t("appClone.title")),
    )
    // `targets` is rebuilt every render; its ids are the key.
  }, [targetsKey, nodes, t, localizeNode])

  const runnerInputNodes = useMemo(
    () => (cloneNodes.length > 0 ? [...orderedInputNodes, ...cloneNodes] : orderedInputNodes),
    [orderedInputNodes, cloneNodes],
  )
  // The curated items render in place of the nodes when there are any (NodeSection, the phone's inputs tab).
  const runnerInputItems = useMemo<PresentationItem[] | null>(
    () =>
      inputItems && inputItems.length > 0 && cloneNodes.length > 0
        ? [...inputItems, ...cloneNodes.map((n) => ({ type: "node" as const, nodeId: n.id }))]
        : inputItems,
    [inputItems, cloneNodes],
  )
  const cloneNodeMap = useMemo(() => new Map(cloneNodes.map((n) => [n.id, n])), [cloneNodes])
  const ready = !enabled || appClonesReady(nodes, inputValues, userId, runNodeIds)
  // Where the deployment withholds one-off clones, the run is refused whatever the runner gives: Run says so.
  const withheld = useOneOffCloneWithheld() && cloneNodes.length > 0

  return { cloneNodes, inputNodes: runnerInputNodes, inputItems: runnerInputItems, cloneNodeMap, ready: ready && !withheld, withheld }
}
