import { Input } from "@/components/ui/input"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SceneNodeType } from "@/types/nodes"

interface ParameterCardProps {
  nodeId: string
  label: string
  nodeType: SceneNodeType
  data: Record<string, unknown>
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
}

/** Get the primary value field name for a parameter node type */
function getValueField(nodeType: SceneNodeType): string {
  switch (nodeType) {
    case "tone": return "tone"
    case "style-guide": return "styleGuide"
    case "provider": return "provider"
    case "scene-count": return "count"
    case "duration": return "duration"
    case "aspect-ratio": return "aspectRatio"
    case "motion": return "motion"
    case "camera-motion": return "cameraMotion"
    default: return "value"
  }
}

export function ParameterCard({
  nodeId,
  label,
  nodeType,
  data,
  isFullscreen,
  inputValues,
  onUpdateInput,
}: ParameterCardProps) {
  const field = getValueField(nodeType)
  const currentValue = isFullscreen
    ? (inputValues[nodeId]?.[field] as string ?? data[field] as string ?? "")
    : (data[field] as string ?? "")

  const handleChange = (value: string) => {
    if (isFullscreen) {
      onUpdateInput(nodeId, field, value)
    } else {
      useWorkflowStore.getState().updateNodeData(nodeId, { [field]: value })
    }
  }

  return (
    <div className="bg-white dark:bg-[#1E1E1E] rounded-lg border border-gray-200 dark:border-[#2D2D2D] p-4 shadow-sm">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {label}
      </label>
      <Input
        value={currentValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`Enter ${label.toLowerCase()}...`}
      />
    </div>
  )
}
