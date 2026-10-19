// tools/units/scaffold-templates.mjs
// The file templates of `gen:units -- --new` (tools/units/scaffold.mjs). Pure
// string emitters, built-ins only. Each template is plumbing that compiles,
// passes the unit guards (G1–G7) and wires the node through the live seams;
// the ONE place that is the node's own work (the worker step, the sync
// computation, the inline computation) throws until it is written, so an
// unfinished scaffold fails loudly on its first run instead of shipping a node
// that silently does nothing. A use-case node's work is its graph builder
// (USE_CASE_SPECS in @nodaro/render-rules), written before it is scaffolded:
// validation refuses a --builder that names no spec.
import { dataInterfaceName, pascalCase } from "./manifest.mjs"

const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const camelCase = (type) => {
  const p = pascalCase(type)
  return p.charAt(0).toLowerCase() + p.slice(1)
}
/** The thrown sentence in the one step a scaffold leaves to its author. */
const notWritten = (type, what) => `${type}: ${what} is not written yet (scaffolded by npm run gen:units -- --new)`

/** BaseNode's card colour for a manifest category (it has no "utility": those cards are processing cards). */
const BASE_NODE_CATEGORY = { input: "input", parameter: "parameter", processing: "processing", output: "output", utility: "processing" }

/**
 * The handles, execution and data fields each `execution.kind` starts from.
 * One worked shape per kind; the author changes the handles in unit.json and
 * the matching fields in types.ts.
 */
export const KIND_SHAPES = {
  // A video-queue job: video in, video out (the shape of every local-ffmpeg node).
  worker: {
    inputs: [{ id: "in", label: "Video", accepts: ["video"], field: "videoUrl" }],
    outputs: [{ id: "video-out", label: "Video", kind: "video", from: "generatedVideoUrl" }],
    execution: { kind: "worker", queue: "video", requires: { anyOf: ["videoUrl"], kind: "video", noun: "a video" } },
    outputType: "video",
    producer: "video",
    extraData: {},
  },
  // One HTTP call answers it: video in, text out.
  sync: {
    inputs: [{ id: "in", label: "Video", accepts: ["video"], field: "videoUrl" }],
    outputs: [{ id: "text-out", label: "Text", kind: "text", from: "outputText" }],
    execution: { kind: "sync", requires: { anyOf: ["videoUrl"], kind: "video", noun: "a video" } },
    outputType: "text",
    producer: null,
    extraData: {},
  },
  // The editor computes it from the node's own data: text out.
  inline: {
    inputs: [],
    outputs: [{ id: "text-out", label: "Text", kind: "text", from: "outputText" }],
    execution: { kind: "inline" },
    outputType: "text",
    producer: null,
    extraData: {},
  },
  // Nothing runs: the node's data is its output (edited in its config panel).
  source: {
    inputs: [],
    outputs: [{ id: "text-out", label: "Text", kind: "text", from: "text" }],
    execution: { kind: "source" },
    outputType: "text",
    producer: null,
    extraData: { text: "" },
  },
  // One recording in; text and its JSON out (a use-case node's shape at its smallest).
  // The use-case reader reads its outputs (no `from`); its inputs land in useCaseMedia (no `field`).
  "use-case": {
    inputs: [{ id: "media", label: "Recording", accepts: ["video", "audio"] }],
    outputs: [{ id: "text", label: "Text", kind: "text" }, { id: "json", label: "JSON", kind: "look" }],
    execution: { kind: "use-case" }, // unitJson adds `builder: o.builder`
    outputType: "text",
    producer: null,
    contract: { jsonPips: { json: "other" } },
    extraData: { planTier: "economy", instructions: "" },
  },
}

