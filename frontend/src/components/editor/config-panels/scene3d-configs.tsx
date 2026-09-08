"use client"

import { Suspense, useMemo } from "react"
import { toast } from "sonner"
import { saveScene3DEdit } from "@/lib/save-scene3d-edit"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { TagTextarea } from "./tag-textarea"
import { SnippetMenuButton } from "./snippet-menu-button"
import { useSnippetPool } from "@/hooks/queries/use-prompt-snippets-queries"
import { PromptFieldFinalView, PromptFieldModeToggle } from "./prompt-field-final-view"
import { useFinalPromptSegments } from "./use-final-prompt-segments"
import { usePromptFieldMode } from "@/hooks/use-prompt-field-mode"
import { LlmModelSelect } from "./llm-model-select"
import { ReasoningEffortSelect } from "./reasoning-effort-select"
import { MappableField } from "./mappable-field"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { COMPOSITION_RATIOS } from "./model-options"
import { adoptLocalRevision, findRevision, restoreContextPatch } from "@/lib/scene3d/revisions"
import { planRevisionId } from "@/lib/scene3d/plan-view"
import { SCENE3D_REFERENCE_ROLES, DEFAULT_REFERENCE_ROLE } from "@/lib/scene3d/references"
import { useT } from "@/lib/i18n"
import { isVideoUrl } from "@/lib/media-type"
import type { ConfigProps, SourceNodeInfo } from "./types"
import type { Generate3DSceneData, Edit3DSceneData, Scene3DRevisionEntry } from "@/types/nodes"

/** three.js is ~600KB — only pull it when a scene actually exists to show. */
const LazyScene3DPreview = lazy(() =>
  import("@/components/editor/scene3d/scene3d-preview-authenticated").then((m) => ({ default: m.Scene3DPreviewAuthenticated })),
)

/** The single LLM feature both 3D-scene nodes bill and route through. */
const SCENE3D_LLM_FEATURE = "3d-scene" as const

type Scene3DNodeData = Generate3DSceneData | Edit3DSceneData

/**
 * The scene block shared by both panels: preview, selection/lock state,
 * deterministic edits, revision restore and the stale-completion resolution.
 *
 * All of it is driven by `onUpdate`, so a change lands on the node exactly the
 * way a run does — no second write path to keep in sync.
 */
function SceneBlock({
  data,
  onUpdate,
  promptField,
  nodeId,
}: {
  nodeId?: string
  data: Scene3DNodeData
  onUpdate: (d: Record<string, unknown>) => void
  /** Which prompt field this node authors with — restoring a revision puts its
   *  prompt back into THIS field. */
  promptField: "scenePrompt" | "editPrompt"
}) {
  const t = useT()
  const scenePlan = data.scenePlan as Record<string, unknown> | undefined
  if (!scenePlan) return null

  return (
    <>
      <Separator />
      <Suspense fallback={<div className="text-xs text-muted-foreground py-2">{t("proccfg.loadingPreview")}</div>}>
        <LazyScene3DPreview
          scenePlan={scenePlan}
          selectedObjectIds={data.selectedObjectIds}
          lockedObjectIds={data.lockedObjectIds}
          history={data.sceneHistory}
          pendingPlan={data.scenePendingPlan as Record<string, unknown> | undefined}
          isGenerating={data.executionStatus === "running"}
          onEditOperations={nodeId ? (edit) => { void saveScene3DEdit(nodeId, edit).catch(() => toast.error(t("editor.saveFailed"))) } : undefined}
          onSelectionChange={(objectIds) => onUpdate({ selectedObjectIds: objectIds })}
          onLockChange={(objectIds) => onUpdate({ lockedObjectIds: objectIds })}
          onPlanChange={(plan, changeSummary) =>
            onUpdate(
              adoptLocalRevision(data.sceneHistory, plan, changeSummary, {
                ...(data.lockedObjectIds?.length ? { lockedObjectIds: data.lockedObjectIds } : {}),
                ...(data.selectedObjectIds?.length ? { selectedObjectIds: data.selectedObjectIds } : {}),
              }),
            )
          }
          onRestore={(revisionId) => {
            // Restoring makes an EXISTING revision active again. It never
            // rewrites or appends history — the revision is already in it.
            //
            // It also puts back the AUTHORING CONTEXT: a revision restored
            // without the prompt, model and locks that made it leaves the node
            // one Run away from producing something else entirely, which is the
            // opposite of what "restore" means. Only keys the revision actually
            // recorded are written (`onUpdate` with `undefined` CLEARS a field,
            // so spreading absent context would wipe the panel), and revisions
            // stored before context existed restore plan-only.
            const entry = findRevision(data.sceneHistory, revisionId)
            if (!entry) return
            onUpdate({
              scenePlan: entry.scenePlan,
              expectedRevisionId: entry.revisionId,
              changeSummary: entry.changeSummary,
              ...restoreContextPatch(entry.context, promptField),
            })
          }}
          onResolvePending={(adopt) => {
            const pending = data.scenePendingPlan as Record<string, unknown> | undefined
            if (!adopt || !pending) {
              onUpdate({ scenePendingPlan: undefined })
              return
            }
            onUpdate({
              scenePlan: pending,
              expectedRevisionId: planRevisionId(pending),
              scenePendingPlan: undefined,
            })
          }}
        />
      </Suspense>
    </>
  )
}

