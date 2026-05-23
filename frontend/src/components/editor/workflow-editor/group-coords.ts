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