/** frontend/src/nodes/<type>/unit.json */
export function unitJson(o) {
  const shape = KIND_SHAPES[o.kind]
  return json({
    $schema: "../../../../tools/units/unit.schema.json",
    schemaVersion: 1,
    type: o.type,
    label: o.label,
    category: o.category,
    position: { after: o.after },
    picker: o.family ? { family: o.family, after: o.pickerAfter } : null,
    handles: { inputs: shape.inputs, outputs: shape.outputs },
    defaultData: { label: o.label, fieldMappings: {}, ...shape.extraData },
    execution: o.kind === "use-case" ? { ...shape.execution, builder: o.builder } : shape.execution,
    // ffmpeg-media: its inputs follow the canvas's ffmpeg media rule; a characterized worker needs it.
    capabilities: o.characterizeAfter !== undefined ? ["ffmpeg-media"] : [],
    registry: { description: o.description, outputType: shape.outputType },
    ...(shape.producer || shape.contract ? { contract: { ...(shape.producer ? { producer: shape.producer } : {}), ...shape.contract } } : {}),
    docs: { awaiting: `scaffolded: write docs/nodes/<folder>/${o.type}.md, then set docs.page` },
  })
}

/** frontend/src/nodes/<type>/types.ts — the `<Pascal>Data` interface gen:skills reads. */
export function typesTs(o) {
  const shape = KIND_SHAPES[o.kind]
  const useCase = o.kind === "use-case"
  // A use-case node's inputs land in useCaseMedia (never a data field); the use-case
  // reader reads its result fields: the "text" output from generatedText, "json" from generatedJson.
  const fields = useCase
    ? [
        "  planTier?: EditPlanTier",
        "  instructions?: string",
        "  /** The run's wrapper job (Continue addresses it). */",
        "  useCaseJobId?: string",
        "  /** The \"text\" output. */",
        "  generatedText?: string",
        "  /** The \"json\" output. */",
        "  generatedJson?: unknown",
      ]
    : [
        ...shape.inputs.map((h) => `  /** Wired into the "${h.id}" input. */\n  ${h.field}?: string`),
        ...shape.outputs.map((h) => (h.from === "text" ? "  /** The text this node emits. */\n  text: string" : `  /** The "${h.id}" output. */\n  ${h.from}?: string`)),
      ]
  const media = shape.outputs.some((h) => ["video", "image", "audio"].includes(h.kind))
  return [
    ...(useCase ? ['import type { EditPlanTier } from "@nodaro/shared/edl"'] : []),
    `import type { FieldMappings${media ? ", GeneratedResult" : ""} } from "@/types/nodes"`,
    "",
    `/** ${o.label.replace(/\*\//g, "*\\/")}: the node's data. Every field here is a node setting gen:skills documents. */`,
    `export type ${dataInterfaceName(o.type)} = {`,
    "  [key: string]: unknown",
    "  label: string",
    "  fieldMappings: FieldMappings",
    '  executionStatus?: "idle" | "running" | "completed" | "failed"',
    "  errorMessage?: string",
    ...(o.kind === "worker" || useCase ? ["  currentJobProgress?: number"] : []),
    ...fields,
    ...(media ? ["  generatedResults?: readonly GeneratedResult[]", "  activeResultIndex?: number"] : []),
    "}",
    "",
  ].join("\n")
}

// The pip each handle kind renders with: its colour (from the canonical maps,
// so handle-color-guard can resolve it), icon, and — for an input — the
// connection rule (the ffmpeg media rule a unit input is validated with).
const PIP = {
  video: { color: "FFMPEG_COLORS.video", icon: "Film", accepts: "ACCEPTS_VIDEO" },
  audio: { color: "FFMPEG_COLORS.audio", icon: "Music", accepts: "ACCEPTS_AUDIO" },
  text: { color: "HANDLE_COLORS.text", icon: "Type", accepts: null },
  look: { color: "DATA_HANDLE_COLORS.json", icon: "Braces", accepts: null },
}
const INPUT_TOP = "calc(100% - 24px)"
/** Output pips stack from the top, one row apart, so two never overlap. */
const outputTop = (i) => `${24 + 32 * i}px`

