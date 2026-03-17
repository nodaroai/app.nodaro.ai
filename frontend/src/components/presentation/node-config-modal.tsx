/**
 * Modal that renders a node's config panel inside a Dialog.
 * Used in presentation mode for "config-type" input nodes
 * (e.g. social post nodes) that need their full config UI.
 */

import type { ComponentType } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getNodeLabel } from "@/lib/presentation-utils"
import {
  InstagramPostConfig,
  TiktokPostConfig,
  YoutubeUploadConfig,
  LinkedinPostConfig,
  XPostConfig,
  FacebookPostConfig,
} from "@/components/editor/config-panels/social-configs"
import { SocialMediaFormatConfig } from "@/components/editor/config-panels/processing-configs"
import type { WorkflowNode } from "@/types/nodes"

/* eslint-disable @typescript-eslint/no-explicit-any */
const NODE_CONFIG_MAP: Record<string, ComponentType<any>> = {
  "instagram-post": InstagramPostConfig,
  "tiktok-post": TiktokPostConfig,
  "youtube-upload": YoutubeUploadConfig,
  "linkedin-post": LinkedinPostConfig,
  "x-post": XPostConfig,
  "facebook-post": FacebookPostConfig,
  "social-media-format": SocialMediaFormatConfig,
}

export const CONFIG_INPUT_TYPES = new Set(Object.keys(NODE_CONFIG_MAP))

interface NodeConfigModalProps {
  node: WorkflowNode | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const EMPTY_SOURCES: readonly never[] = []
const EMPTY_FIELD_MAPPINGS = {} as const
const EMPTY_NODES: readonly WorkflowNode[] = []
const NOOP_MAP_FIELD = () => {}

export function NodeConfigModal({ node, open, onOpenChange }: NodeConfigModalProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  if (!node || !node.type) return null

  const ConfigComponent = NODE_CONFIG_MAP[node.type]
  if (!ConfigComponent) return null

  const label = getNodeLabel(node)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <ConfigComponent
          data={node.data}
          onUpdate={(patch: Record<string, unknown>) => updateNodeData(node.id, patch)}
          sources={EMPTY_SOURCES}
          fieldMappings={EMPTY_FIELD_MAPPINGS}
          onMapField={NOOP_MAP_FIELD}
          nodes={EMPTY_NODES}
        />
      </DialogContent>
    </Dialog>
  )
}
