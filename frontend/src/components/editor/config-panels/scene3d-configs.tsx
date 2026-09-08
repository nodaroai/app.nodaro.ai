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
import { COMPOSITION_RATIOS, PRO3D_ASPECT_RATIOS } from "./model-options"
import { adoptLocalRevision, findRevision, restoreContextPatch } from "@/lib/scene3d/revisions"
import { scene3DEditInput } from "@/lib/scene3d/scene-input"
import { planRevisionId } from "@/lib/scene3d/plan-view"
import { SCENE3D_REFERENCE_ROLES, DEFAULT_REFERENCE_ROLE } from "@/lib/scene3d/references"
import { PRO3D_RENDER_DEFAULT_REPAIR_PASSES, PRO3D_RENDER_LIMITS, PRO3D_RENDER_MAX_REPAIR_PASSES, PRO3D_RENDER_QUALITY_PROFILES, SCENE3D_BASIC_ENGINE, SCENE3D_BASIC_SCHEMA_VERSION, scene3DPlanSchemaVersion, resolveScene3DAuthoringEngine } from "@nodaro/shared"
import { useScene3DAdvancedEngines, useScene3DProCapabilities } from "@/lib/scene3d-pro-availability"
import { useT } from "@/lib/i18n"
import { isVideoUrl } from "@/lib/media-type"
import type { ConfigProps, SourceNodeInfo } from "./types"
import type { Generate3DSceneData, Edit3DSceneData, Pro3DRenderData, Scene3DRevisionEntry } from "@/types/nodes"

/** three.js is ~600KB — only pull it when a scene actually exists to show. */
const LazyScene3DPreview = lazy(() =>
  import("@/components/editor/scene3d/scene3d-preview-authenticated").then((m) => ({ default: m.Scene3DPreviewAuthenticated })),
)

/** The single LLM feature both 3D-scene nodes bill and route through. */
const SCENE3D_LLM_FEATURE = "3d-scene" as const

/** Every node whose data carries a scene revision — the shape SceneBlock and
 *  ReferenceRoles work on. */
type Scene3DNodeData = Generate3DSceneData | Edit3DSceneData | Pro3DRenderData

/** The subset that also lets the caller pick a model. 3D Render Pro is
 *  deliberately absent: its planner is fixed and server-owned. */
type Scene3DLlmNodeData = Generate3DSceneData | Edit3DSceneData

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

/**
 * Which authoring engine this node runs on.
 *
 * Rendered ONLY when the install actually reports an advanced engine: on every
 * deployment without one (every self-host, and the community edition by
 * construction) there is exactly one lane, and a one-option menu is a control
 * that can only confuse. `blender-local` reaches this list only when the
 * SERVER offered it — the deployment flag and the engine's own declaration are
 * both upstream of `scene3DAdvancedEngines()`, so the browser never has to
 * guess whether local pairing exists here.
 *
 * Basic is DISABLED once the node holds a v2 scene, because it is not a choice
 * the platform can honour: the Basic route parses v1 and a downgrade would
 * either 400 or author from a scene it cannot represent. The run-time refusal
 * in `resolveScene3DAuthoringEngine` says the same thing; this just says it
 * before the user presses Run.
 */