/** frontend/src/nodes/<type>/node.tsx — the canvas card: its pips, run strip and output. */
export function nodeTsx(o) {
  const shape = KIND_SHAPES[o.kind]
  const P = pascalCase(o.type)
  const D = dataInterfaceName(o.type)
  const out = shape.outputs[0]
  const runs = o.kind !== "source"
  const video = out.kind === "video"
  // An input's pip takes its first kind's colour and icon; its connection rule is
  // the media rule when it takes both a video and an audio (a recording).
  const pipOf = (h) => PIP[h.kind ?? h.accepts[0]]
  const acceptsOf = (h) => (h.accepts.includes("video") && h.accepts.includes("audio") ? "ACCEPTS_MEDIA" : pipOf(h).accepts)
  if (o.kind === "use-case") return useCaseNodeTsx(o, shape, pipOf, acceptsOf)
  const pips = [...shape.inputs, ...shape.outputs].map(pipOf)
  const icons = [...new Set(["Box", ...pips.map((p) => p.icon)])].sort()
  const usesFfmpeg = pips.some((p) => p.color.startsWith("FFMPEG_COLORS"))
  const accepts = [...new Set(shape.inputs.map(acceptsOf))].sort()
  const handleConfigs = [
    ...shape.inputs.map((h) => `          { id: "${h.id}", type: "target", position: Position.Left, customStyle: { top: "${INPUT_TOP}", left: "-29px" }, external: true },`),
    ...shape.outputs.map((h, i) => `          { id: "${h.id}", type: "source", position: Position.Right, customStyle: { top: "${outputTop(i)}", right: "-29px" }, external: true },`),
  ]
  const pipLines = [
    ...shape.inputs.map((h) => `      <HandleWithPopover nodeId={id} nodeType="${o.type}" handleId="${h.id}" type="target" position={Position.Left} label="${h.label}" color={${pipOf(h).color}} icon={<${pipOf(h).icon} />} side="left" top="${INPUT_TOP}" accepts={${acceptsOf(h)}} />`),
    ...shape.outputs.map((h, i) => `      <HandleWithPopover nodeId={id} nodeType="${o.type}" handleId="${h.id}" type="source" position={Position.Right} label="${h.label}" color={${pipOf(h).color}} icon={<${pipOf(h).icon} />} side="right" top="${outputTop(i)}" />`),
  ]
  const shown = out.from
  const body = video
    ? `        {nodeData.${shown} ? <video src={nodeData.${shown}} controls className="w-full rounded-md" /> : null}`
    : `        {nodeData.${shown} ? <p className="text-xs text-muted-foreground line-clamp-4">{nodeData.${shown}}</p> : null}`
  return [
    'import { memo } from "react"',
    'import { Position, type NodeProps } from "@xyflow/react"',
    `import { ${icons.join(", ")} } from "lucide-react"`,
    'import { BaseNode } from "@/components/nodes/base-node"',
    'import { HandleWithPopover } from "@/components/nodes/handle-with-popover"',
    ...(runs ? ['import { NodeQuickStrip } from "@/components/nodes/node-quick-strip"'] : []),
    ...(video ? ['import { videoNodeSizing } from "@/components/nodes/video-node-defaults"'] : []),
    ...(usesFfmpeg ? [`import { ${[...accepts, "FFMPEG_COLORS"].join(", ")} } from "@/lib/ffmpeg-handles"`] : []),
    ...(pips.some((p) => p.color.startsWith("DATA_HANDLE_COLORS")) ? ['import { DATA_HANDLE_COLORS } from "@/lib/data-handles"'] : []),
    ...(pips.some((p) => p.color.startsWith("HANDLE_COLORS")) ? ['import { HANDLE_COLORS } from "@/lib/handle-colors"'] : []),
    'import type { UnitNodeComponent } from "../kit"',
    `import type { ${D} } from "./types"`,
    "",
    "// The pips render beside BaseNode (its handles are `external`), as every",
    "// media node's do: handle-color-guard resolves their colours, and",
    "// unit.json handles is the one declaration they must match.",
    `function ${P}Node({ id, data, selected }: NodeProps) {`,
    `  const nodeData = data as ${D}`,
    ...(runs ? ['  const isRunning = nodeData.executionStatus === "running"'] : []),
    "  return (",
    '    <div className="relative" style={{ width: "100%", height: "100%", overflow: "visible" }}>',
    "      <BaseNode",
    "        id={id}",
    "        label={nodeData.label}",
    '        icon={<Box className="h-4 w-4" />}',
    `        category="${BASE_NODE_CATEGORY[o.category] ?? "processing"}"`,
    "        selected={selected}",
    ...(runs ? ["        isRunning={isRunning}", "        topToolbarContent={<NodeQuickStrip nodeId={id} isRunning={isRunning} />}"] : []),
    ...(video ? ["        {...videoNodeSizing(undefined)}"] : []),
    "        handles={[",
    ...handleConfigs,
    "        ]}",
    "      >",
    body,
    "      </BaseNode>",
    ...pipLines,
    "    </div>",
    "  )",
    "}",
    "",
    `export const NodeComponent: UnitNodeComponent = memo(${P}Node)`,
    "",
  ].join("\n")
}

