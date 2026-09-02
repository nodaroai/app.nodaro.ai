"use client"

import { useT } from "@/lib/i18n"
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { PromptEditor } from "@/lib/picker-ui"
import { usePromptEditorRefs } from "@/components/nodes/inline-node-prompt/use-prompt-editor-refs"
import { nodeSupportsPromptAffixes } from "@/lib/prompt-fields"
import { PROMPT_PREFIX_KEY, PROMPT_SUFFIX_KEY } from "@nodaro/shared"

/**
 * "Pre & post text" config section — optional text wrapped BEFORE / AFTER the
 * node's prompt at run time (`promptPrefix` / `promptSuffix`, spec: prompt
 * pre & post text). Settings-only: never rendered on the node face, in the
 * inline prompt or the ⌘E modal. Collapsed by default; a badge keeps a hidden
 * affix visible. Both fields are the same PromptEditor as the main prompt
 * (@ references, { variables, / snippets) sharing the node's ref/snippet pool.
 * Renders nothing unless the node type supports affixes, so it is safe to mount
 * unconditionally (mirrors PromptInjectionSection).
 */
export function PromptAffixSection({
  nodeType,
  nodeData,
  selectedNodeId,
  updateNodeData,
}: {
  nodeType: string
  nodeData: Record<string, unknown>
  selectedNodeId: string | undefined
  updateNodeData: (id: string, data: Record<string, unknown>) => void
}) {
  if (!selectedNodeId || !nodeSupportsPromptAffixes(nodeType)) return null
  return <PromptAffixSectionInner nodeId={selectedNodeId} nodeData={nodeData} updateNodeData={updateNodeData} />
}

function readText(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return typeof v === "string" ? v : ""
}

function PromptAffixSectionInner({
  nodeId,
  nodeData,
  updateNodeData,
}: {
  nodeId: string
  nodeData: Record<string, unknown>
  updateNodeData: (id: string, data: Record<string, unknown>) => void
}) {
  const t = useT()
  const prefix = readText(nodeData, PROMPT_PREFIX_KEY)
  const suffix = readText(nodeData, PROMPT_SUFFIX_KEY)
  const setCount = (prefix.trim() ? 1 : 0) + (suffix.trim() ? 1 : 0)
  const [expanded, setExpanded] = useState(false)
  const { referenceImages, nodeRefs, refMap, promptSnippets } = usePromptEditorRefs(nodeId)

  const editorProps = { rows: 2, maxRows: 6, referenceImages, nodeRefs, refMap, snippets: promptSnippets }

  return (
    <>
      <Separator />
      <div className="space-y-2">
        <button
          type="button"
          data-testid="prompt-affix-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-1.5 text-start"
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] cursor-pointer">
            {t("cfgshared.promptAffixTitle")}
          </Label>
          {setCount > 0 && (
            <span
              data-testid="prompt-affix-badge"
              className="ms-auto rounded-full bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300"
            >
              {t("cfgshared.promptAffixSetCount", { count: setCount })}
            </span>
          )}
        </button>
        {expanded && (
          <div className="space-y-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("cfgshared.promptAffixBefore")}</Label>
              <PromptEditor
                value={prefix}
                onChange={(v) => updateNodeData(nodeId, { [PROMPT_PREFIX_KEY]: v })}
                placeholder={t("cfgshared.promptAffixBeforePh")}
                {...editorProps}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("cfgshared.promptAffixAfter")}</Label>
              <PromptEditor
                value={suffix}
                onChange={(v) => updateNodeData(nodeId, { [PROMPT_SUFFIX_KEY]: v })}
                placeholder={t("cfgshared.promptAffixAfterPh")}
                {...editorProps}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t("cfgshared.promptAffixHint")}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
