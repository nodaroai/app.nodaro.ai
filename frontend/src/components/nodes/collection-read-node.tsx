"use client"

import { memo } from "react"
import { useT } from "@/lib/i18n"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, Database, Type } from "lucide-react"
import { collectionRecordHeadline } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useCollections } from "@/hooks/queries/use-collections-queries"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import type { CollectionReadData } from "@/types/nodes"

const ICON = <Database className="h-4 w-4" />

/**
 * Read Collection — what a collection holds from the last N hours or days.
 * Two output pips: `json` (the records) and `text` (their digest, for a
 * prompt). Free. The card shows how many records the last run read and the
 * newest one's headline; an empty window reads as "no records", and the nodes
 * behind it that needed the text are skipped (the run ends "nothing new").
 */
function CollectionReadNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as CollectionReadData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const records = Array.isArray(nodeData.generatedJson) ? nodeData.generatedJson : []
  const newest = records[0]
  // The collection's name is looked up live by its id (a template carries an
  // id that is not the reader's; a rename shows at once). The stored name only
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
        category="input"
        credits={0}
        selected={selected}
        minWidth={240}
        hideHeader
        topToolbarContent={<RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={[
          // `text` sits first: an edge with no source handle is drawn from the
          // first pip, and both engines read such an edge as the text output.
          { id: "text", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
          { id: "json", type: "source", position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
        ]}
      >
        <div className="p-3 space-y-1.5">
          {status === "running" ? (
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          ) : status === "failed" && nodeData.errorMessage ? (
            <p className="text-xs text-red-500 line-clamp-3">{nodeData.errorMessage}</p>
          ) : status === "completed" && records.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("node.collectionNoRecords")}</p>
          ) : newest ? (
            <>
              <p className="text-[10px] font-medium text-muted-foreground">
                {records.length === 1 ? t("node.collectionRecordsOne") : t("node.collectionRecords", { n: records.length })}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap min-w-0">
                {collectionRecordHeadline(newest)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {name ? t("node.collectionReadsFrom", { name }) : t("node.collectionPick")}
            </p>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="collection-read" handleId="text" type="source" position={Position.Right} label="Records" color={TEXT_HANDLE_COLOR} icon={<Type />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="collection-read" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="52px" />
    </div>
  )
}

export const CollectionReadNode = memo(CollectionReadNodeComponent)