/** The two places UseCaseNodeShell puts a pip on each side (its `at`), and the `top` its pip draws at. */
const USE_CASE_PIP_AT = [["top", "24px"], ["bottom", "calc(100% - 24px)"]]

/**
 * A use-case node's card: the frame every use-case node shares
 * (UseCaseNodeShell — its label, run strip and fee, running / failed /
 * empty states, Continue) around the node's own result, as Chapters' card
 * is. The shell places a pip at the top or the bottom of each side, so the
 * worked shape has at most two pips a side.
 */
function useCaseNodeTsx(o, shape, pipOf, acceptsOf) {
  const P = pascalCase(o.type)
  const D = dataInterfaceName(o.type)
  const sides = [["target", shape.inputs], ["source", shape.outputs]]
  for (const [, hs] of sides) if (hs.length > USE_CASE_PIP_AT.length) throw new Error(`${o.type}: UseCaseNodeShell places at most ${USE_CASE_PIP_AT.length} pips a side`)
  const pips = [...shape.inputs, ...shape.outputs].map(pipOf)
  const icons = [...new Set(["Box", ...pips.map((p) => p.icon)])].sort()
  const colorMaps = pips.some((p) => p.color.startsWith("FFMPEG_COLORS")) ? ["FFMPEG_COLORS"] : []
  const accepts = [...new Set(shape.inputs.map(acceptsOf).filter(Boolean))].sort()
  const slots = sides.flatMap(([type, hs]) => hs.map((h, i) => `        { id: "${h.id}", type: "${type}", at: "${USE_CASE_PIP_AT[i][0]}" },`))
  const pipLines = [
    ...shape.inputs.map((h, i) => `          <HandleWithPopover nodeId={id} nodeType="${o.type}" handleId="${h.id}" type="target" position={Position.Left} label="${h.label}" color={${pipOf(h).color}} icon={<${pipOf(h).icon} />} side="left" top="${USE_CASE_PIP_AT[i][1]}" accepts={${acceptsOf(h)}} />`),
    ...shape.outputs.map((h, i) => `          <HandleWithPopover nodeId={id} nodeType="${o.type}" handleId="${h.id}" type="source" position={Position.Right} label="${h.label}" color={${pipOf(h).color}} icon={<${pipOf(h).icon} />} side="right" top="${USE_CASE_PIP_AT[i][1]}" />`),
  ]
  return [
    'import { memo } from "react"',
    'import { Position, type NodeProps } from "@xyflow/react"',
    `import { ${icons.join(", ")} } from "lucide-react"`,
    'import { HandleWithPopover } from "@/components/nodes/handle-with-popover"',
    'import { UseCaseNodeShell, useUseCaseNodeRun } from "@/components/nodes/use-case-node-shell"',
    ...(colorMaps.length + accepts.length > 0 ? [`import { ${[...accepts, ...colorMaps].join(", ")} } from "@/lib/ffmpeg-handles"`] : []),
    ...(pips.some((p) => p.color.startsWith("DATA_HANDLE_COLORS")) ? ['import { DATA_HANDLE_COLORS } from "@/lib/data-handles"'] : []),
    ...(pips.some((p) => p.color.startsWith("HANDLE_COLORS")) ? ['import { HANDLE_COLORS } from "@/lib/handle-colors"'] : []),
    'import { useT } from "@/lib/i18n"',
    'import type { UnitNodeComponent } from "../kit"',
    `import type { ${D} } from "./types"`,
    "",
    "// The frame every use-case node shares (components/nodes/use-case-node-shell.tsx)",
    "// draws the run strip and fee, the running / failed / empty states and",
    "// Continue; the node supplies its result and its pips. The use-case reader",
    "// hands on the \"text\" output from generatedText (use-case-io.ts), so the card shows that.",
    "// The node's type is React Flow's (NodeProps), never a literal to mistype.",
    `function ${P}Node({ id, type, data, selected }: NodeProps) {`,
    `  const nodeData = data as ${D}`,
    "  const t = useT()",
    "  const run = useUseCaseNodeRun(id, type, nodeData)",
    '  const text = typeof nodeData.generatedText === "string" ? nodeData.generatedText : ""',
    "  return (",
    "    <UseCaseNodeShell",
    "      id={id}",
    "      data={nodeData}",
    "      run={run}",
    "      selected={selected}",
    "      icon={Box}",
    "      sizing={{ minWidth: 280, minHeight: 220 }}",
    "      bodyMinHeight={160}",
    "      handles={[",
    ...slots,
    "      ]}",
    '      hasResult={run.status !== "running" && text !== ""}',
    '      result={<p className="text-xs text-muted-foreground line-clamp-4">{text}</p>}',
    "      // Tighten's \"Connect an episode recording\": replace it with this node's own string (its strings.json).",
    '      emptyText={t("node.tightenConnectRecording")}',
    "      pips={",
    "        <>",
    ...pipLines,
    "        </>",
    "      }",
    "    />",
    "  )",
    "}",
    "",
    `export const NodeComponent: UnitNodeComponent = memo(${P}Node)`,
    "",
  ].join("\n")
}

