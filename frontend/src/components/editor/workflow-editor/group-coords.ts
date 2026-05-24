export interface Bbox { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

/** Minimum overlap fraction (0..1) for a dragged node to attach to a group on drag-end. */
export const GROUP_ATTACH_THRESHOLD = 0.7

export function computeOverlap(node: Bbox, group: Bbox): number {
  const xLeft = Math.max(node.x, group.x);
  const xRight = Math.min(node.x + node.width, group.x + group.width);
  const yTop = Math.max(node.y, group.y);
  const yBottom = Math.min(node.y + node.height, group.y + group.height);
  const overlapW = Math.max(0, xRight - xLeft);
  const overlapH = Math.max(0, yBottom - yTop);
  const intersect = overlapW * overlapH;
  const nodeArea = node.width * node.height;
  return nodeArea > 0 ? intersect / nodeArea : 0;
}

export function worldToLocal(worldPos: Point, groupPos: Point): Point {
  return { x: worldPos.x - groupPos.x, y: worldPos.y - groupPos.y };
}

export function localToWorld(localPos: Point, groupPos: Point): Point {
  return { x: localPos.x + groupPos.x, y: localPos.y + groupPos.y };
}

/**
 * React Flow v12 requires a parent node to appear BEFORE its children in the
 * nodes array. `adoptUserNodes` processes nodes in array order; a child seen
 * before its parent warns "Parent node not found" and renders at
 * positionAbsolute = its LOCAL coords (so it teleports to ~origin and the
 * group can't move it). Several store writes (drag-attach, paste, undo, load)
 * can leave the array child-before-parent, so callers run this wherever the
 * array reaches React Flow or is persisted.
 *
 * This is a SINGLE-LEVEL partition (top-level nodes kept in order, then
 * children in order). It is sufficient because groups cannot be nested: the
 * drag-attach path in `workflow-canvas.tsx` refuses to parent a group node.
 * It does NOT topologically sort, so a multi-level chain (a child that is
 * itself a parent) — only reachable via imported/pasted malformed JSON — is
 * not fully ordered. Returns the same array reference when there are no
 * children, to avoid needless re-renders.
 */
export function orderNodesParentFirst<N extends { id: string; parentId?: string }>(nodes: N[]): N[] {
  if (!nodes.some((n) => n.parentId)) return nodes;
  const parents: N[] = [];
  const children: N[] = [];
  for (const n of nodes) (n.parentId ? children : parents).push(n);
  return [...parents, ...children];
}
