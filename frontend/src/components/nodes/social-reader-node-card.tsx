"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useT } from "@/lib/i18n"
import { Position } from "@xyflow/react"
import { socialPostsFrom } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { RunNodeButton } from "./run-node-button"
import { NodeJobProgress } from "./node-job-progress"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { PostFeedBody, PostFeedDialog } from "./post-feed/post-feed-card"
import { FeedDot, FeedHeaderRow, FeedPlaceholder, FeedRunningSkeleton } from "./post-feed/feed-card-chrome"
import { socialPostFeedPost, type ReaderPost } from "./post-feed/social-post-feed-post"

const WIDTH = 440

// `text` sits first: an edge with no source handle is drawn from the first
// pip, and both engines read such an edge as the text output.
const HANDLES = [
  { id: "text", type: "source" as const, position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
  { id: "json", type: "source" as const, position: Position.Right, customStyle: { top: "52px", right: "-29px" }, external: true },
] as const

/** What the card of a post reader shows, read off the node's data. */
export type SocialReaderCardState =
  | { readonly kind: "never-ran" }
  | { readonly kind: "running" }
  | { readonly kind: "failed"; readonly errorMessage: string }
  | { readonly kind: "empty" }
  | { readonly kind: "success"; readonly count: number }

interface ReaderRunData {
  readonly executionStatus?: string
  readonly errorMessage?: string
  readonly generatedJson?: unknown
  readonly generatedText?: unknown
}

export function deriveSocialReaderCardState(d: ReaderRunData): SocialReaderCardState {
  if (d.executionStatus === "running") return { kind: "running" }
  if (d.executionStatus === "failed") return { kind: "failed", errorMessage: typeof d.errorMessage === "string" ? d.errorMessage : "" }
  if (d.generatedJson === undefined && d.generatedText === undefined) return { kind: "never-ran" }
  const count = socialPostsFrom(d.generatedJson).length
  return count > 0 ? { kind: "success", count } : { kind: "empty" }
}

/**
 * The card both post readers draw (Read Inspiration, Read Competitor): the
 * shared post feed card over the posts of the last run, with the reader's own
 * header, badge, idle words and inspector title. Two output pips: `text` (the
 * digest) and `json` (the posts, the Social Search shape), drawn by the node
 * itself (`pips`) so the handle guard reads each pip where it is declared. Free.
 */
export function SocialReaderNodeCard({ id, data, selected, icon, smallIcon, header, badge, badgeDir, idleText, dialogTitle, pips }: {
  readonly id: string
  readonly data: ReaderRunData & { readonly label: string; readonly currentJobProgress?: number }
  readonly selected?: boolean
  readonly icon: ReactNode
  readonly smallIcon: ReactNode
  readonly header: string
  readonly badge?: string
  readonly badgeDir?: "ltr" | "auto"
  readonly idleText: string
  readonly dialogTitle: string
  /** The two output pips (`text` at 24px, `json` at 52px), declared in the node's own file. */
  readonly pips: ReactNode
}) {
  const t = useT()
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const state = deriveSocialReaderCardState(data)
  const running = state.kind === "running"
  const posts = useMemo(() => (socialPostsFrom(data.generatedJson) as ReaderPost[]).map((p) => socialPostFeedPost(p, t)), [data.generatedJson, t])
  const [allOpen, setAllOpen] = useState(false)
  const countLabel = (n: number) => (n === 1 ? t("tgfeed.postCountOne") : t("tgfeed.postCount", { n }))

  const statusRight =
    state.kind === "never-ran" ? (
      <><FeedDot color="var(--meta-ads-dot-idle)" />{t("node.notRunYet")}</>
    ) : running ? (
      <><FeedDot color="var(--meta-ads-info)" />{t("node.readerReading")}</>
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
        label={data.label}
        icon={smallIcon}
        onSave={(newLabel) => useWorkflowStore.getState().updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={data.label}
        icon={icon}
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
          <FeedHeaderRow label={header} badge={badge} badgeDir={badgeDir} right={statusRight} />

          {state.kind === "never-ran" && <FeedPlaceholder icon={smallIcon}>{idleText}</FeedPlaceholder>}
          {running && (
            <>
              <NodeJobProgress progress={data.currentJobProgress} />
              <FeedRunningSkeleton />
            </>
          )}

          {state.kind === "success" && <PostFeedBody posts={posts} onViewAll={() => setAllOpen(true)} />}

          {state.kind === "empty" && <FeedPlaceholder icon={smallIcon}>{t("node.readerNoPosts")}</FeedPlaceholder>}

          {state.kind === "failed" && (
            <p className="text-[12px] leading-snug text-red-500">{state.errorMessage || t("node.failed")}</p>
          )}
        </div>
      </BaseNode>
      {pips}
      <PostFeedDialog
        open={allOpen}
        onClose={() => setAllOpen(false)}
        title={dialogTitle}
        icon={smallIcon}
        meta={countLabel(posts.length)}
        copyValue={data.generatedJson}
        posts={posts}
      />
    </div>
  )
}