/** frontend/src/nodes/<type>/config.tsx — the config panel body. */
export function configTsx(o) {
  if (o.kind === "source") {
    return [
      'import type { ConfigProps } from "@/components/editor/config-panels/types"',
      'import type { UnitConfigPanel } from "../exec-kit"',
      `import type { ${dataInterfaceName(o.type)} } from "./types"`,
      "",
      `function ${pascalCase(o.type)}Config({ data, onUpdate }: ConfigProps<never>) {`,
      `  const nodeData: ${dataInterfaceName(o.type)} = data`,
      "  return (",
      "    <textarea",
      '      className="w-full min-h-24 rounded-md border bg-background p-2 text-sm"',
      "      value={nodeData.text}",
      "      onChange={(e) => onUpdate({ text: e.target.value })}",
      "    />",
      "  )",
      "}",
      "",
      `export const ConfigPanel: UnitConfigPanel = ${pascalCase(o.type)}Config`,
      "",
    ].join("\n")
  }
  if (o.kind === "use-case") {
    return [
      'import type { UnitConfigPanel } from "../exec-kit"',
      "",
      "// No settings yet: add the node's own here (planTier, instructions … — what",
      "// use-case.ts's body accepts), written with onUpdate. `nodeId` is the node the",
      "// panel shows: a use-case panel reads its run (review, Continue) by it.",
      "export const ConfigPanel: UnitConfigPanel = ({ nodeId }) => <div data-node-id={nodeId} />",
      "",
    ].join("\n")
  }
  return [
    'import type { UnitConfigPanel } from "../exec-kit"',
    "",
    "// No settings yet. A provider-aware dropdown added here needs the fail-safe",
    "// useEffect([currentProvider]) that snaps a stale value to a valid option",
    "// (root CLAUDE.md, Provider Enum Sync step 12b).",
    "export const ConfigPanel: UnitConfigPanel = () => null",
    "",
  ].join("\n")
}

/** frontend/src/nodes/<type>/option.tsx — the add-node picker icon. */
export function optionTsx() {
  return ['import { Box } from "lucide-react"', 'import type { UnitOption } from "../kit"', "", "export const option: UnitOption = { icon: Box }", ""].join("\n")
}

