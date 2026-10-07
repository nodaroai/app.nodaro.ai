"use client"

import { memo, useMemo, useState } from "react"
import { useT } from "@/lib/i18n"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, Database, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { RunNodeButton } from "./run-node-button"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useCollections } from "@/hooks/queries/use-collections-queries"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import type { CollectionReadData } from "@/types/nodes"
import { collectionReadRecords, deriveCollectionReadCardState } from "./collection-read-run-state"
import { PostFeedBody, PostFeedDialog } from "./post-feed/post-feed-card"
import { FeedDot, FeedHeaderRow, FeedPlaceholder, FeedRunningSkeleton } from "./post-feed/feed-card-chrome"
import { collectionRecordFeedPost } from "./post-feed/collection-record-feed-post"

const WIDTH = 440
const ICON = <Database className="h-4 w-4" />

// `text` sits first: an edge with no source handle is drawn from the first
// pip, and both engines read such an edge as the text output.
const HANDLES = [
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
] as const

/**
 * Read Collection — what a collection holds from the last N hours or days.
 * Two output pips: `json` (the records) and `text` (their digest, for a
 * prompt). Free. The card is the shared post feed card (`post-feed/`): the
 * first record featured (picture, title, text, the post's date, "Open in
 * <site>" for its link), arrows and thumbnails over the rest, and "View all"
 * listing every record. An empty window reads as "no records", and the nodes
 * behind it that needed the text are skipped (the run ends "nothing new").
 */
function CollectionReadNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as CollectionReadData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const state = deriveCollectionReadCardState(nodeData)
  const running = state.kind === "running"
  const posts = useMemo(() => collectionReadRecords(nodeData.generatedJson).map((r) => collectionRecordFeedPost(r, t)), [nodeData.generatedJson, t])
  const [allOpen, setAllOpen] = useState(false)
  // The collection's name is looked up live by its id (a template carries an
  // id that is not the reader's; a rename shows at once). The stored name only
  // fills the moment before the list arrives.
  const { data: collections } = useCollections()
  const name = (collections ? collections.data.find((c) => c.id === nodeData.collectionId)?.name : nodeData.collectionName) ?? ""
  const countLabel = (n: number) => (n === 1 ? t("node.collectionRecordsOne") : t("node.collectionRecords", { n }))

  const statusRight =
    state.kind === "never-ran" ? (
      <><FeedDot color="var(--meta-ads-dot-idle)" />{t("node.notRunYet")}</>
    ) : running ? (
      <><FeedDot color="var(--meta-ads-info)" />{t("node.collectionReading")}</>
    ) : state.kind === "failed" ? (
      <><FeedDot color="#ef4444" /><span className="text-red-500">{t("node.failed")}</span></>
    ) : state.kind === "empty" ? (
      <><FeedDot color="var(--meta-ads-dot-idle)" />{countLabel(0)}</>
    ) : (
      <><FeedDot color="var(--meta-ads-success)" glow />{countLabel(state.count)}</>
    )

  return (
    <div className="relative" style={{ maxWidth: WIDTH }}>
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
        isRunning={running}
        minWidth={WIDTH}
        fitContent
        hideHeader
        className={state.kind === "never-ran" ? "border-dashed" : undefined}
        topToolbarContent={<RunNodeButton nodeId={id} credits={0} isRunning={running} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={HANDLES}
      >
        <div className="flex flex-col gap-3 px-[18px] pb-4 pt-4">
          <FeedHeaderRow label={t("node.collectionHeader")} badge={name} right={statusRight} />

          {state.kind === "never-ran" && (
            <FeedPlaceholder icon={<Database />}>{name ? t("node.collectionReadsFrom", { name }) : t("node.collectionPick")}</FeedPlaceholder>
          )}
          {running && (
            <>
              <NodeJobProgress progress={nodeData.currentJobProgress} />
              <FeedRunningSkeleton />
            </>
          )}

          {state.kind === "success" && <PostFeedBody posts={posts} onViewAll={() => setAllOpen(true)} />}

          {state.kind === "empty" && <FeedPlaceholder icon={<Database />}>{t("node.collectionNoRecords")}</FeedPlaceholder>}

          {state.kind === "failed" && (
            <p className="text-[12px] leading-snug text-red-500">{state.errorMessage || t("node.failed")}</p>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="collection-read" handleId="text" type="source" position={Position.Right} label="Records" color={TEXT_HANDLE_COLOR} icon={<Type />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="collection-read" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="52px" />
      <PostFeedDialog
        open={allOpen}
        onClose={() => setAllOpen(false)}
        title={name ? t("node.collectionAllRecords", { name }) : t("node.collectionHeader")}
        icon={<Database />}
        meta={countLabel(posts.length)}
        copyValue={nodeData.generatedJson}
        posts={posts}
      />
    </div>
  )
}

export const CollectionReadNode = memo(CollectionReadNodeComponent)
