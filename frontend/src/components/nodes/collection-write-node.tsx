"use client"

import { memo } from "react"
import { useT } from "@/lib/i18n"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, Database, Film, Image as ImageIcon, Type } from "lucide-react"
import { collectionRecordHeadline } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useCollections } from "@/hooks/queries/use-collections-queries"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import type { CollectionWriteData } from "@/types/nodes"

const ICON = <Database className="h-4 w-4" />

/**
 * Save to Collection — one record per item that reaches it. Inputs: `in` (the
 * item: a JSON object fills the title, text and link by itself; plain text is
 * the record's text), `image` and `video` (saved as links beside the record).
 * Output: `json`, the record saved. Free. A record whose duplicate key is
 * already in the collection is not saved twice (the card says so).
 */
function CollectionWriteNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as CollectionWriteData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const record = nodeData.generatedJson && typeof nodeData.generatedJson === "object" ? nodeData.generatedJson : undefined
  // The collection's name is looked up live by its id (a template carries an
  // id that is not this person's; a rename shows at once). The stored name only
  // fills the moment before the list arrives.
  const { data: collections } = useCollections()
  const name = collections ? collections.data.find((c) => c.id === nodeData.collectionId)?.name : nodeData.collectionName

  return (
    <div className="relative max-w-[240px]">
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Database className="w-3.5 h-3.5" />}
        onSave={(newLabel) => useWorkflowStore.getState().updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={ICON}
        category="output"
        credits={0}
        selected={selected}
        minWidth={240}
        hideHeader
        topToolbarContent={<RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: "24px", left: "-29px" }, external: true },
          { id: "image", type: "target", position: Position.Left, customStyle: { top: "52px", left: "-29px" }, external: true },
          { id: "video", type: "target", position: Position.Left, customStyle: { top: "80px", left: "-29px" }, external: true },
          { id: "json", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="p-3 space-y-1.5 min-h-[92px]">
          {status === "running" ? (
            <NodeJobProgress progress={undefined} />
          ) : status === "failed" && nodeData.errorMessage ? (
            <p className="text-xs text-red-500 line-clamp-3">{nodeData.errorMessage}</p>
          ) : record ? (
            <>
              <p className="text-[10px] font-medium text-muted-foreground">
                {nodeData.lastOutcome === "duplicate"
                  ? t("node.collectionDuplicateIn", { name: name ?? "" })
                  : t("node.collectionSavedTo", { name: name ?? "" })}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap min-w-0">
                {collectionRecordHeadline(record)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {name ? t("node.collectionSavesTo", { name }) : t("node.collectionPick")}
            </p>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="collection-write" handleId="in" type="target" position={Position.Left} label="Item" color={TEXT_HANDLE_COLOR} icon={<Type />} side="left" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="collection-write" handleId="image" type="target" position={Position.Left} label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left" top="52px" />
      <HandleWithPopover nodeId={id} nodeType="collection-write" handleId="video" type="target" position={Position.Left} label="Video" color={HANDLE_COLORS.video} icon={<Film />} side="left" top="80px" />
      <HandleWithPopover nodeId={id} nodeType="collection-write" handleId="json" type="source" position={Position.Right} label="Record" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
    </div>
  )
}

export const CollectionWriteNode = memo(CollectionWriteNodeComponent)