/** frontend/src/nodes/<type>/api.ts — the client call of the unit's route. */
export function apiTs(o) {
  const c = camelCase(o.type)
  const result = o.kind === "worker" ? "{ jobId: string }" : "{ jobId: string; text: string }"
  return [
    'import { apiJson } from "@/lib/api"',
    "",
    `/** POST /v1/${o.type} — ${o.kind === "worker" ? "queues the job; the editor polls it" : "answers with the result"}. */`,
    `export async function ${c}Api(videoUrl: string): Promise<${result}> {`,
    `  return apiJson("/v1/${o.type}", { body: { videoUrl }, workflowId: true, label: "apiErr.startNodeRun" })`,
    "}",
    "",
  ].join("\n")
}

/** frontend/src/nodes/<type>/exec.ts — the editor's DAG executor. */
export function execTs(o) {
  const c = camelCase(o.type)
  if (o.kind === "worker") {
    return [
      'import type { UnitExecutor } from "../exec-kit"',
      `import { ${c}Api } from "./api"`,
      "",
      "export const executor: UnitExecutor = {",
      "  async execute(node, kit) {",
      "    const videoUrl = kit.overrideMediaUrl ?? kit.inputs.videoUrl",
      '    if (!videoUrl) throw new Error(kit.nodeRunError("nodeRun.noVideoInput"))',
      "    kit.setUserPromptTemplate(undefined)",
      `    return kit.runProcessingNode(() => ${c}Api(videoUrl), "generatedVideoUrl", String(node.data.label))`,
      "  },",
      "}",
      "",
    ].join("\n")
  }
  if (o.kind === "sync") {
    return [
      'import type { UnitExecutor } from "../exec-kit"',
      `import { ${c}Api } from "./api"`,
      "",
      "export const executor: UnitExecutor = {",
      "  async execute(_node, kit) {",
      "    const videoUrl = kit.overrideMediaUrl ?? kit.inputs.videoUrl",
      '    if (!videoUrl) throw new Error(kit.nodeRunError("nodeRun.noVideoInput"))',
      "    kit.setUserPromptTemplate(undefined)",
      `    const { text } = await ${c}Api(videoUrl)`,
      "    kit.updateNodeData({ outputText: text })",
      "    return text",
      "  },",
      "}",
      "",
    ].join("\n")
  }
  // inline
  return [
    'import type { UnitExecutor } from "../exec-kit"',
    `import type { ${dataInterfaceName(o.type)} } from "./types"`,
    "",
    `/** The node's work, from its own data. */`,
    `function compute(_data: ${dataInterfaceName(o.type)}): string {`,
    `  throw new Error(${JSON.stringify(notWritten(o.type, "the inline computation (exec.ts compute)"))})`,
    "}",
    "",
    "export const executor: UnitExecutor = {",
    "  async execute(node, kit) {",
    "    kit.setUserPromptTemplate(undefined)",
    `    const outputText = compute(node.data as ${dataInterfaceName(o.type)})`,
    "    kit.updateNodeData({ outputText })",
    "    return outputText",
    "  },",
    "}",
    "",
  ].join("\n")
}

const ROUTE_IMPORTS = [
  'import { z } from "zod"',
  'import type { UnitRoute } from "../kit.js"',
  'import { safeUrlSchema } from "../../lib/url-validator.js"',
  'import { creditGuard, reserveCreditsForJob } from "../../middleware/credit-guard.js"',
  'import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../../lib/request-helpers.js"',
  'import { buildJobInputData } from "../../lib/job-input-data.js"',
  'import { formatZodError } from "../../lib/zod-error.js"',
  'import { sendInternalError } from "../../lib/http-errors.js"',
]

