import type { NodeProps } from "@xyflow/react"

export function NodeComponent({ data }: NodeProps) {
  return <div>{String(data.label)}</div>
}
