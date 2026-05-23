/**
 * Cluster nodes by their `group` while preserving the first-appearance order of
 * both groups and the nodes within each group. Lets a flat node list render
 * contiguous group sub-headers even when the source array interleaves groups
 * (e.g. the "Pickers" category whose Camera/Look/Subject/Object/Sound entries are
 * scattered through the catalog).
 */
export function clusterByGroup<T extends { readonly group?: string }>(
  nodes: readonly T[],
): T[] {
  const order: string[] = []
  const byGroup = new Map<string, T[]>()
  for (const node of nodes) {
    const key = node.group ?? ""
    let bucket = byGroup.get(key)
    if (!bucket) {
      bucket = []
      byGroup.set(key, bucket)
      order.push(key)
    }
    bucket.push(node)
  }
  return order.flatMap((key) => byGroup.get(key) as T[])
}