/** backend/src/nodes/<type>/route.ts — the Fastify plugin (Zod body, creditGuard, the insert-job funnel). */
export function routeTs(o) {
  const head = [
    ...ROUTE_IMPORTS,
    ...(o.kind === "worker"
      ? ['import { insertJob } from "../../lib/insert-job.js"', 'import { videoQueue } from "../../lib/queue.js"']
      : [
          'import { insertSyncJob } from "../../lib/insert-job.js"',
          'import { markJobFailed } from "../../lib/job-failure.js"',
          'import { commitJobCredits, markJobCompleted, refundJobCredits } from "../../workers/shared.js"',
        ]),
    "",
    `const TYPE = ${JSON.stringify(o.type)}`,
    "",
    "// The caller is req.userId (auth), never the body. A top-level schema is a",
    "// z.object(...) of plain fields: G7 refuses a call chain (z.string().min(1)) at",
    "// the top of a unit module — build such a field inside the route instead.",
    "const Body = z.object({ videoUrl: safeUrlSchema })",
    "",
  ]
  const prelude = [
    "export const route: UnitRoute = async (app) => {",
    "  app.post(`/v1/${TYPE}`, { preHandler: creditGuard(() => TYPE) }, async (req, reply) => {",
    "    const parsed = Body.safeParse(req.body)",
    '    if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })',
    "    const userId = req.userId",
    '    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })',
    "    const input = parsed.data",
    "",
  ]
  const jobRow = (insert) => [
    `    const { data: job, error } = await ${insert}(req, {`,
    "      workflow_id: extractWorkflowId(req.body),",
    "      node_id: extractNodeId(req.body),",
    "      force_private: extractForcePrivate(req.body) || undefined,",
    "      user_id: userId,",
    '      status: "pending",',
    "      input_data: buildJobInputData(parsed.data, TYPE),",
    "    })",
    '    if (error) return sendInternalError(reply, req, error, "Failed to create job")',
    "    const reservation = await reserveCreditsForJob(req, reply, job.id, TYPE)",
    "    if (reply.sent) return",
    "    const usageLogId = reservation?.usageLogId",
  ]
  if (o.kind === "worker") {
    return [
      ...head,
      ...prelude,
      ...jobRow("insertJob"),
      "",
      "    // The BullMQ job name is the node type: the video worker dispatches it to ./worker.ts.",
      "    await videoQueue.add(TYPE, { jobId: job.id, ...input, usageLogId })",
      "    return { jobId: job.id }",
      "  })",
      "}",
      "",
    ].join("\n")
  }
  return [
    ...head,
    "/** The node's work: one call that answers inside the request. */",
    "async function run(_input: { videoUrl: string }): Promise<string> {",
    `  throw new Error(${JSON.stringify(notWritten(o.type, "the sync step (route.ts run)"))})`,
    "}",
    "",
    ...prelude,
    ...jobRow("insertSyncJob"),
    "",
    "    try {",
    "      const text = await run(input)",
    "      const ok = await markJobCompleted(job.id, { output_data: { text } })",
    "      // Not completed: the job-policy result gate held or blocked it, or the job was",
    "      // cancelled. Its result never leaves through this response, and nothing is committed.",
    '      if (!ok) return reply.status(409).send({ error: { code: "result_withheld", message: "The result was withheld" } })',
    "      await commitJobCredits(usageLogId, job.id)",
    "      return { jobId: job.id, text }",
    "    } catch (err) {",
    `      const message = err instanceof Error ? err.message : ${JSON.stringify(`${o.label} failed`)}`,
    "      // Refund only the failure this call recorded (a job that already settled keeps its credits).",
    "      if (await markJobFailed(job.id, { error_message: message, extra: { output_data: { error: message } } })) await refundJobCredits(usageLogId, job.id, err)",
    '      return reply.status(502).send({ error: { code: "node_failed", message } })',
    "    }",
    "  })",
    "}",
    "",
  ].join("\n")
}

/** backend/src/nodes/<type>/payload.ts — the orchestrator payload (a server-run workflow). */
export function payloadTs(o) {
  return [
    'import type { UnitPayload } from "../kit.js"',
    "",
    "export const payload: UnitPayload = (kit) =>",
    `  kit.ffmpegResult(${JSON.stringify(o.type)}, { jobId: kit.jobId, videoUrl: kit.resolvedInputs.videoUrl || kit.data.videoUrl, usageLogId: kit.usageLogId })`,
    "",
  ].join("\n")
}

