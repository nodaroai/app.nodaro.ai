"use client"

import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { useT, tx } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus, Trash2, FileText, ImageIcon, Film, Music, GripVertical, Eye, EyeOff, ChevronUp, ChevronDown, Copy, Check, Download, X } from "lucide-react"
import { nanoid } from "nanoid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  isTeleportDefaultLabel,
  TELEPORTER_PAN_EVENT,
  type CombineTextNodeData,
  type SaveToStorageData,
  type WebhookOutputData,
  type WebhookParam,
  type SplitTextData,
  type ExtractFieldNodeData,
  type WebScrapeNodeData,
  type PreviewNodeData,
  type PreviewItem,
  type TeleportSendData,
  type TeleportReceiveData,
  type JsonProcessNodeData,
  type FilterListNodeData,
  type FilterListCondition,
  type FilterListOperator,
  type RouterNodeData,
  type RouterConditionGroup,
  type DeduplicateNodeData,
  type MergeListsNodeData,
  type SortListNodeData,
  type WorkflowNode,
  type WorkflowEdge,
} from "@/types/nodes"
import { isMediaUrl } from "@/lib/media-type"
import { optimizedImageUrl } from "@/lib/image"
import { AndOrToggle, ConditionRowEditor } from "./condition-row-editor"
import { getPreviewItemKey } from "@/lib/preview-items"
import { downloadFile } from "@/components/presentation/output-cards/shared"
import { SCRAPER_OUTPUT_FIELDS, buildExpressionFromVisual, type FilterOperator } from "@nodaro/shared"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { ConfigProps, SourceNodeInfo } from "./types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { WaveformAudioPlayer } from "@/components/audio-player"

function SEPARATOR_OPTIONS() {
  return [
  { value: "newline", label: tx("utilcfg.sepNewline") },
  { value: "double-newline", label: tx("utilcfg.sepDoubleNewline") },
  { value: "comma", label: tx("utilcfg.sepComma") },
  { value: "space", label: tx("utilcfg.sepSpace") },
  { value: "stars", label: tx("utilcfg.sepThreeStars") },
  { value: "custom", label: tx("cfgshared.custom") },
] as const
}

const SEPARATOR_PRESET_VALUES: readonly string[] = SEPARATOR_OPTIONS().map((o) => o.value)

export function CombineTextConfig({ data, onUpdate }: { data: CombineTextNodeData; onUpdate: (patch: Partial<CombineTextNodeData>) => void }) {
  const localizeOption = useLocalizeOptionLabel()
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("utilcfg.separator")}</Label>
        <Select value={data.separator} onValueChange={(v) => onUpdate({ separator: v as CombineTextNodeData["separator"] })}>
          <SelectTrigger aria-label={t("utilcfg.separator")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEPARATOR_OPTIONS().map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{localizeOption(opt.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data.separator === "custom" && (
        <div>
          <Label>{t("utilcfg.customSeparator")}</Label>
          <Input value={data.customSeparator} onChange={(e) => onUpdate({ customSeparator: e.target.value })} placeholder={t("utilcfg.phEnterSeparator")} />
        </div>
      )}

      {data.combinedText && (
        <div>
          <Label>{t("utilcfg.outputPreview")}</Label>
          <Textarea rows={4} value={data.combinedText} readOnly className="text-xs opacity-70" />
        </div>
      )}
    </div>
  )
}

