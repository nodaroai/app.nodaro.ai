"use client"

import { memo, useMemo, type CSSProperties } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Trophy, FileText, Braces } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import { REDUCE_STRATEGIES, LLM_MODELS, LLM_FEATURE_DEFAULTS, getLlmModel } from "@nodaro/shared"
import { REDUCE_INPUT_KIND_OPTIONS, reduceInputKindLabel } from "@/components/editor/config-panels/reduce-strategy-forms"
import type { ReduceNodeData } from "@/types/nodes"

/**
 * Choose Best node (type id stays `reduce` — the wire/DB contract is
 * unchanged). N candidate results come in on one pip; a strategy from
 * `@nodaro/shared/reduce-strategy-registry` turns them into ONE result: the
 * AI judge picks a winner, or they are joined / counted / voted / merged.
 *
 * Body layout (design: "Choose Best Node - New Design"):
 *   head row   MODE chip (strategy) · AI Model chip · Texts/Images chip
 *              (what the judge is handed — both AI mode only)
 *              · "N arrived" count
 *   body       the mode's one headline setting (Judge by / Separator / …)
 *              read-only on the node — edited in the side panel — then the
 *              CANDIDATES grid (thumbnails for image URLs, clamped text
 *              otherwise) with the WINNER tagged once the node has run
 *   foot       OUTPUT bar — the single result (image or text) + reasoning
 * The candidates grid reads `lastInputs` (persisted by the executor on
 * completion) — display-only, nothing executes. Handles, toolbar and side
 * panel are unchanged; only the inside of the card is new.
 */
const IMAGE_URL_RE = /^https?:\/\/\S+\.(?:png|jpe?g|webp|gif|avif)(?:\?\S*)?$/i
const isImageUrl = (s: string): boolean => IMAGE_URL_RE.test(s.trim())

const chipTriggerClass =
  "nodrag nopan !h-6 !px-2 !gap-1.5 !border !border-border/70 !bg-background/60 hover:!bg-black/5 dark:hover:!bg-white/10 " +
  "rounded-md text-[11px] font-medium min-w-0 w-auto whitespace-nowrap [&_svg]:!size-3 [&_svg]:opacity-60 " +
  "[&[data-state=open]]:!border-[#ff0073]"

const kickerClass = "text-[9px] font-mono uppercase tracking-[0.12em] text-muted-foreground/70"

const clamp = (lines: number): CSSProperties => ({
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: lines,
  overflow: "hidden",
  wordBreak: "break-word",
})

/**
 * The mode's single headline setting on the card — always EDITABLE in place.
 * Each variant writes the same strategyConfig key the side panel does (`field`),
 * so the node and the panel stay in lockstep by construction.
 */
type HeadlineSetting =
  | { kind: "text"; label: string; field: string; value: string; placeholder: string; multiline: boolean }
  | { kind: "toggle"; label: string; field: string; value: boolean; onLabel: string; offLabel: string }
  | { kind: "select"; label: string; field: string; value: string; options: ReadonlyArray<{ value: string; label: string }> }

function headlineSetting(strategyId: string, cfg: Record<string, unknown>): HeadlineSetting | null {
  switch (strategyId) {
    case "pick-best-llm":
      return {
        kind: "text", label: "Judge by", field: "criteria", multiline: true,
        value: String(cfg.criteria ?? ""),
        placeholder: "Describe what a winner looks like — e.g. the most eye-catching cover, one clear focal point, readable as a thumbnail.",
      }
    case "concat":
      return {
        kind: "text", label: "Separator", field: "separator", multiline: false,
        value: String(cfg.separator ?? "\n\n"),
        placeholder: "Text placed between each candidate",
      }
    case "vote":
      return {
        kind: "toggle", label: "Case sensitivity", field: "caseSensitive",
        value: Boolean(cfg.caseSensitive),
        onLabel: "Different letter case counts as different answers",
        offLabel: "Different letter case counts as the same answer",
      }
    case "merge-json":
      return {
        kind: "select", label: "How to merge", field: "strategy",
        value: cfg.strategy === "shallow" ? "shallow" : "deep",
        options: [
          { value: "deep", label: "Deep (nested objects too)" },
          { value: "shallow", label: "Shallow (top level only)" },
        ],
      }
    default:
      return null
  }
}

const settingFieldClass =
  "nodrag nopan nowheel w-full rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[12px] leading-snug " +
  "text-foreground/85 placeholder:text-muted-foreground/50 outline-none resize-none " +
  "focus:border-[#ff0073]/60 focus:bg-background/60 transition-colors"

function ReduceNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ReduceNodeData & { __upstreamCount?: number }
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  const strategyId = nodeData.strategyId
  const strategyConfig = useMemo(
    () => (nodeData.strategyConfig ?? {}) as Record<string, unknown>,
    [nodeData.strategyConfig],
  )
  const strategy = REDUCE_STRATEGIES.find((s) => s.id === strategyId)
  const strategyLabel = strategy?.label ?? "Choose Best"
  const isAI = strategyId === "pick-best-llm"
  const inputKind = String(strategyConfig.inputKind ?? "text")

  const judgeModelId =
    typeof strategyConfig.llmModel === "string" && strategyConfig.llmModel
      ? strategyConfig.llmModel
      : LLM_FEATURE_DEFAULTS["pick-best-llm"]
  const judgeModelLabel = getLlmModel(judgeModelId)?.displayName ?? judgeModelId

  const upstreamCount = typeof nodeData.__upstreamCount === "number" ? nodeData.__upstreamCount : undefined
  const candidates = nodeData.lastInputs ?? []
  const arrived = candidates.length > 0 ? candidates.length : upstreamCount
  const hasResult = status === "completed" && typeof nodeData.result === "string"
  const result = nodeData.result ?? ""
  const selectedIndex = typeof nodeData.lastMeta?.selectedIndex === "number" ? nodeData.lastMeta.selectedIndex : undefined
  const reasoning = nodeData.lastMeta?.reasoning
  const setting = useMemo(() => headlineSetting(strategyId, strategyConfig), [strategyId, strategyConfig])

  const setStrategy = (nextId: string) => {
    const next = REDUCE_STRATEGIES.find((s) => s.id === nextId)
    // Snap config to the new strategy's defaults — same rule as the panel.
    updateNodeData(id, {
      strategyId: nextId,
      strategyConfig: (next?.defaultConfig as Record<string, unknown>) ?? {},
    })
  }
  const setJudgeModel = (llmModel: string) => {
    updateNodeData(id, { strategyConfig: { ...strategyConfig, llmModel } })
  }
  const setSettingField = (field: string, value: string | boolean) => {
    updateNodeData(id, { strategyConfig: { ...strategyConfig, [field]: value } })
  }

  // The kind is now its own chip (AI mode) — the count no longer repeats it.
  const countLabel = arrived
    ? isAI ? `${arrived} arrived` : `${arrived} arrived · ${reduceInputKindLabel(inputKind)}`
    : null
  const chosenLabel =
    selectedIndex !== undefined && arrived ? `Chose #${selectedIndex + 1} of ${arrived}` : null

  return (
    <div className="relative" style={{ maxWidth: "460px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Trophy className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Trophy className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={460}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runFromHere?.(nid)} runFromHere />
        }
        handles={[
          { id: "in",  type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "out", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        <div className="flex flex-col">
          {/* ── Head row: MODE · AI Model · count ─────────────────────── */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20 flex-wrap">
            <span className={kickerClass}>Mode</span>
            <Select value={strategyId} onValueChange={setStrategy}>
              <SelectTrigger className={chipTriggerClass} aria-label="What to do with the candidates" title="What to do with the candidates">
                <SelectValue>{strategyLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent className="node-menu-surface">
                {REDUCE_STRATEGIES.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    <span className="flex flex-col gap-0.5">
                      <span>{s.label}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground/70">{s.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isAI && (
              <Select value={judgeModelId} onValueChange={setJudgeModel}>
                <SelectTrigger className={chipTriggerClass} aria-label="AI Model" title="AI Model">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#5878c8] shrink-0" />
                  <SelectValue>{judgeModelLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent className="node-menu-surface">
                  {LLM_MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">
                      <span className="flex flex-col gap-0.5">
                        <span>{m.displayName}</span>
                        <span className="text-[10px] leading-tight text-muted-foreground/70">{m.desc}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isAI && (
              // What the judge is handed. Lived only in the side panel, so a
              // node fed two images stayed on the default "Texts" and the AI
              // compared their links — a pick that looked real and wasn't.
              // Same list as the panel (REDUCE_INPUT_KIND_OPTIONS).
              <Select value={inputKind} onValueChange={(v) => setSettingField("inputKind", v)}>
                <SelectTrigger className={chipTriggerClass} aria-label="The candidates are" title="The candidates are">
                  <SelectValue>{reduceInputKindLabel(inputKind)}</SelectValue>
                </SelectTrigger>
                <SelectContent className="node-menu-surface">
                  {REDUCE_INPUT_KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      <span className="flex flex-col gap-0.5">
                        <span>{o.label}</span>
                        <span className="text-[10px] leading-tight text-muted-foreground/70">{o.description}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <span className="flex-1" />
            {countLabel && <span className="text-[10px] font-mono text-muted-foreground">{countLabel}</span>}
          </div>

          <div className="px-3 py-3 flex flex-col gap-3">
            {/* ── The mode's headline setting — always editable in place ── */}
            {setting && (
              <div className="flex flex-col gap-1.5">
                <span className={kickerClass}>{setting.label}</span>
                {setting.kind === "text" && setting.multiline && (
                  <textarea
                    className={settingFieldClass}
                    rows={2}
                    value={setting.value}
                    placeholder={setting.placeholder}
                    aria-label={setting.label}
                    onChange={(e) => { e.stopPropagation(); setSettingField(setting.field, e.target.value) }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                )}
                {setting.kind === "text" && !setting.multiline && (
                  <input
                    className={settingFieldClass}
                    value={setting.value}
                    placeholder={setting.placeholder}
                    aria-label={setting.label}
                    onChange={(e) => { e.stopPropagation(); setSettingField(setting.field, e.target.value) }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                )}
                {setting.kind === "toggle" && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={setting.value}
                    aria-label={setting.label}
                    className={settingFieldClass + " nodrag flex items-center gap-2.5 text-left cursor-pointer"}
                    onClick={(e) => { e.stopPropagation(); setSettingField(setting.field, !setting.value) }}
                  >
                    <span
                      className={
                        "relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors " +
                        (setting.value ? "bg-[#ff0073]" : "bg-muted-foreground/30")
                      }
                    >
                      <span
                        className={
                          "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform " +
                          (setting.value ? "translate-x-3.5" : "translate-x-0.5")
                        }
                      />
                    </span>
                    <span>{setting.value ? setting.onLabel : setting.offLabel}</span>
                  </button>
                )}
                {setting.kind === "select" && (
                  <Select value={setting.value} onValueChange={(v) => setSettingField(setting.field, v)}>
                    <SelectTrigger className={settingFieldClass + " nodrag !h-auto justify-between"} aria-label={setting.label}>
                      <SelectValue>{setting.options.find((o) => o.value === setting.value)?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="node-menu-surface">
                      {setting.options.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {/* ── Candidates grid ───────────────────────────────────────── */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className={kickerClass}>Candidates</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {candidates.length === 0
                    ? (upstreamCount ? "run to see them" : "connect candidates")
                    : isAI ? "winner marked below" : strategyLabel.toLowerCase()}
                </span>
              </div>
              {candidates.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-14 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 gap-1">
                  <FileText className="w-4 h-4" />
                  <span className="text-[10px]">{strategyLabel}</span>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {candidates.map((c, i) => {
                    const win = selectedIndex === i
                    return (
                      <div
                        key={i}
                        data-winner={win ? "" : undefined}
                        className={
                          "flex flex-col gap-1.5 p-2 rounded-lg border min-h-[82px] transition-colors " +
                          (win ? "border-[#ff0073]/60 bg-[#ff0073]/5" : "border-border/60 bg-muted/30")
                        }
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] font-mono text-muted-foreground/70">#{i + 1}</span>
                          {win && (
                            <span className="text-[8px] font-mono tracking-[0.1em] px-1.5 py-0.5 rounded bg-[#ff0073]/15 text-[#ff0073]">
                              WINNER
                            </span>
                          )}
                        </div>
                        {isImageUrl(c) ? (
                          <CachedImage src={c} alt="" className="w-full aspect-square object-cover rounded-md" />
                        ) : (
                          <p className="text-[11px] leading-snug text-foreground/80" style={clamp(4)}>{c}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── OUTPUT bar ─────────────────────────────────────────────── */}
          <div className="flex items-start gap-3 px-3 py-2.5 border-t border-border/50 bg-muted/20">
            <span className={kickerClass + " pt-0.5"}>Output</span>
            {hasResult ? (
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                {isImageUrl(result) ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <CachedImage src={result} alt="" className="w-10 h-10 object-cover rounded-md shrink-0" />
                    <span className="text-[12px] text-foreground truncate">{chosenLabel ?? "The winning image"}</span>
                  </div>
                ) : (
                  <span className="text-[12px] text-foreground" style={clamp(2)}>
                    {chosenLabel ? `${chosenLabel} · ` : ""}{result}
                  </span>
                )}
                {reasoning && (
                  <p className="text-[10px] italic text-muted-foreground/80 border-l-2 border-muted-foreground/30 pl-1.5" style={clamp(2)}>
                    {reasoning}
                  </p>
                )}
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground/60">
                {status === "running" ? "Choosing…" : "Run to see the result"}
              </span>
            )}
          </div>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="reduce" handleId="in"  type="target" position={Position.Left}  label="Candidates" color={HANDLE_COLORS.look} icon={<Braces />}   side="left"  top="calc(100% - 24px)" />
      <HandleWithPopover nodeId={id} nodeType="reduce" handleId="out" type="source" position={Position.Right} label="Result"     color={HANDLE_COLORS.control} icon={<FileText />} side="right" top="24px" />
    </div>
  )
}

export const ReduceNode = memo(ReduceNodeComponent)