/** backend/src/nodes/<type>/worker.ts — the BullMQ handler on execution.queue. */
export function workerTs(o) {
  return [
    'import type { UnitWorker } from "../kit.js"',
    'import { completeFfmpegVideoJob } from "../../workers/shared.js"',
    "",
    "/** The node's work: the input video in, the path of the output video file out. */",
    "async function render(_input: { videoUrl: string }): Promise<string> {",
    `  throw new Error(${JSON.stringify(notWritten(o.type, "the worker step (worker.ts render)"))})`,
    "}",
    "",
    "export const worker: UnitWorker = async (job, ctx) => {",
    "  const { videoUrl } = job.data as { jobId: string; videoUrl: string }",
    "  const outputPath = await render({ videoUrl })",
    "  // Uploads, thumbnails, completes the job and commits its credits.",
    "  await completeFfmpegVideoJob(outputPath, ctx)",
    "}",
    "",
  ].join("\n")
}

/** backend/src/nodes/<type>/use-case.ts — the request body and the /v1/nodes input schema of a use-case node. */
export function useCaseTs(o) {
  return [
    `// ${o.label}: its request body (the factory route POST /v1/${o.type} parses it) and its GET /v1/nodes input schema.`,
    `import { z } from "zod"`,
    `import { usecaseLaneShape, usecasePlanShape, usecaseRecordingShape } from "../../lib/use-case/body-shapes.js"`,
    `import type { UnitUseCase } from "../kit.js"`,
    ``,
    `export const body = z.object({ ...usecaseRecordingShape, ...usecasePlanShape, ...usecaseLaneShape })`,
    ``,
    `export const useCase: UnitUseCase = {`,
    `  body,`,
    `  inputSchema: { fields: [{ key: "mediaUrls", type: "video-url-array", required: true }, { key: "planTier", type: "string" }, { key: "instructions", type: "string" }] },`,
    `}`,
    ``,
  ].join("\n")
}

/** backend/src/nodes/<type>/price.ee.ts — the static credit row and the credit id a run reserves. */
export function priceTs(o) {
  if (o.kind === "use-case") {
    const fee = JSON.stringify(`use-case-fee:${o.type}`)
    return [
      "// Enterprise License (the .ee. filename). The per-run fee: a run reserves it on its",
      "// wrapper job, and its steps bill as their own jobs at their own rows. A price change",
      "// ships with its model_pricing seed migration (supabase/migrations/NNN_*.sql) in the",
      "// same PR: static-costs-match-migrations.test.ts holds the two together.",
      'import type { UnitPrice } from "../kit.js"',
      "",
      `export const staticCosts = { ${fee}: ${o.price} } as const`,
      "",
      `export const price: UnitPrice = { staticCosts, creditId: () => ${fee} }`,
      "",
    ].join("\n")
  }
  return [
    "// Enterprise License (the .ee. filename). A price change ships with its",
    "// model_pricing seed migration (supabase/migrations/NNN_*.sql) in the same PR:",
    "// static-costs-match-migrations.test.ts holds the two together.",
    'import type { UnitPrice } from "../kit.js"',
    "",
    `export const staticCosts = { ${JSON.stringify(o.type)}: ${o.price} } as const`,
    "",
    "export function creditId(): string {",
    `  return ${JSON.stringify(o.type)}`,
    "}",
    "",
    "export const price: UnitPrice = { staticCosts, creditId }",
    "",
  ].join("\n")
}

/** backend/src/nodes/<type>/characterize.char.ts — the ffmpeg characterization operation (opt-in suite). */
export function characterizeTs(o) {
  return [
    'import type { UnitCharacterization } from "../../providers/video/__characterization__/operation-types.js"',
    "",
    "// The ffmpeg characterization of this node (backend/src/providers/video/__characterization__/):",
    "// the harness names it by the unit's type, its golden key, and runs it after `after`. `run`",
    "// renders a fixture (FixtureSet: clipMp4, …) through the node's REAL provider function and",
    "// returns the files to measure; bless its golden inside the pinned-ffmpeg image.",
    "export const characterization: UnitCharacterization = {",
    `  after: ${JSON.stringify(o.characterizeAfter)},`,
    "  tier: 3,",
    "  run: async () => {",
    `    throw new Error(${JSON.stringify(notWritten(o.type, "its characterization (characterize.char.ts run)"))})`,
    "  },",
    "}",
    "",
  ].join("\n")
}
