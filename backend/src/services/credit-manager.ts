const CREDIT_COSTS: Record<string, number> = {
  "generate-script": 2,
  "generate-image": 5,
  "image-to-video": 20,
  "video-to-video": 25,
  "text-to-video": 25,
  "text-to-speech": 3,
  "qa-check": 1,
  "combine-videos": 2,
  "add-audio": 1,
  "add-captions": 2,
  "resize-video": 1,
  "extract-audio": 1,
  "mix-audio": 1,
  "adjust-volume": 0,
  "trim-video": 0,
}

export function estimateWorkflowCredits(
  nodes: ReadonlyArray<{ type: string }>,
): number {
  return nodes.reduce((sum, node) => sum + (CREDIT_COSTS[node.type] ?? 0), 0)
}