function AuthoringControls({
  data,
  onUpdate,
  plan,
}: {
  data: Scene3DLlmNodeData
  onUpdate: (d: Record<string, unknown>) => void
  plan?: Record<string, unknown>
}) {
  const t = useT()
  const engines = useScene3DAdvancedEngines()
  const choice = resolveScene3DAuthoringEngine({ requested: data.engine, plan, availableEngines: engines })
  const selected = data.engine ?? (choice.ok ? choice.engine ?? SCENE3D_BASIC_ENGINE : "blender-cloud")
  const showSelector = Boolean(engines?.length) || selected !== SCENE3D_BASIC_ENGINE
  const planVersion = scene3DPlanSchemaVersion(plan)
  const basicLocked = planVersion !== null && planVersion !== SCENE3D_BASIC_SCHEMA_VERSION
  const labels: Record<string, string> = {
    "blender-cloud": t("scene3dcfg.engineBlenderCloud"),
    "blender-local": t("scene3dcfg.engineBlenderLocal"),
  }
  return (
    <>
    {showSelector && <div>
      <Label htmlFor="scene3d-engine" className="mb-1.5 block text-xs">{t("scene3dcfg.engine")}</Label>
      <Select
        value={selected}
        onValueChange={(v) => onUpdate({ engine: v })}
      >
        <SelectTrigger id="scene3d-engine" className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={SCENE3D_BASIC_ENGINE} disabled={basicLocked}>
            {t("scene3dcfg.engineBasic")}
          </SelectItem>
          {selected !== SCENE3D_BASIC_ENGINE && !engines?.includes(selected) && (
            <SelectItem value={selected} disabled>{labels[selected] ?? selected}</SelectItem>
          )}
          {(engines ?? []).map((engine) => (
            <SelectItem key={engine} value={engine}>{labels[engine] ?? engine}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {!choice.ok ? choice.message : basicLocked ? t("scene3dcfg.engineBasicLocked") : t("scene3dcfg.engineHint")}
      </p>
    </div>}
    {choice.ok && choice.lane === "basic" && <LlmControls data={data} onUpdate={onUpdate} />}
    </>
  )
}

function LlmControls({ data, onUpdate }: { data: Scene3DLlmNodeData; onUpdate: (d: Record<string, unknown>) => void }) {
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
      <AuthoringControls data={data} onUpdate={onUpdate} />

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

/**
 * 3D Render Pro's panel.
 *
 * Deliberately the Generate panel MINUS the model controls: the planner is
 * fixed and server-owned, so there is nothing here for the user to pick that
 * the platform is not accountable for. Everything else — the prompt field with
 * its mappings and affixes, the reference roles, the scene block, the timing
 * and aspect settings — is the same, because it is the same kind of scene.
 */
export function Pro3DRenderConfig({
  data, onUpdate, sources, fieldMappings, onMapField, nodeRefs, refMap, variableDisplayMode, nodes, edges, nodeId,
}: ConfigProps<Pro3DRenderData> & { nodeId?: string }) {
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

  // WHERE the scene comes from — the same discriminated choice the wire makes,
  // surfaced as an explicit control. Inferring it from "is the prompt box
  // empty" would make the difference between authoring a scene and exporting
  // one an accident of typing.
  const sourceMode = data.sourceMode ?? "prompt"
  const isSceneSource = sourceMode === "scene"
  // Controls are offered from what the INSTALL says it can serve, never from
  // the contract's full vocabulary.
  const pro = useScene3DProCapabilities()
  const qualityProfiles = pro?.qualityProfiles ?? [...PRO3D_RENDER_QUALITY_PROFILES]
  const proAspectOptions = PRO3D_ASPECT_RATIOS.filter(
    (option) => !pro || pro.aspectRatios.includes(option.value as (typeof pro.aspectRatios)[number]),
  )
  const repairCeiling = pro?.maxRepairPasses ?? PRO3D_RENDER_MAX_REPAIR_PASSES
  const repairPassOptions = Array.from(
    { length: Math.max(0, Math.min(repairCeiling, PRO3D_RENDER_MAX_REPAIR_PASSES)) + 1 },
    (_, i) => i,
  )

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label className="mb-1.5 block text-xs">{t("pro3dcfg.source")}</Label>
        <Select value={sourceMode} onValueChange={(v) => onUpdate({ sourceMode: v as "prompt" | "scene" })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="prompt">{t("pro3dcfg.sourcePrompt")}</SelectItem>
            <SelectItem value="scene">{t("pro3dcfg.sourceScene")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {isSceneSource ? t("pro3dcfg.sourceSceneHint") : t("pro3dcfg.sourcePromptHint")}
        </p>
      </div>

      {isSceneSource && (
        <MappableField field="editPrompt" label={t("pro3dcfg.editPrompt")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <TagTextarea
            placeholder={t("pro3dcfg.editPromptPh")}
            value={data.editPrompt ?? ""}
            onChange={(v) => onUpdate({ editPrompt: v })}
            rows={2}
            className="text-sm"
            nodeRefs={nodeRefs}
            displayMode={variableDisplayMode}
            refMap={refMap}
          />
        </MappableField>
      )}

      {!isSceneSource && (
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
      )}

      {!isSceneSource && <ReferenceRoles data={data} onUpdate={onUpdate} sources={sources} />}

      <SceneBlock data={data} onUpdate={onUpdate} promptField="scenePrompt" nodeId={nodeId} />

      <div>
        <Label htmlFor="pro3d-repairs" className="mb-1.5 block text-xs">{t("pro3dcfg.budget")}</Label>
        <Select
          value={String(data.maxRepairPasses ?? PRO3D_RENDER_DEFAULT_REPAIR_PASSES)}
          onValueChange={(v) => onUpdate({ maxRepairPasses: parseInt(v, 10) })}
        >
          <SelectTrigger id="pro3d-repairs" className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {repairPassOptions.map((n) => (
              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Said out loud because each pass is paid work — a budget the user
            cannot see is a budget they cannot choose. */}
        <p className="mt-1 text-[10px] text-muted-foreground">{t("pro3dcfg.budgetHint")}</p>
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="settings">
          <AccordionTrigger className="text-xs py-2">{t("settings.title")}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-3 pt-1">
              {/* Only what this deployment says it can serve. Offering a
                  profile the engine rejects is a run that fails after the
                  user chose it. */}
              {qualityProfiles.length > 1 && (
                <div>
                  <Label htmlFor="pro3d-quality" className="mb-1.5 block text-xs">{t("pro3dcfg.quality")}</Label>
                  <Select value={data.quality ?? qualityProfiles[0]} onValueChange={(v) => onUpdate({ quality: v })}>
                    <SelectTrigger id="pro3d-quality" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {qualityProfiles.map((q) => (<SelectItem key={q} value={q}>{q}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* A scene source already HAS timing. Overriding it is an
                  explicit re-time request, and the fields stay off the wire
                  until the user asks — the platform rejects a conflict rather
                  than silently retiming someone's scene. */}
              {isSceneSource && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={data.overrideSourceTiming === true}
                    onChange={(e) => onUpdate({ overrideSourceTiming: e.target.checked })}
                  />
                  {t("pro3dcfg.retime")}
                </label>
              )}

              {(!isSceneSource || data.overrideSourceTiming === true) && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="pro3d-fps" className="mb-1.5 block text-xs">{t("field.fps")}</Label>
                      <Select value={String(data.fps)} onValueChange={(v) => onUpdate({ fps: parseInt(v, 10) })}>
                        <SelectTrigger id="pro3d-fps" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="24">24</SelectItem>
                          <SelectItem value="30">30</SelectItem>
                          <SelectItem value="60">60</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pro3d-duration" className="mb-1.5 block text-xs">{t("scriptcfg.durationS")}</Label>
                      <Input
                        id="pro3d-duration"
                        type="number"
                        min={PRO3D_RENDER_LIMITS.minDurationSeconds}
                        max={PRO3D_RENDER_LIMITS.maxDurationSeconds}
                        value={data.durationSeconds ?? ""}
                        onChange={(e) => onUpdate({ durationSeconds: e.target.value === "" ? undefined : parseInt(e.target.value, 10) })}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs">{t("field.aspectRatio")}</Label>
                    <AspectRatioSelector
                      options={proAspectOptions}
                      value={data.aspectRatio}
                      onValueChange={(v) => onUpdate({ aspectRatio: v })}
                    />
                  </div>
                </>
              )}
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
      <AuthoringControls data={data} onUpdate={onUpdate} plan={scene3DEditInput(nodeId, data.scenePlan, nodes, edges ?? [])} />

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
