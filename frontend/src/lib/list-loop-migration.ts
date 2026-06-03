import type { LoopColumn, SceneNodeType, WorkflowEdge, WorkflowNode } from "@/types/nodes"

export interface ListLoopMigrationResult {
  readonly nodes: WorkflowNode[]
  readonly edges: WorkflowEdge[]
}

/**
 * One-way, idempotent migration run on every workflow load:
 *  1. Rewrite legacy `loop` ("Table") nodes to the canonical `list` type.
 *  2. Normalize the legacy `items` string into `columns` + `rows`.
 *  3. Preserve the legacy list-only "ensure a default column" behavior that
 *     previously lived in a render-time useEffect (loop-node.tsx) — applied
 *     ONLY to nodes that were already `list`, so empty `loop` tables stay empty.
 * Edges are never changed — `list` and `loop` share handle ids (`col_*`, `col_add`).
 */
export function migrateListLoopNodes(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): ListLoopMigrationResult {
  const migratedNodes = nodes.map((n) => {
    const wasLoop = n.type === "loop"
    const wasList = n.type === "list"
    if (!wasLoop && !wasList) return n

    const d = { ...((n.data as Record<string, unknown>) ?? {}) }
    let dataChanged = false

    if (typeof d.items === "string" && !d.columns) {
      const items = (d.items as string).split("\n").map((l) => l.trim()).filter((l) => l !== "")
      const colId = crypto.randomUUID()
      const col: LoopColumn = { id: colId, name: "Items", handleId: `col_${colId}`, type: "text" }
      d.columns = [col]
      d.rows = items.map((item) => [item])
      delete d.items
      dataChanged = true
    } else if (wasList && !d.columns) {
      const colId = crypto.randomUUID()
      const col: LoopColumn = { id: colId, name: "Items", handleId: `col_${colId}`, type: "text" }
      d.columns = [col]
      d.rows = [[""]]
      dataChanged = true
    }

    if (!wasLoop && !dataChanged) return n
    return {
      ...n,
      type: "list" as SceneNodeType,
      data: dataChanged ? d : n.data,
    }
  })

  // `.map` already returns each unchanged node by reference, so this is a no-op
  // for graphs with no loop/legacy-items nodes (no separate early-return needed).
  return { nodes: migratedNodes, edges: [...edges] }
}

/**
 * Single source of truth for the list/loop "multi-column" predicate.
 *
 * After loop→list unification a node's TYPE is always `list`; what used to be a
 * `loop` ("Table") node is now a `list` whose `columns` array has length > 1.
 * Every presentation / app-runner spot that USED to branch on node type
 * (`loop` → multi-column table shape `{rows}`, `list` → single-column `{items}`)
 * must instead branch on this column count, or a former multi-column loop that
 * became a `list` silently loses columns 2+.
 *
 * The single discriminator now that node type is always `list`: consumed by the
 * config panel (`singleColumn = !isMultiColumnList`, input-configs.tsx), the
 * input-card router (input-card.tsx), and the app-runner / presentation shape
 * builders. Reads `columns` off raw node `data` so it works on un-typed snapshot
 * nodes too.
 */
export function isMultiColumnList(data: Record<string, unknown> | undefined): boolean {
  const columns = (data?.columns as unknown[] | undefined) ?? []
  return columns.length > 1
}