/**
 * Per-wired-reference role picker. The role is what tells the authoring model
 * whether an image is "what it looks like", "where things go" or "how it
 * moves" — the same picture means three different things under the three roles.
 */
function ReferenceRoles({
  data,
  onUpdate,
  sources,
}: {
  data: Scene3DNodeData
  onUpdate: (d: Record<string, unknown>) => void
  sources: ReadonlyArray<SourceNodeInfo>
}) {
  const t = useT()
  const wired = useMemo(
    () => sources.filter((s) => s.targetHandle === "references"),
    [sources],
  )
  const hasVideo = wired.some((source) => isVideoUrl(source.value))
    || data.references?.some((reference) => reference.kind === "video")
  if (wired.length === 0 && !hasVideo) return null
  const roles = data.referenceRoles ?? {}
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{t("cfgext.scene3dReferences")}</Label>
      {hasVideo && <p className="text-xs text-muted-foreground">{t("cfgext.scene3dVideoAnalysisCost")}</p>}
      {wired.map((source) => (
        <div key={source.id} className="grid grid-cols-[1fr_110px] items-center gap-1.5">
          <span className="text-[11px] truncate text-muted-foreground" title={source.label}>
            {source.label}
          </span>
          <Select
            value={roles[source.id] ?? (isVideoUrl(source.value) ? "motion" : DEFAULT_REFERENCE_ROLE)}
            onValueChange={(role) => onUpdate({ referenceRoles: { ...roles, [source.id]: role } })}
          >
            <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SCENE3D_REFERENCE_ROLES.map((role) => (
                <SelectItem key={role} value={role} className="text-[11px] capitalize">{role}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  )
}

function LlmControls({ data, onUpdate }: { data: Scene3DNodeData; onUpdate: (d: Record<string, unknown>) => void }) {
  return (
    <>
      <LlmModelSelect
        feature={SCENE3D_LLM_FEATURE}
        value={data.llmModel}
        onChange={(v) => onUpdate({ llmModel: v })}
      />
      <ReasoningEffortSelect
        feature={SCENE3D_LLM_FEATURE}
        modelId={data.llmModel}
        value={data.reasoningEffort}
        onChange={(v) => onUpdate({ reasoningEffort: v })}
      />
    </>
  )
}

export function Generate3DSceneConfig({
  data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode, nodes, edges, nodeId,
}: ConfigProps<Generate3DSceneData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("text", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "scenePrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.scenePrompt,
    promptField: "scenePrompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })

  return (
    <div className="flex flex-col gap-3">
      <LlmControls data={data} onUpdate={onUpdate} />

      <MappableField field="scenePrompt" label={t("cfgext.scene3dScene")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.scenePrompt || ""} onInsert={(v) => onUpdate({ scenePrompt: v })} target="prompt" media="text" />
        </span>
      }>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("imgcfg.promptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea
            placeholder={t("cfgext.scene3dPhScene")}
            value={data.scenePrompt ?? ""}
            onChange={(v) => onUpdate({ scenePrompt: v })}
            rows={3}
            className="text-sm"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>

      <ReferenceRoles data={data} onUpdate={onUpdate} sources={sources} />

      <SceneBlock data={data} onUpdate={onUpdate} promptField="scenePrompt" nodeId={nodeId} />

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">{t("settings.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="scene3d-fps" className="mb-1.5 block text-xs">{t("field.fps")}</Label>
                  <Select value={String(data.fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
                    <SelectTrigger id="scene3d-fps" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="scene3d-duration" className="mb-1.5 block text-xs">{t("scriptcfg.durationS")}</Label>
                  <Input
                    id="scene3d-duration"
                    type="number"
                    min={1}
                    max={60}
                    value={data.durationSeconds ?? ""}
                    onChange={(e) => onUpdate({ durationSeconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">{t("field.aspectRatio")}</Label>
                <AspectRatioSelector
                  options={COMPOSITION_RATIOS}
                  value={data.aspectRatio}
                  onValueChange={(v) => onUpdate({ aspectRatio: v })}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

export function Edit3DSceneConfig({
  data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode, nodes, edges, nodeId,
}: ConfigProps<Edit3DSceneData> & { nodeId?: string }) {
  const t = useT()
  const promptSnippets = useSnippetPool("text", "prompt")
  const promptFieldMode = usePromptFieldMode(nodeId ?? "", "editPrompt")
  const finalPrompt = useFinalPromptSegments({
    userPrompt: data.editPrompt,
    promptField: "editPrompt",
    consumerNodeId: nodeId,
    nodes,
    edges: edges ?? [],
    snippets: promptSnippets,
  })
  const history = data.sceneHistory as Scene3DRevisionEntry[] | undefined
  const lockedCount = data.lockedObjectIds?.length ?? 0

  return (
    <div className="flex flex-col gap-3">
      <LlmControls data={data} onUpdate={onUpdate} />

      <MappableField field="editPrompt" label={t("cfgext.scene3dEditInstruction")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} labelAction={
        <span className="inline-flex items-center gap-0.5">
          <PromptFieldModeToggle mode={promptFieldMode.mode} onToggle={promptFieldMode.toggle} />
          <SnippetMenuButton pool={promptSnippets} value={data.editPrompt || ""} onInsert={(v) => onUpdate({ editPrompt: v })} target="prompt" media="text" />
        </span>
      }>
        {promptFieldMode.mode === "final" ? (
          <PromptFieldFinalView
            segments={finalPrompt.promptSegments}
            plainText={finalPrompt.promptText}
            placeholder={t("imgcfg.promptPreviewEmpty")}
            minHeightRem={3 * 1.5}
          />
        ) : (
          <TagTextarea
            placeholder={t("cfgext.scene3dPhEdit")}
            value={data.editPrompt ?? ""}
            onChange={(v) => onUpdate({ editPrompt: v })}
            rows={3}
            className="text-sm"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
            snippets={promptSnippets}
          />
        )}
      </MappableField>

      <p className="text-[10px] text-muted-foreground -mt-1">
        {lockedCount > 0
          ? t("cfgext.scene3dLockedCount", { count: lockedCount })
          : t("cfgext.scene3dLockHint")}
      </p>

      <ReferenceRoles data={data} onUpdate={onUpdate} sources={sources} />

      {!data.scenePlan && (
        <p className="text-[11px] text-muted-foreground">{t("cfgext.scene3dConnectScene")}</p>
      )}

      <SceneBlock data={data} onUpdate={onUpdate} promptField="editPrompt" nodeId={nodeId} />

      {history && history.length > 0 && (
        <p className="text-[10px] text-muted-foreground">{t("cfgext.scene3dFreeEdits")}</p>
      )}
    </div>
  )
}
