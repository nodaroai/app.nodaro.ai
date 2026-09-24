"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Webhook, Type } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useHttpCredentials } from "@/hooks/use-http-credentials"
import { useT } from "@/lib/i18n"
import type { WebhookOutputData, WebhookParam } from "@/types/nodes"

const SOURCE_HANDLE = { id: "out", type: "source" as const, position: Position.Right, customStyle: { top: '24px', right: '-29px' }, external: true }

/** One letter per parameter type, matching the config panel's rows. */
const PARAM_TYPE_MARK: Record<WebhookParam["type"], string> = {
  text: "T",
  imageUrl: "I",
  videoUrl: "V",
  audioUrl: "A",
}

/**
 * Param pips stack at FIXED pixel offsets from the top of the card.
 *
 * They used to be percentages (42%–88% of the card's height), which held only
 * while the body was two short lines. This card now carries a destination row,
 * a credential chip whose presence varies, param chips that wrap, and a status
 * line — every one of which moves a percentage-positioned pip, and the last of
 * them would have landed on the footer. Pixels from the top do not care what
 * the body is doing.
 *
 * Spacing stays under BaseNode's own 30px-per-handle minimum height, so the
 * stack can never outgrow the card it is pinned to.
 */
const PARAM_TOP_PX = 30
const PARAM_SPACING_PX = 26

function paramTop(index: number): string {
  return `${PARAM_TOP_PX + index * PARAM_SPACING_PX}px`
}

function buildHandles(params: ReadonlyArray<WebhookParam>) {
  if (params.length === 0) {
    return [
      { id: "in", type: "target" as const, position: Position.Left, customStyle: { top: paramTop(0), left: '-29px' }, external: true },
      SOURCE_HANDLE,
    ]
  }

  const targetHandles = params.map((p, i) => ({
    id: p.id,
    type: "target" as const,
    position: Position.Left,
    label: p.name,
    customStyle: { top: paramTop(i), left: '-29px' },
    external: true as const,
  }))
  return [...targetHandles, SOURCE_HANDLE]
}

function WebhookOutputNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as WebhookOutputData
  const updateNodeInternals = useUpdateNodeInternals()
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"

  const params = nodeData.params ?? []
  const handles = useMemo(() => buildHandles(params), [params])

  // One shared React Query entry — a workflow with several webhook nodes reads
  // the list once, and the chip below names the key instead of showing its id.
  const { credentials } = useHttpCredentials()
  const credential = credentials.find((c) => c.id === nodeData.credentialId)

  const statusCode = typeof nodeData.webhookStatusCode === "number" ? nodeData.webhookStatusCode : null

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, params.length, updateNodeInternals])

  return (
    <div className="relative" style={{ maxWidth: '380px' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Webhook className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Webhook className="h-4 w-4" />}
        category="output"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={380}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={handles}
      >
        {/* Body only. The title is EditableNodeLabel, the preset chip is
            BaseNode's own, and the run button is the shared strip — the
            handoff draws all three inside the card, which would give this node
            two of each. */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5">
            <span className="shrink-0 text-[9.5px] font-bold tracking-[0.06em] text-emerald-700 dark:text-emerald-400">
              POST
            </span>
            <span className="truncate font-mono text-[11.5px]" title={nodeData.url || undefined}>
              {nodeData.url || t("node.setWebhookUrl")}
            </span>
          </div>

          {credential && (
            <div className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1.5">
              <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span className="truncate text-[11px] font-semibold text-primary">
                {credential.name} · {credential.headerName}
              </span>
            </div>
          )}

          {params.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {params.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px]"
                  title={p.type}
                >
                  {p.name || "…"}
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{PARAM_TYPE_MARK[p.type]}</span>
                </span>
              ))}
            </div>
          )}

          {statusCode !== null && (
            <span className="text-[10px] text-muted-foreground">
              {t("utilcfg.webhookLastRun")}{" "}
              <span
                className={`font-mono font-bold ${
                  nodeData.webhookSuccess === false ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {statusCode}
              </span>
            </span>
          )}
        </div>
      </BaseNode>
      {handles.filter(h => h.type === "target").map((h, i) => (
        <HandleWithPopover key={h.id} nodeId={id} nodeType="webhook-output" handleId={h.id} type="target" position={Position.Left} label={(h as { label?: string }).label ?? h.id} color={HANDLE_COLORS.approve} icon={<Type />} side="left" top={(h.customStyle?.top as string) ?? paramTop(i)} alwaysShowLabel />
      ))}
      <HandleWithPopover nodeId={id} nodeType="webhook-output" handleId="out" type="source" position={Position.Right} label="Response" color={HANDLE_COLORS.approve} icon={<Webhook />} side="right" top="24px" />
    </div>
  )
}

export const WebhookOutputNode = memo(WebhookOutputNodeComponent)
