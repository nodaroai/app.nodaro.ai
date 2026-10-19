import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ListOrdered, Braces, Type, Film, Copy } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { UseCaseNodeShell, useUseCaseNodeRun } from "@/components/nodes/use-case-node-shell"
import { ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { copyToClipboard } from "@/lib/utils"
import type { EpisodeChaptersData } from "./types"

/**
 * Chapters (decided 2026-10-14): one recording in, its chapters out — as show
 * notes on `text` and as a list on `json`. Nothing renders and nothing is
 * reviewed. A failed run offers Continue (its finished steps kept, the next
 * single-node run continues it); a list-driven node (one run per item) has none.
 *
 * Only `ChaptersShowNotes` is Chapters' own; the frame around it (run strip,
 * running / failed / empty states, Continue) is the one every use-case node
 * shares (use-case-node-shell.tsx).
 */
function EpisodeChaptersNodeComponent({ id, type, data, selected }: NodeProps) {
  const nodeData = data as EpisodeChaptersData
  const t = useT()
  const run = useUseCaseNodeRun(id, type, nodeData)
  const text = typeof nodeData.generatedText === "string" ? nodeData.generatedText : ""
  const hasResult = run.status !== "running" && text !== ""

  return (
    <UseCaseNodeShell
      id={id}
      data={nodeData}
      run={run}
      selected={selected}
      icon={ListOrdered}
      sizing={{ minWidth: 280, minHeight: 220 }}
      bodyMinHeight={160}
      handles={[
        { id: "media", type: "target", at: "top" },
        { id: "json", type: "source", at: "top" },
        { id: "text", type: "source", at: "bottom" },
      ]}
      hasResult={hasResult}
      result={<ChaptersShowNotes text={text} />}
      // A finished run with no show notes found no chapters; otherwise the node asks for a recording.
      emptyText={t(run.status === "completed" ? "node.chaptersNone" : "node.tightenConnectRecording")}
      pips={
        <>
          {/* The input pip's label is the label tables' English key (localized by
              the pip); the outputs' come from the dictionary. */}
          <HandleWithPopover nodeId={id} nodeType="episode-chapters" handleId="media" type="target" position={Position.Left}  label="Recording"              color={HANDLE_COLORS.video}     icon={<Film />}    side="left"  top="24px"              accepts={ACCEPTS_MEDIA} />
          <HandleWithPopover nodeId={id} nodeType="episode-chapters" handleId="json"  type="source" position={Position.Right} label={t("node.chaptersList")} color={DATA_HANDLE_COLORS.json} icon={<Braces />}  side="right" top="24px" />
          <HandleWithPopover nodeId={id} nodeType="episode-chapters" handleId="text"  type="source" position={Position.Right} label={t("node.chaptersText")} color={HANDLE_COLORS.text}      icon={<Type />}    side="right" top="calc(100% - 24px)" />
        </>
      }
    />
  )
}

/** Chapters' result: the show notes, one `0:00 Title` line per chapter, with a copy button. */
function ChaptersShowNotes({ text }: { readonly text: string }) {
  const t = useT()
  return (
    <div className="relative flex-1 rounded-md bg-muted/30 p-2 overflow-auto nowheel">
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono pe-6">{text}</pre>
      <Button
        size="icon"
        variant="ghost"
        className="nodrag absolute end-1 top-1 h-6 w-6"
        aria-label={t("node.chaptersCopy")}
        title={t("node.chaptersCopy")}
        onClick={(e) => {
          e.stopPropagation()
          copyToClipboard(text, t("node.textCopied"))
        }}
      >
        <Copy className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}

export const NodeComponent = memo(EpisodeChaptersNodeComponent)