export function SaveToStorageConfig({ data, onUpdate }: ConfigProps<SaveToStorageData>) {
  const t = useT()
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="filename">{t("utilcfg.filename")}</Label>
        <Input id="filename" value={data.filename} onChange={(e) => onUpdate({ filename: e.target.value })} placeholder="output_video" />
      </div>
      <div>
        <Label>{t("utilcfg.format")}</Label>
        <Select value={data.format} onValueChange={(v) => onUpdate({ format: v as SaveToStorageData["format"] })}>
          <SelectTrigger aria-label={t("utilcfg.format")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp4">MP4</SelectItem>
            <SelectItem value="webm">WebM</SelectItem>
            <SelectItem value="mov">MOV</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("field.quality")}</Label>
        <Select value={data.quality} onValueChange={(v) => onUpdate({ quality: v as SaveToStorageData["quality"] })}>
          <SelectTrigger aria-label={t("field.quality")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">{t("utilcfg.qualityDraft")}</SelectItem>
            <SelectItem value="standard">{t("utilcfg.qualityStandard")}</SelectItem>
            <SelectItem value="high">{t("utilcfg.qualityHigh")}</SelectItem>
            <SelectItem value="4k">4K</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function WebhookOutputConfig({ data, onUpdate }: ConfigProps<WebhookOutputData>) {
  const t = useT()
  const params = data.params ?? []

  const addParam = () => {
    onUpdate({
      params: [...params, { id: nanoid(), name: "", type: "text" }],
    })
  }

  const updateParam = (index: number, patch: Partial<WebhookParam>) => {
    const updated = params.map((p, i) => (i === index ? { ...p, ...patch } : p))
    onUpdate({ params: updated })
  }

  const removeParam = (index: number) => {
    onUpdate({ params: params.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="webhook-url">{t("utilcfg.webhookUrl")}</Label>
        <Input
          id="webhook-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/webhook"
          className="text-xs font-mono"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("utilcfg.webhookUrlHint")}
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label>{t("utilcfg.inputParameters")}</Label>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addParam}>
            <Plus className="h-3 w-3" />
            {t("cfgshared.add")}
          </Button>
        </div>

        {params.length === 0 && (
          <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
            {t("utilcfg.noParamsDefined")}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {params.map((param, i) => (
            <div key={param.id} className="flex items-center gap-1.5">
              <Input
                value={param.name}
                onChange={(e) => updateParam(i, { name: e.target.value })}
                placeholder={t("utilcfg.phParamName")}
                className="text-xs h-8 flex-1"
              />
              <Select
                value={param.type}
                onValueChange={(v) => updateParam(i, { type: v as WebhookParam["type"] })}
              >
                <SelectTrigger className="h-8 w-[100px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">{t("field.text")}</SelectItem>
                  <SelectItem value="imageUrl">{t("utilcfg.imageUrl")}</SelectItem>
                  <SelectItem value="videoUrl">{t("utilcfg.videoUrl")}</SelectItem>
                  <SelectItem value="audioUrl">{t("utilcfg.audioUrl")}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeParam(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SplitTextConfig({ data, onUpdate }: { data: SplitTextData; onUpdate: (patch: Partial<SplitTextData>) => void }) {
  const localizeOption = useLocalizeOptionLabel()
  const t = useT()
  // Legacy workflows may store a literal separator string (e.g. "===NEXT===") in `separator`.
  // Surface those as "custom" in the dropdown and pre-fill the custom field.
  const isPreset = SEPARATOR_PRESET_VALUES.includes(data.separator)
  const selectValue = isPreset ? data.separator : "custom"
  const customValue = isPreset ? (data.customSeparator ?? "") : data.separator

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>{t("utilcfg.separator")}</Label>
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === "custom") {
              onUpdate({ separator: "custom", customSeparator: customValue })
            } else {
              onUpdate({ separator: v })
            }
          }}
        >
          <SelectTrigger aria-label={t("utilcfg.separator")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEPARATOR_OPTIONS().map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{localizeOption(opt.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("utilcfg.splitSeparatorHint")}
        </p>
      </div>

      {selectValue === "custom" && (
        <div>
          <Label>{t("utilcfg.customSeparator")}</Label>
          <Input
            value={customValue}
            onChange={(e) => onUpdate({ separator: "custom", customSeparator: e.target.value })}
            placeholder={t("utilcfg.phEnterSeparatorEg")}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <Label>{t("utilcfg.trimWhitespace")}</Label>
        <Button
          variant={data.trimWhitespace !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ trimWhitespace: data.trimWhitespace === false })}
        >
          {data.trimWhitespace !== false ? t("audiocfg.normalizationOn") : t("audiocfg.normalizationOff")}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <Label>{t("utilcfg.removeEmpty")}</Label>
        <Button
          variant={data.removeEmpty !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ removeEmpty: data.removeEmpty === false })}
        >
          {data.removeEmpty !== false ? t("audiocfg.normalizationOn") : t("audiocfg.normalizationOff")}
        </Button>
      </div>

      {data.splitResults && data.splitResults.length > 0 && (
        <div>
          <Label>{t("utilcfg.previewItems", { count: data.splitResults.length })}</Label>
          <Textarea
            rows={Math.min(data.splitResults.length, 6)}
            value={data.splitResults.map((item, i) => `${i + 1}. ${item}`).join("\n")}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Upstream field-schema detection (shared by ExtractFieldConfig + FilterListConfig)
// ---------------------------------------------------------------------------

/**
 * Extract top-level field keys from an upstream node's stored output.
 * Checks list-shaped outputs (__listResults / listResults / splitResults —
 * first item's keys), JSON-shaped outputs (generatedJson / processedResult —
 * object keys or first array element's keys), and stringified JSON list
 * items. Returns [] when nothing schema-like is found.
 */
function detectUpstreamFieldKeys(
  nodeData: Record<string, unknown> | null | undefined,
): readonly string[] {
  if (!nodeData) return []

  const sample = detectSampleItem(nodeData)
  if (sample === undefined) return []
  return extractPathsFromValue(sample)
}

/** Find the first upstream-data sample to derive a schema from. Mirrors the
 *  priority used by filter-list at runtime: list-shaped outputs first, then
 *  JSON-shaped. Returns the first list item when the payload is a list. */
function detectSampleItem(nodeData: Record<string, unknown>): unknown {
  const listCandidates: ReadonlyArray<unknown> = [
    nodeData.__listResults,
    nodeData.listResults,
    nodeData.splitResults,
  ]
  for (const list of listCandidates) {
    if (Array.isArray(list) && list.length > 0) {
      const parsed = tryParseSampleItem(list[0])
      if (parsed !== undefined) return parsed
    }
  }

  const jsonCandidates: ReadonlyArray<unknown> = [
    nodeData.generatedJson,
    nodeData.processedResult,
  ]
  for (const json of jsonCandidates) {
    const parsed = tryParseSampleItem(json)
    if (parsed !== undefined) return parsed
  }

  return undefined
}

/** Coerce arbitrary sample data to a value we can walk: parses string JSON,
 *  unwraps single-element arrays so nested paths are discovered, and drops
 *  null/undefined. Returns undefined when nothing walkable is found. */
function tryParseSampleItem(v: unknown): unknown {
  if (v === null || v === undefined) return undefined
  if (Array.isArray(v)) return v.length > 0 ? tryParseSampleItem(v[0]) : undefined
  if (typeof v === "object") return v
  if (typeof v === "string") {
    const trimmed = v.trim()
    if (trimmed.length < 2) return undefined
    const first = trimmed[0]
    if (first !== "{" && first !== "[") return undefined
    try {
      return tryParseSampleItem(JSON.parse(trimmed))
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Walk a sample value and collect every dot-path that resolves to a leaf or
 *  a step along the way. Arrays are treated transparently so "pages.url" is
 *  offered for `{ pages: [{url: "..."}] }` — matching evaluateJsonPath's
 *  auto-iterate semantics. Bounded by depth + total-path count to avoid
 *  pathological dropdowns on deeply-nested payloads. */
function extractPathsFromValue(v: unknown): readonly string[] {
  const MAX_DEPTH = 4
  const MAX_PATHS = 200
  const out: string[] = []
  const seen = new Set<string>()

  const push = (p: string) => {
    if (!p || seen.has(p) || out.length >= MAX_PATHS) return
    seen.add(p)
    out.push(p)
  }

  const walk = (node: unknown, prefix: string, depth: number): void => {
    if (out.length >= MAX_PATHS || depth > MAX_DEPTH) return
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      if (node.length > 0) walk(node[0], prefix, depth)
      return
    }
    if (typeof node === "object") {
      for (const key of Object.keys(node as Record<string, unknown>)) {
        if (!key) continue
        const path = prefix ? `${prefix}.${key}` : key
        push(path)
        walk((node as Record<string, unknown>)[key], path, depth + 1)
      }
    }
  }

  walk(v, "", 0)
  return out
}

/** Node types that don't transform item structure — items flow through
 *  unchanged. Schema detection walks back through these to find the real
 *  producer (e.g. Web Scrape) when the pass-through itself has no cache. */
const PASS_THROUGH_SCHEMA_TYPES: ReadonlySet<string> = new Set([
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
])

/**
 * Compute dropdown options for the Field selector. Resolution order:
 *   1. Live-detected keys from the immediate upstream's cached output.
 *   2. SCRAPER_OUTPUT_FIELDS fallback when the upstream is a web-scrape
 *      node with no cached data yet.
 *   3. For pass-through upstreams (filter-list/deduplicate/merge-lists),
 *      walk further back through the graph until a real producer is
 *      reached, then apply the same two strategies there.
 */
export function getUpstreamFieldOptions(
  sources: ReadonlyArray<SourceNodeInfo>,
  allNodes?: ReadonlyArray<WorkflowNode>,
  allEdges?: ReadonlyArray<WorkflowEdge>,
): readonly string[] {
  const inSource = sources.find((s) => s.targetHandle === "in")
  if (!inSource) return []
  return resolveNodeSchema(
    inSource.type,
    inSource.id,
    (inSource.nodeData ?? null) as Record<string, unknown> | null,
    allNodes,
    allEdges,
    new Set<string>(),
  )
}

/** Resolve the first upstream sample item that has walkable shape (object /
 *  parsed JSON). Walks back through pass-through nodes (filter-list, dedupe,
 *  merge-lists) so previews still work when the filter is chained. Returns
 *  undefined when nothing walkable is cached upstream. */
export function getUpstreamSampleItem(
  sources: ReadonlyArray<SourceNodeInfo>,
  allNodes?: ReadonlyArray<WorkflowNode>,
  allEdges?: ReadonlyArray<WorkflowEdge>,
): unknown {
  const inSource = sources.find((s) => s.targetHandle === "in")
  if (!inSource) return undefined
  return resolveSampleItem(
    inSource.type,
    inSource.id,
    (inSource.nodeData ?? null) as Record<string, unknown> | null,
    allNodes,
    allEdges,
    new Set<string>(),
  )
}

function resolveSampleItem(
  type: string | undefined,
  id: string,
  data: Record<string, unknown> | null,
  allNodes: ReadonlyArray<WorkflowNode> | undefined,
  allEdges: ReadonlyArray<WorkflowEdge> | undefined,
  visited: Set<string>,
): unknown {
  if (visited.has(id)) return undefined
  visited.add(id)

  if (data) {
    const sample = detectSampleItem(data)
    if (sample !== undefined) return sample
  }

  if (PASS_THROUGH_SCHEMA_TYPES.has(type ?? "") && allNodes && allEdges) {
    const incoming = allEdges.filter((e) => e.target === id)
    for (const edge of incoming) {
      const src = allNodes.find((n) => n.id === edge.source)
      if (!src) continue
      const sample = resolveSampleItem(
        src.type,
        src.id,
        src.data as Record<string, unknown>,
        allNodes,
        allEdges,
        visited,
      )
      if (sample !== undefined) return sample
    }
  }

  return undefined
}

function resolveNodeSchema(
  type: string | undefined,
  id: string,
  data: Record<string, unknown> | null,
  allNodes: ReadonlyArray<WorkflowNode> | undefined,
  allEdges: ReadonlyArray<WorkflowEdge> | undefined,
  visited: Set<string>,
): readonly string[] {
  if (visited.has(id)) return []
  visited.add(id)

  // 1. Live cached schema on this node.
  const detected = detectUpstreamFieldKeys(data)
  if (detected.length > 0) return detected

  // 2. Web-scrape static fallback for known actor shapes.
  if (type === "web-scrape" && data) {
    const actor = (data as WebScrapeNodeData).actor ?? "google-search"
    const fallback = SCRAPER_OUTPUT_FIELDS[actor] ?? []
    if (fallback.length > 0) return fallback
  }

  // 3. Pass-through nodes: items preserve structure, so look at their
  //    producers. (Filter List, Deduplicate, Merge Lists.)
  if (PASS_THROUGH_SCHEMA_TYPES.has(type ?? "") && allNodes && allEdges) {
    const incoming = allEdges.filter((e) => e.target === id)
    for (const edge of incoming) {
      const src = allNodes.find((n) => n.id === edge.source)
      if (!src) continue
      const keys = resolveNodeSchema(
        src.type,
        src.id,
        src.data as Record<string, unknown>,
        allNodes,
        allEdges,
        visited,
      )
      if (keys.length > 0) return keys
    }
  }

  return []
}

const EXTRACT_FIELD_CUSTOM = "__custom__"
const EXTRACT_FIELD_WHOLE = "__whole__"

export function ExtractFieldConfig({ data, onUpdate, sources, nodes, edges }: ConfigProps<ExtractFieldNodeData>) {
  const t = useT()
  // Dropdown is the default UI — users opt into manual entry via "Custom path…".
  const mode = data.mode ?? "dropdown"
  const field = data.field ?? ""
  const actorOptions = useMemo(
    () => getUpstreamFieldOptions(sources, nodes, edges),
    [sources, nodes, edges],
  )

  const setField = (value: string) => onUpdate({ field: value })
  const setMode = (next: "dropdown" | "custom") => onUpdate({ mode: next })

  // Map field → dropdown sentinel for the Select's value prop.
  // Custom values fall back to "" so the placeholder shows (the stored field is
  // preserved on node data and re-selecting an option overwrites it).
  const selectValue = field === ""
    ? EXTRACT_FIELD_WHOLE
    : (actorOptions.includes(field) ? field : "")

  return (
    <div className="flex flex-col gap-3">
      {mode === "dropdown" ? (
        <div>
          <Label>{t("utilcfg.field")}</Label>
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === EXTRACT_FIELD_CUSTOM) {
                setMode("custom")  // keep current field as starting value in custom mode
              } else if (v === EXTRACT_FIELD_WHOLE) {
                setField("")
              } else {
                setField(v)
              }
            }}
          >
            <SelectTrigger aria-label={t("utilcfg.field")}><SelectValue placeholder={t("utilcfg.phSelectField")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={EXTRACT_FIELD_WHOLE} className="text-muted-foreground">{t("utilcfg.wholeItem")}</SelectItem>
              {actorOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
              <SelectItem value={EXTRACT_FIELD_CUSTOM} className="text-muted-foreground">{t("utilcfg.customPath")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-1">
            {actorOptions.length > 0
              ? <>{t("utilcfg.extractFieldHintDetected")}</>
              : <>{t("utilcfg.fieldHintNoSchema")}</>}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>{t("utilcfg.path")}</Label>
          <Input
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder={t("utilcfg.phExtractPath")}
          />
          <p className="text-[10px] text-muted-foreground">
            {t("utilcfg.extractPathHint")}
          </p>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline text-start self-start mt-0.5"
            onClick={() => setMode("dropdown")}
          >
            {t("utilcfg.backToFieldList")}
          </button>
        </div>
      )}

      <div>
        <Label>{t("utilcfg.outputType")}</Label>
        <Select
          value={data.outputType ?? "text"}
          onValueChange={(v) => onUpdate({ outputType: v as "text" | "list" | "json" })}
        >
          <SelectTrigger aria-label={t("utilcfg.outputTypeAria")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">{t("field.text")}</SelectItem>
            <SelectItem value="list">{t("utilcfg.outputList")}</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          {t("utilcfg.outputTypeHint")}
        </p>
      </div>

      {data.extractedText && (
        <div>
          <Label>{t("utilcfg.outputPreview")}</Label>
          <Textarea rows={4} value={data.extractedText} readOnly className="text-xs opacity-70" />
        </div>
      )}
    </div>
  )
}

const PREVIEW_TYPE_ICON: Record<PreviewItem["type"], React.ReactNode> = {
  text: <FileText className="w-3.5 h-3.5 text-blue-400" />,
  image: <ImageIcon className="w-3.5 h-3.5 text-pink-400" />,
  video: <Film className="w-3.5 h-3.5 text-purple-400" />,
  audio: <Music className="w-3.5 h-3.5 text-amber-400" />,
  data: <FileText className="w-3.5 h-3.5 text-slate-400" />,
}

export function PreviewConfig({ data, onUpdate }: { data: PreviewNodeData; onUpdate: (patch: Partial<PreviewNodeData>) => void }) {
  const t = useT()
  const items = data.previewItems ?? []
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback((value: string, idx: number) => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    navigator.clipboard.writeText(value)
    setCopiedIdx(idx)
    copyTimeoutRef.current = setTimeout(() => setCopiedIdx(null), 2000)
  }, [])

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current) }
  }, [])

  const toggleVisibility = useCallback((index: number) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, visible: !item.visible } : item
    )
    onUpdate({
      previewItems: updated,
      itemOrder: updated.map((item) => getPreviewItemKey(item)),
    })
  }, [items, onUpdate])

  const moveItem = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const updated = [...items]
    const [moved] = updated.splice(fromIndex, 1)
    updated.splice(toIndex, 0, moved)
    onUpdate({
      previewItems: updated,
      itemOrder: updated.map((item) => getPreviewItemKey(item)),
    })
  }, [items, onUpdate])

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback((index: number) => {
    if (dragIndex !== null && dragIndex !== index) {
      moveItem(dragIndex, index)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, moveItem])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-3 border border-dashed border-border text-center">
        {t("utilcfg.previewEmpty")}
      </p>
    )
  }

  const visibleCount = items.filter((i) => i.visible !== false).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>{t("utilcfg.connectedValues", { count: items.length })}</Label>
        <span className="text-[10px] text-muted-foreground">{t("utilcfg.visibleCount", { count: visibleCount })}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => {
          const isVisible = item.visible !== false
          const isDragging = dragIndex === i
          const isDragOver = dragOverIndex === i && dragIndex !== i

          return (
            <div
              key={getPreviewItemKey(item)}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              className={
                "rounded-lg border bg-muted/20 transition-all " +
                (isDragging ? "opacity-40 border-dashed border-muted-foreground/40 " : "") +
                (isDragOver ? "border-[#ff0073] ring-1 ring-[#ff0073]/30 " : "border-border ")
              }
            >
              {/* Header row: drag handle, icon, label, type badge, visibility toggle, arrows */}
              <div className="flex items-center gap-1 px-2 py-1.5">
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 cursor-grab shrink-0" />
                {PREVIEW_TYPE_ICON[item.type]}
                <span className="text-xs font-medium text-foreground/80 truncate flex-1 min-w-0">
                  {item.sourceNodeLabel}
                </span>
                <span className="text-[9px] text-muted-foreground uppercase shrink-0">{item.type}</span>
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-muted/50 transition-colors shrink-0"
                  onClick={() => { if (i > 0) moveItem(i, i - 1) }}
                  disabled={i === 0}
                >
                  <ChevronUp className={"w-3 h-3 " + (i === 0 ? "text-muted-foreground/20" : "text-muted-foreground")} />
                </button>
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-muted/50 transition-colors shrink-0"
                  onClick={() => { if (i < items.length - 1) moveItem(i, i + 1) }}
                  disabled={i === items.length - 1}
                >
                  <ChevronDown className={"w-3 h-3 " + (i === items.length - 1 ? "text-muted-foreground/20" : "text-muted-foreground")} />
                </button>
                <button
                  type="button"
                  className={"p-0.5 rounded hover:bg-muted/50 transition-colors shrink-0 " + (isVisible ? "text-foreground/70" : "text-muted-foreground/40")}
                  onClick={() => toggleVisibility(i)}
                  title={isVisible ? t("utilcfg.hideOnCanvas") : t("utilcfg.showOnCanvas")}
                >
                  {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Preview content */}
              <div className={"px-2.5 pb-2 " + (!isVisible ? "opacity-40" : "")}>
                {item.type === "image" && isMediaUrl(item.value) ? (
                  <img src={optimizedImageUrl(item.value)} alt="" className="w-full max-h-40 object-contain rounded border border-border" loading="lazy" />
                ) : item.type === "video" && isMediaUrl(item.value) ? (
                  <video src={item.value} className="w-full max-h-40 object-contain rounded border border-border" controls muted playsInline preload="none" />
                ) : item.type === "audio" && isMediaUrl(item.value) ? (
                  <WaveformAudioPlayer url={item.value} variant="compact" className="w-full" />
                ) : (
                  <Textarea rows={Math.min((item.value.match(/\n/g) || []).length + 1, 6)} value={item.value} readOnly className="text-xs opacity-70" />
                )}
              </div>

              {/* Action buttons */}
              <div className={"flex gap-1.5 px-2.5 pb-2 " + (!isVisible ? "opacity-40" : "")}>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs h-7"
                  onClick={() => handleCopy(item.value, i)}
                >
                  {copiedIdx === i ? (
                    <Check className="w-3 h-3 me-1 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3 me-1" />
                  )}
                  {copiedIdx === i ? t("apiTok.copied") : item.type === "text" ? t("utilcfg.copyText") : item.type === "data" ? t("utilcfg.copyData") : t("utilcfg.copyUrl")}
                </Button>
                {(item.type === "image" || item.type === "video" || item.type === "audio") && isMediaUrl(item.value) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs h-7"
                    onClick={() => {
                      const ext = item.type === "video" ? "mp4" : item.type === "audio" ? "mp3" : "png"
                      downloadFile(item.value, `${item.sourceNodeLabel}.${ext}`)
                    }}
                  >
                    <Download className="w-3 h-3 me-1" />
                    {t("utilcfg.download")}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TeleporterConfig({ data, onUpdate, nodeType }: { data: TeleportSendData | TeleportReceiveData; onUpdate: (patch: Partial<TeleportSendData | TeleportReceiveData>) => void; nodeType: string }) {
  const t = useT()
  const { nodes, updateNodeData, syncTeleporterEdges } = useWorkflowStore()
  const isSend = nodeType === "teleport-send"

  const partners = nodes.filter((n) => {
    if (isSend) return n.type === "teleport-receive" && (n.data as TeleportReceiveData).channel === data.channel
    return n.type === "teleport-send" && (n.data as TeleportSendData).channel === data.channel
  })

  const availableChannels = nodes
    .filter((n) => n.type === "teleport-send")
    .map((n) => ({
      channel: (n.data as Record<string, unknown>).channel as string,
      channelColor: (n.data as Record<string, unknown>).channelColor as string,
      label: (n.data as Record<string, unknown>).label as string,
    }))
    .filter((c, i, arr) => arr.findIndex((a) => a.channel === c.channel) === i)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">{t("utilcfg.channel")}</label>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: data.channelColor }} />
          <span className="text-sm font-semibold" style={{ color: data.channelColor }}>{data.channel}</span>
        </div>
      </div>

      {!isSend && availableChannels.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">{t("utilcfg.switchChannel")}</label>
          <select
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
            value={data.channel}
            onChange={(e) => {
              const selected = availableChannels.find((c) => c.channel === e.target.value)
              if (!selected) return
              const oldChannel = data.channel
              onUpdate({
                channel: selected.channel,
                channelColor: selected.channelColor,
              })
              // Sync hidden edges: remove from old channel, add to new
              syncTeleporterEdges(oldChannel)
              syncTeleporterEdges(selected.channel)
            }}
          >
            {availableChannels.map((ch) => (
              <option key={ch.channel} value={ch.channel}>
                {t("utilcfg.channelOption", { channel: ch.channel, label: ch.label })}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">{t("utilcfg.channelName")}</label>
        <input
          type="text"
          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
          value={isTeleportDefaultLabel(data.label, data.channel) ? "" : data.label}
          placeholder={t("utilcfg.phNameChannel")}
          onChange={(e) => {
            const newLabel = e.target.value || data.channel
            onUpdate({ label: newLabel })
            for (const partner of partners) {
              updateNodeData(partner.id, { label: newLabel })
            }
          }}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          {isSend ? t("utilcfg.receivesOnChannel") : t("utilcfg.sendNode")}
        </label>
        {partners.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">{t("utilcfg.noPartnerNodes")}</p>
        ) : (
          <div className="space-y-1">
            {partners.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-start text-xs px-2 py-1 rounded hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => {
                  const event = new CustomEvent(TELEPORTER_PAN_EVENT, { detail: { nodeId: p.id } })
                  window.dispatchEvent(event)
                }}
              >
                {p.data.label as string} ({p.id})
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function RouterConfig({ data, onUpdate, sources, nodes, edges }: ConfigProps<RouterNodeData>) {
  const t = useT()
  const mode = data.mode ?? "radio"
  const routes = data.routes ?? []
  const isConditional = mode === "conditional"
  const conditionGroups = data.conditionGroups ?? []

  // Upstream schema + sample are only interesting when we're actually writing rules.
  const fieldOptions = useMemo(
    () => (isConditional ? getUpstreamFieldOptions(sources, nodes, edges) : []),
    [isConditional, sources, nodes, edges],
  )
  const sampleItem = useMemo(
    () => (isConditional ? getUpstreamSampleItem(sources, nodes, edges) : undefined),
    [isConditional, sources, nodes, edges],
  )
  const highlightedPaths = useMemo(() => {
    const s = new Set<string>()
    for (const g of conditionGroups) for (const c of g.conditions ?? []) {
      const f = (c.field ?? "").trim()
      if (f) s.add(f)
    }
    return s
  }, [conditionGroups])

  const updateRoute = (index: number, patch: Partial<{ name: string; active: boolean }>) => {
    const updated = routes.map((r, i) => {
      if (i !== index) {
        if (patch.active && mode === "radio") return { ...r, active: false }
        return r
      }
      return { ...r, ...patch }
    })
    onUpdate({ routes: updated })
  }

  const addRoute = () => {
    if (routes.length >= 10) return
    const letter = String.fromCharCode(65 + routes.length)
    onUpdate({
      routes: [...routes, { id: crypto.randomUUID(), name: t("utilcfg.routeNameDefault", { letter }), active: false }],
    })
  }

  const removeRoute = (index: number) => {
    // Conditional mode allows 1-route gate patterns. Radio/checkbox still need ≥ 2.
    const minRoutes = isConditional ? 1 : 2
    if (routes.length <= minRoutes) return
    const removed = routes[index]
    const updated = routes.filter((_, i) => i !== index)
    // If radio mode and we removed the active one, activate first
    if (mode === "radio" && !updated.some((r) => r.active) && updated.length > 0) {
      updated[0] = { ...updated[0], active: true }
    }
    // Clean up dangling references to the removed route in condition groups.
    const nextGroups = isConditional
      ? conditionGroups.map((g) => ({ ...g, routeIds: (g.routeIds ?? []).filter((id) => id !== removed.id) }))
      : conditionGroups
    onUpdate({ routes: updated, conditionGroups: nextGroups })
  }

  const switchMode = (newMode: string) => {
    const next = newMode as RouterNodeData["mode"]
    if (next === "radio" && routes.filter((r) => r.active).length > 1) {
      const firstActiveIdx = routes.findIndex((r) => r.active)
      const updated = routes.map((r, i) => ({ ...r, active: i === firstActiveIdx }))
      onUpdate({ mode: next, routes: updated })
      return
    }
    if (next === "conditional" && conditionGroups.length === 0) {
      // Seed one empty group pre-selecting the first route — a friendlier
      // first-run than a blank slate.
      const seeded: RouterConditionGroup = {
        id: nanoid(),
        conditions: [{ id: nanoid(), field: "", operator: "=", value: "", valueType: "static", mode: "dropdown" }],
        conditionLogic: "AND",
        routeIds: routes[0] ? [routes[0].id] : [],
      }
      onUpdate({ mode: next, conditionGroups: [seeded] })
      return
    }
    onUpdate({ mode: next })
  }

  const addGroup = () => {
    const newGroup: RouterConditionGroup = {
      id: nanoid(),
      conditions: [{ id: nanoid(), field: "", operator: "=", value: "", valueType: "static", mode: "dropdown" }],
      conditionLogic: "AND",
      routeIds: routes[0] ? [routes[0].id] : [],
    }
    onUpdate({ conditionGroups: [...conditionGroups, newGroup] })
  }

  const updateGroup = (id: string, patch: Partial<RouterConditionGroup>) => {
    onUpdate({
      conditionGroups: conditionGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    })
  }

  const removeGroup = (id: string) => {
    onUpdate({ conditionGroups: conditionGroups.filter((g) => g.id !== id) })
  }

  const toggleGroupRoute = (groupId: string, routeId: string) => {
    const group = conditionGroups.find((g) => g.id === groupId)
    if (!group) return
    const current = group.routeIds ?? []
    const next = current.includes(routeId) ? current.filter((id) => id !== routeId) : [...current, routeId]
    updateGroup(groupId, { routeIds: next })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t("field.mode")}</Label>
        <Select value={mode} onValueChange={switchMode}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="radio">{t("utilcfg.routerModeRadio")}</SelectItem>
            <SelectItem value="checkbox">{t("utilcfg.routerModeCheckbox")}</SelectItem>
            <SelectItem value="conditional">{t("utilcfg.routerModeConditional")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t("utilcfg.routes")}</Label>
        <div className="flex flex-col gap-2">
          {routes.map((route, i) => (
            <div key={route.id} className="flex items-center gap-2">
              {isConditional ? (
                // Derived from rule evaluation — show a read-only indicator.
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${(data.activeRoutes ?? []).includes(route.id) ? "border-green-500" : "border-muted-foreground/40"}`}
                  title={t("utilcfg.derivedActiveTitle")}
                >
                  {(data.activeRoutes ?? []).includes(route.id) && <div className="w-2 h-2 rounded-full bg-green-500" />}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => updateRoute(i, { active: mode === "radio" ? true : !route.active })}
                  className="shrink-0"
                >
                  {mode === "radio" ? (
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${route.active ? "border-green-500" : "border-muted-foreground/40"}`}>
                      {route.active && <div className="w-2 h-2 rounded-full bg-green-500" />}
                    </div>
                  ) : (
                    <div className={`w-7 h-4 rounded-full relative transition-colors ${route.active ? "bg-green-500" : "bg-muted-foreground/30"}`}>
                      <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${route.active ? "end-0.5" : "start-0.5"}`} />
                    </div>
                  )}
                </button>
              )}
              <Input
                value={route.name}
                onChange={(e) => updateRoute(i, { name: e.target.value })}
                className="h-8 text-sm flex-1"
              />
              {routes.length > (isConditional ? 1 : 2) && (
                <button type="button" onClick={() => removeRoute(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {routes.length < 10 && (
          <button
            type="button"
            onClick={addRoute}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> {t("utilcfg.addRoute")}
          </button>
        )}
      </div>

      {isConditional && (
        <div className="flex flex-col gap-3">
          {sampleItem !== undefined && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-medium text-muted-foreground">{t("utilcfg.upstreamSample")}</Label>
              <FilterJsonPreview value={sampleItem} highlightedPaths={highlightedPaths} />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label>{t("utilcfg.conditionGroups", { count: conditionGroups.length })}</Label>
            <button
              type="button"
              onClick={addGroup}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> {t("utilcfg.addGroup")}
            </button>
          </div>

          {conditionGroups.length === 0 && (
            <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
              {t("utilcfg.noConditionGroups")}
            </p>
          )}

          {conditionGroups.map((group) => {
            const condLogic = group.conditionLogic ?? "AND"
            const groupRouteIds = group.routeIds ?? []
            return (
              <div key={group.id} className="flex flex-col gap-2 rounded-md border border-border bg-muted/10 p-2">
                <div className="flex items-center justify-between">
                  <AndOrToggle
                    value={condLogic}
                    onChange={(next) => updateGroup(group.id, { conditionLogic: next })}
                  />
                  <button
                    type="button"
                    onClick={() => removeGroup(group.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title={t("utilcfg.removeGroup")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {(group.conditions ?? []).map((cond) => (
                  <ConditionRowEditor
                    key={cond.id}
                    condition={cond}
                    fieldOptions={fieldOptions}
                    onUpdate={(patch) =>
                      updateGroup(group.id, {
                        conditions: (group.conditions ?? []).map((c) => (c.id === cond.id ? { ...c, ...patch } : c)),
                      })
                    }
                    onRemove={() =>
                      updateGroup(group.id, {
                        conditions: (group.conditions ?? []).filter((c) => c.id !== cond.id),
                      })
                    }
                  />
                ))}
                <button
                  type="button"
                  onClick={() =>
                    updateGroup(group.id, {
                      conditions: [
                        ...(group.conditions ?? []),
                        { id: nanoid(), field: "", operator: "=", value: "", valueType: "static", mode: "dropdown" },
                      ],
                    })
                  }
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 self-start"
                >
                  <Plus className="w-3 h-3" /> {t("utilcfg.addCondition")}
                </button>

                <div className="flex flex-col gap-1">
                  <Label className="text-[10px]">{t("utilcfg.activates")}</Label>
                  <div className="flex flex-wrap gap-1">
                    {routes.map((r) => {
                      const on = groupRouteIds.includes(r.id)
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => toggleGroupRoute(group.id, r.id)}
                          className={
                            "text-[10px] px-2 py-0.5 rounded-full border transition-colors " +
                            (on
                              ? "border-green-500/50 bg-green-500/15 text-green-400"
                              : "border-border text-muted-foreground hover:text-foreground")
                          }
                        >
                          {r.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}

          <p className="text-[10px] text-muted-foreground">
            {t("utilcfg.routerGroupsHint")}
          </p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// JsonProcessConfig
// ---------------------------------------------------------------------------

function OPERATOR_LABELS(): Record<FilterOperator, string> {
  return {
  equals: tx("utilcfg.opEquals"),
  not_equals: tx("utilcfg.opNotEquals"),
  contains: tx("utilcfg.opContains"),
  not_contains: tx("utilcfg.opNotContains"),
  starts_with: tx("utilcfg.opStartsWith"),
  ends_with: tx("utilcfg.opEndsWith"),
  greater_than: tx("utilcfg.opGreaterThan"),
  less_than: tx("utilcfg.opLessThan"),
  is_empty: tx("utilcfg.opIsEmpty"),
  is_not_empty: tx("utilcfg.opIsNotEmpty"),
  matches_regex: tx("utilcfg.opMatchesRegex"),
  in_list: tx("utilcfg.opInList"),
}
}

const NO_VALUE_OPERATORS: FilterOperator[] = ["is_empty", "is_not_empty"]

export function JsonProcessConfig({ data, onUpdate }: ConfigProps<JsonProcessNodeData>) {
  const t = useT()
  const mode = data.mode ?? "visual"
  const inputPath = data.inputPath ?? ""
  const filters = data.filters ?? []
  const projections = data.projections ?? []
  const expression = data.expression ?? ""

  // Local state for the projection tag input draft
  const [projDraft, setProjDraft] = useState("")

  // Derived expression from visual controls
  const visualExpression = useMemo(
    () => buildExpressionFromVisual({ inputPath, filters, projections }),
    [inputPath, filters, projections],
  )

  // Sync expression into node data whenever visual inputs change (visual mode only)
  useEffect(() => {
    if (mode === "visual") {
      onUpdate({ expression: visualExpression })
    }
  // We intentionally depend on the serialized form to avoid stale closure issues
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, visualExpression])

  // --- Helpers ---

  const setMode = (next: "visual" | "advanced") => onUpdate({ mode: next })

  const updateFilter = (id: string, patch: Partial<JsonProcessNodeData["filters"][number]>) => {
    onUpdate({
      filters: filters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })
  }

  const addFilter = () => {
    onUpdate({
      filters: [
        ...filters,
        { id: crypto.randomUUID(), field: "", operator: "equals" as const, value: "" },
      ],
    })
  }

  const removeFilter = (id: string) => {
    onUpdate({ filters: filters.filter((f) => f.id !== id) })
  }

  const addProjection = (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed || projections.includes(trimmed)) return
    onUpdate({ projections: [...projections, trimmed] })
  }

  const removeProjection = (tag: string) => {
    onUpdate({ projections: projections.filter((p) => p !== tag) })
  }

  const handleProjKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      if (projDraft.trim()) {
        addProjection(projDraft)
        setProjDraft("")
      }
    } else if (e.key === "Backspace" && projDraft === "" && projections.length > 0) {
      removeProjection(projections[projections.length - 1])
    }
  }

  // --- Preview rendering ---

  const renderPreview = () => {
    if (data.errorMessage) {
      return (
        <p className="text-xs text-destructive break-all">
          {t("utilcfg.errorPrefix", { message: data.errorMessage })}
        </p>
      )
    }
    if (data.processedResult !== undefined) {
      const result = data.processedResult
      if (Array.isArray(result)) {
        const preview = result.slice(0, 5)
        return (
          <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground">{t("utilcfg.firstOfItems", { shown: Math.min(5, result.length), total: result.length })}</p>
            <pre className="text-[10px] font-mono bg-muted/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(preview, null, 2)}
            </pre>
          </div>
        )
      }
      if (result !== null && typeof result === "object") {
        const entries = Object.entries(result as Record<string, unknown>).slice(0, 10)
        return (
          <div className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground">{t("utilcfg.fieldsCount", { count: Object.keys(result as object).length })}</p>
            <div className="text-[10px] font-mono bg-muted/20 rounded p-1.5 space-y-0.5 overflow-x-auto">
              {entries.map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <span className="text-blue-400 shrink-0">{k}:</span>
                  <span className="text-muted-foreground truncate">{JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      }
      return (
        <pre className="text-[10px] font-mono bg-muted/20 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(result)}
        </pre>
      )
    }
    return (
      <p className="text-[10px] text-muted-foreground italic">{t("utilcfg.runToSeePreview")}</p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Mode pill switch */}
      <div className="flex rounded-md border border-border overflow-hidden self-start">
        {(["visual", "advanced"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={
              "px-3 py-1 text-xs font-medium transition-colors capitalize " +
              (mode === m
                ? "bg-foreground text-background"
                : "bg-background text-muted-foreground hover:text-foreground")
            }
          >
            {m === "visual" ? t("utilcfg.modeVisual") : t("utilcfg.modeAdvanced")}
          </button>
        ))}
      </div>

      {/* Visual mode */}
      {mode === "visual" && (
        <>
          <Accordion type="multiple" defaultValue={["path", "filters", "projections"]} className="border rounded-md overflow-hidden">
            {/* Input Path */}
            <AccordionItem value="path">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                {t("utilcfg.inputPath")}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-0">
                <Input
                  value={inputPath}
                  onChange={(e) => onUpdate({ inputPath: e.target.value })}
                  placeholder={t("utilcfg.phEgDataItems")}
                  className="text-xs h-8"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t("utilcfg.inputPathHint")}
                </p>
              </AccordionContent>
            </AccordionItem>

            {/* Filters */}
            <AccordionItem value="filters">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                {t("utilcfg.filtersCount", { count: filters.length })}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-0">
                <div className="flex flex-col gap-2">
                  {filters.map((f) => {
                    const isNoValue = NO_VALUE_OPERATORS.includes(f.operator)
                    const isInList = f.operator === "in_list"
                    return (
                      <div key={f.id} className="flex items-center gap-1.5">
                        {/* Field name */}
                        <Input
                          value={f.field}
                          onChange={(e) => updateFilter(f.id, { field: e.target.value })}
                          placeholder={t("utilcfg.phField")}
                          className="text-xs h-7 min-w-0 flex-1"
                        />
                        {/* Operator */}
                        <Select
                          value={f.operator}
                          onValueChange={(v) => {
                            const nextOp = v as FilterOperator
                            let nextValue: string | string[] = f.value
                            if (NO_VALUE_OPERATORS.includes(nextOp)) {
                              nextValue = ""
                            } else if (nextOp === "in_list" && !Array.isArray(f.value)) {
                              nextValue = String(f.value ?? "").split(",").map((s) => s.trim()).filter(Boolean)
                            } else if (nextOp !== "in_list" && Array.isArray(f.value)) {
                              nextValue = f.value.join(", ")
                            }
                            updateFilter(f.id, { operator: nextOp, value: nextValue })
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs w-[130px] shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.entries(OPERATOR_LABELS()) as [FilterOperator, string][]).map(([op, label]) => (
                              <SelectItem key={op} value={op} className="text-xs">
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* Value */}
                        {!isNoValue && (
                          isInList ? (
                            <Input
                              value={Array.isArray(f.value) ? f.value.join(", ") : f.value}
                              onChange={(e) => {
                                const parsed = e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
                                updateFilter(f.id, { value: parsed })
                              }}
                              placeholder="a, b, c"
                              className="text-xs h-7 min-w-0 flex-1"
                              title={t("utilcfg.commaSeparatedValues")}
                            />
                          ) : (
                            <Input
                              value={typeof f.value === "string" ? f.value : ""}
                              onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                              placeholder={t("utilcfg.phValue")}
                              className="text-xs h-7 min-w-0 flex-1"
                            />
                          )
                        )}
                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => removeFilter(f.id)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          title={t("utilcfg.removeFilter")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    onClick={addFilter}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 self-start mt-0.5"
                  >
                    <Plus className="w-3 h-3" /> {t("utilcfg.addFilter")}
                  </button>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Projections */}
            <AccordionItem value="projections">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                {t("utilcfg.projectionCount", { count: projections.length })}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-0">
                <div className="flex flex-wrap gap-1 mb-2 min-h-[28px] rounded border border-border px-1.5 py-1 bg-background">
                  {projections.map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-0.5 text-[10px] font-mono bg-muted rounded px-1.5 py-0.5"
                    >
                      {p}
                      <button
                        type="button"
                        onClick={() => removeProjection(p)}
                        className="text-muted-foreground hover:text-foreground ms-0.5"
                        title={t("utilcfg.removeField", { field: p })}
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={projDraft}
                    onChange={(e) => setProjDraft(e.target.value)}
                    onKeyDown={handleProjKeyDown}
                    placeholder={projections.length === 0 ? t("utilcfg.phFieldNameEnter") : t("utilcfg.phAddField")}
                    className="bg-transparent border-none outline-none text-xs text-foreground placeholder:text-muted-foreground min-w-[100px] flex-1"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t("utilcfg.projectionHint")}
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Generated expression preview */}
          <div className="text-[10px] text-muted-foreground bg-muted/20 rounded px-2 py-1.5 border border-border font-mono break-all">
            <span className="not-italic text-muted-foreground">{t("utilcfg.generatedPrefix")}</span>
            <code className="text-foreground/80">{visualExpression}</code>
          </div>
        </>
      )}

      {/* Advanced mode */}
      {mode === "advanced" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("utilcfg.expression")}</Label>
            <Textarea
              value={expression}
              onChange={(e) => onUpdate({ expression: e.target.value })}
              className="font-mono text-xs min-h-[100px] resize-y"
              placeholder=".data.items[] | select(.active == true) | {id, name}"
              spellCheck={false}
            />
          </div>
          <Accordion type="multiple" className="border rounded-md overflow-hidden">
            <AccordionItem value="syntax">
              <AccordionTrigger className="px-3 py-2 text-xs font-medium hover:no-underline">
                {t("utilcfg.syntaxReference")}
              </AccordionTrigger>
              <AccordionContent className="px-3 pb-3 pt-0">
                <pre className="text-[10px] font-mono text-muted-foreground leading-relaxed whitespace-pre-wrap">{t("utilcfg.syntaxReferenceBody")}</pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}

      {/* Preview block — always visible */}
      <div className="rounded-md border border-border bg-muted/10 px-2.5 py-2">
        <p className="text-[10px] font-medium text-muted-foreground mb-1.5">{t("pubTemplate.previewToggle")}</p>
        {renderPreview()}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterListConfig
// ---------------------------------------------------------------------------


/** Render a JSON value with every key labelled by its dot-path. Keys whose
 *  path appears in `highlightedPaths` are dimmed to gray so the user can see
 *  at a glance which parts of the payload the active filter conditions read.
 *  Arrays collapse to their first element + a length hint — matching the
 *  evaluator's auto-iterate semantics, and keeping the panel compact. */
export function FilterJsonPreview({
  value,
  highlightedPaths,
}: {
  value: unknown
  highlightedPaths: ReadonlySet<string>
}) {
  const t = useT()
  const render = (v: unknown, path: string, indent: number): React.ReactNode => {
    const pad = "  ".repeat(indent)
    if (v === null) return <span className="text-amber-400">null</span>
    if (v === undefined) return <span className="text-muted-foreground italic">undefined</span>
    if (typeof v === "string") return <span className="text-emerald-400">{JSON.stringify(v)}</span>
    if (typeof v === "number" || typeof v === "boolean") return <span className="text-sky-400">{String(v)}</span>
    if (Array.isArray(v)) {
      if (v.length === 0) return <span>[]</span>
      const hint = v.length > 1 ? t("utilcfg.jsonMoreHint", { count: v.length - 1 }) : ""
      return (
        <>
          <span>[</span>
          <span className="text-muted-foreground/60">{hint}</span>
          {"\n"}
          <span>{pad}  </span>
          {render(v[0], path, indent + 1)}
          {"\n"}
          <span>{pad}]</span>
        </>
      )
    }
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>)
      if (entries.length === 0) return <span>{"{}"}</span>
      return (
        <>
          <span>{"{"}</span>
          {"\n"}
          {entries.map(([k, child], i) => {
            const childPath = path ? `${path}.${k}` : k
            const isHit = highlightedPaths.has(childPath)
            const keyClass = isHit
              ? "bg-muted/70 text-muted-foreground rounded px-0.5"
              : "text-pink-400"
            return (
              <span key={childPath}>
                <span>{pad}  </span>
                <span className={keyClass}>{JSON.stringify(k)}</span>
                <span>: </span>
                {render(child, childPath, indent + 1)}
                {i < entries.length - 1 ? "," : ""}
                {"\n"}
              </span>
            )
          })}
          <span>{pad}{"}"}</span>
        </>
      )
    }
    return <span>{String(v)}</span>
  }

  return (
    <pre className="text-[10px] font-mono bg-muted/20 rounded p-2 overflow-auto max-h-56 whitespace-pre leading-relaxed">
      {render(value, "", 0)}
    </pre>
  )
}

export function FilterListConfig({ data, onUpdate, sources, nodes, edges }: ConfigProps<FilterListNodeData>) {
  const t = useT()
  const conditions = data.conditions ?? []
  const logic = data.conditionLogic ?? "AND"
  const [previewOpen, setPreviewOpen] = useState(true)

  // Upstream field schema — detected live from any upstream node's cached
  // output. Walks back through pass-through nodes (filter-list / dedupe /
  // merge) to reach the real producer; falls back to SCRAPER_OUTPUT_FIELDS
  // only for a web-scrape upstream with no cached data yet.
  const actorOptions = useMemo(
    () => getUpstreamFieldOptions(sources, nodes, edges),
    [sources, nodes, edges],
  )

  // Live sample of the first upstream item (object / parsed JSON). Feeds the
  // preview pane so users see the shape they're filtering against.
  const sampleItem = useMemo(
    () => getUpstreamSampleItem(sources, nodes, edges),
    [sources, nodes, edges],
  )

  // Paths actively used by conditions — highlighted in the preview.
  const highlightedPaths = useMemo(() => {
    const s = new Set<string>()
    for (const c of conditions) {
      const f = (c.field ?? "").trim()
      if (f) s.add(f)
    }
    return s
  }, [conditions])

  const updateCondition = (id: string, patch: Partial<FilterListCondition>) => {
    onUpdate({
      conditions: conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  }

  const addCondition = () => {
    onUpdate({
      conditions: [
        ...conditions,
        { id: nanoid(), field: "", operator: "=", value: "", valueType: "static", mode: "dropdown" },
      ],
    })
  }

  const removeCondition = (id: string) => {
    onUpdate({ conditions: conditions.filter((c) => c.id !== id) })
  }

  return (
    <div className="flex flex-col gap-3">
      {sampleItem !== undefined && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            className="flex items-center justify-between text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{t("utilcfg.upstreamSample")}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${previewOpen ? "rotate-180" : ""}`} />
          </button>
          {previewOpen && (
            <>
              <FilterJsonPreview value={sampleItem} highlightedPaths={highlightedPaths} />
              {highlightedPaths.size > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {t("utilcfg.grayFieldsHint")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Label>{t("utilcfg.conditionsCount", { count: conditions.length })}</Label>
        <AndOrToggle value={logic} onChange={(next) => onUpdate({ conditionLogic: next })} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Checkbox
          id={`filter-case-sensitive-${data.label}`}
          checked={data.caseSensitive ?? true}
          onCheckedChange={(v) => onUpdate({ caseSensitive: v === true })}
        />
        <Label htmlFor={`filter-case-sensitive-${data.label}`} className="text-xs cursor-pointer">
          {t("utilcfg.caseSensitive")}
        </Label>
      </div>

      {conditions.length === 0 && (
        <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
          {t("utilcfg.noConditions")}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {conditions.map((cond) => (
          <ConditionRowEditor
            key={cond.id}
            condition={cond}
            fieldOptions={actorOptions}
            onUpdate={(patch) => updateCondition(cond.id, patch)}
            onRemove={() => removeCondition(cond.id)}
          />
        ))}
        <button
          type="button"
          onClick={addCondition}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 self-start"
        >
          <Plus className="w-3 h-3" /> {t("utilcfg.addCondition")}
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        {t("utilcfg.filterListHint")}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeduplicateConfig
// ---------------------------------------------------------------------------

export function DeduplicateConfig({ data, onUpdate, sources, nodes, edges }: ConfigProps<DeduplicateNodeData>) {
  const t = useT()
  // Mirrors ExtractFieldConfig + FilterListConfig: dropdown fed by upstream
  // schema detection, with an explicit "Custom path…" escape hatch.
  const mode = data.mode ?? "dropdown"
  const field = data.field ?? ""
  const actorOptions = useMemo(
    () => getUpstreamFieldOptions(sources, nodes, edges),
    [sources, nodes, edges],
  )

  const setField = (value: string) => onUpdate({ field: value })
  const setMode = (next: "dropdown" | "custom") => onUpdate({ mode: next })

  // Custom values fall back to "" so the placeholder shows.
  const selectValue = field === ""
    ? EXTRACT_FIELD_WHOLE
    : (actorOptions.includes(field) ? field : "")

  return (
    <div className="flex flex-col gap-3">
      {mode === "dropdown" ? (
        <div className="flex flex-col gap-1.5">
          <Label>{t("utilcfg.dedupeByField")}</Label>
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === EXTRACT_FIELD_CUSTOM) {
                setMode("custom")
              } else if (v === EXTRACT_FIELD_WHOLE) {
                setField("")
              } else {
                setField(v)
              }
            }}
          >
            <SelectTrigger aria-label={t("utilcfg.dedupeByField")}><SelectValue placeholder={t("utilcfg.phSelectField")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={EXTRACT_FIELD_WHOLE} className="text-muted-foreground">{t("utilcfg.wholeItem")}</SelectItem>
              {actorOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
              <SelectItem value={EXTRACT_FIELD_CUSTOM} className="text-muted-foreground">{t("utilcfg.customPath")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {actorOptions.length > 0
              ? <>{t("utilcfg.dedupeHintDetected")}</>
              : <>{t("utilcfg.fieldHintNoSchema")}</>}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>{t("utilcfg.dedupeByField")}</Label>
          <Input
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder={t("utilcfg.phDedupePath")}
          />
          <p className="text-[10px] text-muted-foreground">
            {t("utilcfg.dedupePathHint")}
          </p>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline text-start self-start mt-0.5"
            onClick={() => setMode("dropdown")}
          >
            {t("utilcfg.backToFieldList")}
          </button>
        </div>
      )}

      {data.listResults && data.listResults.length > 0 && (
        <div>
          <Label>{t("utilcfg.previewUniqueItems", { count: data.listResults.length })}</Label>
          <Textarea
            rows={Math.min(data.listResults.length, 6)}
            value={data.listResults.map((item, i) => `${i + 1}. ${item}`).join("\n")}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MergeListsConfig
// ---------------------------------------------------------------------------

export function MergeListsConfig({ data, onUpdate }: ConfigProps<MergeListsNodeData>) {
  const t = useT()
  const dedupeOn = data.deduplicate === true
  const mode = data.mode === "zip" ? "zip" : "concat"
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{t("field.mode")}</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={mode === "concat" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => onUpdate({ mode: "concat" })}
          >
            {t("utilcfg.concatenate")}
          </Button>
          <Button
            variant={mode === "zip" ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => onUpdate({ mode: "zip" })}
          >
            {t("utilcfg.zipMergeItems")}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {mode === "concat"
            ? t("utilcfg.concatHint")
            : t("utilcfg.zipHint")}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <Label>{t("utilcfg.removeDuplicatesAfterMerge")}</Label>
        <Button
          variant={dedupeOn ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ deduplicate: !dedupeOn })}
        >
          {dedupeOn ? t("audiocfg.normalizationOn") : t("audiocfg.normalizationOff")}
        </Button>
      </div>

      {data.listResults && data.listResults.length > 0 && (
        <div>
          <Label>{t("utilcfg.previewItems", { count: data.listResults.length })}</Label>
          <Textarea
            rows={Math.min(data.listResults.length, 6)}
            value={data.listResults.map((item, i) => `${i + 1}. ${item}`).join("\n")}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SortListConfig
// ---------------------------------------------------------------------------

export function SortListConfig({ data, onUpdate, sources, nodes, edges }: ConfigProps<SortListNodeData>) {
  const t = useT()
  const mode = data.mode ?? "dropdown"
  const field = data.field ?? ""
  const sortType = data.sortType ?? "auto"
  const direction = data.direction ?? "asc"
  const actorOptions = useMemo(
    () => getUpstreamFieldOptions(sources, nodes, edges),
    [sources, nodes, edges],
  )

  const setField = (value: string) => onUpdate({ field: value })
  const setMode = (next: "dropdown" | "custom") => onUpdate({ mode: next })

  const selectValue = field === ""
    ? EXTRACT_FIELD_WHOLE
    : (actorOptions.includes(field) ? field : "")

  return (
    <div className="flex flex-col gap-3">
      {mode === "dropdown" ? (
        <div className="flex flex-col gap-1.5">
          <Label>{t("utilcfg.sortByField")}</Label>
          <Select
            value={selectValue}
            onValueChange={(v) => {
              if (v === EXTRACT_FIELD_CUSTOM) {
                setMode("custom")
              } else if (v === EXTRACT_FIELD_WHOLE) {
                setField("")
              } else {
                setField(v)
              }
            }}
          >
            <SelectTrigger aria-label={t("utilcfg.sortByField")}><SelectValue placeholder={t("utilcfg.phSelectField")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={EXTRACT_FIELD_WHOLE} className="text-muted-foreground">{t("utilcfg.wholeItem")}</SelectItem>
              {actorOptions.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
              <SelectItem value={EXTRACT_FIELD_CUSTOM} className="text-muted-foreground">{t("utilcfg.customPath")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            {actorOptions.length > 0
              ? <>{t("utilcfg.sortHintDetected")}</>
              : <>{t("utilcfg.fieldHintNoSchema")}</>}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label>{t("utilcfg.sortByField")}</Label>
          <Input
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder={t("utilcfg.phSortPath")}
          />
          <p className="text-[10px] text-muted-foreground">
            {t("utilcfg.sortPathHint")}
          </p>
          <button
            type="button"
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline text-start self-start mt-0.5"
            onClick={() => setMode("dropdown")}
          >
            {t("utilcfg.backToFieldList")}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>{t("utilcfg.sortType")}</Label>
        <Select value={sortType} onValueChange={(v) => onUpdate({ sortType: v as SortListNodeData["sortType"] })}>
          <SelectTrigger aria-label={t("utilcfg.sortType")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("utilcfg.sortAuto")}</SelectItem>
            <SelectItem value="text">{t("field.text")}</SelectItem>
            <SelectItem value="number">{t("utilcfg.sortNumber")}</SelectItem>
            <SelectItem value="date">{t("utilcfg.sortDate")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          {t("utilcfg.sortTypeHint")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("utilcfg.direction")}</Label>
        <div className="flex gap-1">
          <Button
            type="button"
            variant={direction === "asc" ? "default" : "outline"}
            size="sm"
            onClick={() => onUpdate({ direction: "asc" })}
            className="flex-1"
          >
            {t("utilcfg.ascending")}
          </Button>
          <Button
            type="button"
            variant={direction === "desc" ? "default" : "outline"}
            size="sm"
            onClick={() => onUpdate({ direction: "desc" })}
            className="flex-1"
          >
            {t("utilcfg.descending")}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("utilcfg.sortDirectionHint")}
        </p>
      </div>

      {data.listResults && data.listResults.length > 0 && (
        <div>
          <Label>{t("utilcfg.previewSortedItems", { count: data.listResults.length })}</Label>
          <Textarea
            rows={Math.min(data.listResults.length, 6)}
            value={data.listResults.map((item, i) => `${i + 1}. ${item}`).join("\n")}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}
