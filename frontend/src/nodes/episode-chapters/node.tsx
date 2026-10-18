import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ListOrdered, Braces, Type, Film, Loader2, AlertCircle, RotateCcw, Copy } from "lucide-react"
import { BaseNode } from "@/components/nodes/base-node"
import { NodeJobProgress } from "@/components/nodes/node-job-progress"
import { RunNodeButton } from "@/components/nodes/run-node-button"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { useUseCaseContinue, useUseCaseListDriven } from "@/components/nodes/use-case-node-hooks"
import { ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useUseCaseCredits } from "@/hooks/use-use-case-credits"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { copyToClipboard, cn } from "@/lib/utils"
import { executionErrorText, nodeErrorCodeText } from "@/lib/execution-error-text"
import type { EpisodeChaptersData } from "./types"

/**
 * Chapters (decided 2026-10-14): one recording in, its chapters out — as show
 * notes on `text` and as a list on `json`. Nothing renders and nothing is
 * reviewed. A failed run offers Continue (its finished steps kept, the next
 * single-node run continues it); a list-driven node (one run per item) has none.
 *
 * Only `ChaptersShowNotes` is Chapters' own; the frame around it (run strip,
 * running / failed / empty states, Continue) is the shape every use-case node
 * shares.
 */
function EpisodeChaptersNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as EpisodeChaptersData
  const t = useT()
  const credits = useUseCaseCredits(id)
  // The workflow store's services, bound to this node (the unit kit — a unit never imports the store).
  const kit = useUnitNodeKit(id)
  const continueUseCase = useUseCaseContinue(id)
  const status = nodeData.executionStatus ?? "idle"
  const text = typeof nodeData.generatedText === "string" ? nodeData.generatedText : ""
  const hasResult = status !== "running" && text !== ""
  // A list-driven node runs once per item: no one run for Continue to name.
  const listDriven = useUseCaseListDriven(id)
  const errorCode = (nodeData as { errorCode?: unknown }).errorCode
  const coded = typeof errorCode === "string" ? (nodeErrorCodeText(errorCode, "episode-chapters") ?? executionErrorText(errorCode)) : null
  const shownError = coded && coded !== errorCode ? coded : nodeData.errorMessage
  const jobId = nodeData.useCaseJobId
  const canContinue = !!jobId && !listDriven

  // The continuation is this click's run option, never node data: a click that
  // never starts leaves nothing behind, and the next Run is a fresh run.
  const continueRun = () => {
    if (!jobId) return
    continueUseCase(jobId)
  }

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<ListOrdered className="w-3.5 h-3.5" />} onSave={(newLabel) => kit.updateNodeData({ label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ListOrdered className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={280}
        minHeight={220}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={() => kit.run()} />}
        handles={[
          { id: "media", type: "target", position: Position.Left,  customStyle: { top: "24px",              left: "-29px" },  external: true },
          { id: "json",  type: "source", position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
          { id: "text",  type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
        ]}
      >
        <div className="relative flex flex-col gap-1 p-2 h-full" style={{ minHeight: 160 }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {hasResult && <ChaptersShowNotes text={text} />}

          {/* Under an earlier result it is a compact strip; alone it fills the card. */}
          {status === "failed" && (
            <div className={cn("flex flex-col items-center justify-center gap-1 rounded-md bg-red-500/5 text-red-500 p-2", !hasResult && "flex-1")}>
              <div className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /><span className="font-medium">{t("node.failed")}</span></div>
              {shownError && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={shownError}>{shownError}</p>
              )}
              {canContinue && (
                <Button size="sm" variant="secondary" className="nodrag" onClick={continueRun} title={t("node.tightenContinueHint")}>
                  <RotateCcw className="w-3.5 h-3.5 me-1" />{t("node.tightenContinue")}
                </Button>
              )}
            </div>
          )}

          {status !== "running" && !hasResult && status !== "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 flex-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <ListOrdered className="w-5 h-5" />
              {/* A finished run with no show notes found no chapters; otherwise the node asks for a recording. */}
              <span className="text-[10px] text-center px-2">{t(status === "completed" ? "node.chaptersNone" : "node.tightenConnectRecording")}</span>
            </div>
          )}
        </div>
      </BaseNode>

      {/* The input pip's label is the label tables' English key (localized by
          the pip); the outputs' come from the dictionary. */}
      <HandleWithPopover nodeId={id} nodeType="episode-chapters" handleId="media" type="target" position={Position.Left}  label="Recording"              color={HANDLE_COLORS.video}     icon={<Film />}    side="left"  top="24px"              accepts={ACCEPTS_MEDIA} />
      <HandleWithPopover nodeId={id} nodeType="episode-chapters" handleId="json"  type="source" position={Position.Right} label={t("node.chaptersList")} color={DATA_HANDLE_COLORS.json} icon={<Braces />}  side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="episode-chapters" handleId="text"  type="source" position={Position.Right} label={t("node.chaptersText")} color={HANDLE_COLORS.text}      icon={<Type />}    side="right" top="calc(100% - 24px)" />
    </div>
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
