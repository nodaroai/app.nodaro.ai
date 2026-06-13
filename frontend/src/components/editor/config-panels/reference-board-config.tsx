"use client"

import { useState, useRef, useEffect, memo } from "react"
import { X, Upload } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MappableField } from "./mappable-field"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import { ReferenceImageList } from "./reference-image-list"
import { PromptHelperButton } from "./prompt-helper-button"
import { PromptEditor } from "./prompt-editor"
import { useMediaEditor, MediaEditorModal } from "@/components/editor/media-editor"
import { prefetchModelCredits } from "@/ee/hooks/use-model-credits"
import {
  IMAGE_RESOLUTION_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  getAspectRatiosForModel,
  defaultResolutionFor,
  REFERENCE_BOARD_PROVIDER_OPTIONS,
} from "./model-options"
import { REFERENCE_BOARD_PROVIDERS, listBoardTemplates, buildBoardPrompt } from "@nodaro/shared"
import type { ReferenceBoardData, ManualReferenceImage } from "@/types/nodes"
import type { ConfigProps } from "./types"

// ---------------------------------------------------------------------------
// SOURCE SEGMENTED CONTROL
// ---------------------------------------------------------------------------
function SourceSegmented({
  value,
  onChange,
}: {
  value: "entity" | "image"
  onChange: (v: "entity" | "image") => void
}) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden w-full">
      {(["entity", "image"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={[
            "flex-1 py-1.5 text-xs font-medium transition-colors",
            value === v
              ? "bg-[#ff0073] text-white"
              : "bg-transparent text-muted-foreground hover:bg-muted",
          ].join(" ")}
          aria-pressed={value === v}
        >
          {v === "entity" ? "Entity" : "Image"}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BOARD TEMPLATE DROPDOWN
// ---------------------------------------------------------------------------
// Groups templates by entity kind and lets the user select one.
// On selection, seeds `data.prompt` with the built template prompt.
type TemplateMeta = { id: string; label: string; entityKind: string }

const ALL_TEMPLATES: TemplateMeta[] = [
  ...listBoardTemplates("character"),
  ...listBoardTemplates("location"),
  ...listBoardTemplates("object"),
]

function BoardTemplateSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  // Group by entityKind
  const groups: Record<string, TemplateMeta[]> = {}
  for (const t of ALL_TEMPLATES) {
    const k = t.entityKind
    if (!groups[k]) groups[k] = []
    groups[k]!.push(t)
  }
  const kindLabels: Record<string, string> = {
    character: "Character",
    location: "Location",
    object: "Object",
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Board Template">
        <SelectValue placeholder="Select a board template" />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(groups).map(([kind, templates]) => (
          <div key={kind}>
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {kindLabels[kind] ?? kind}
            </div>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </div>
        ))}
      </SelectContent>
    </Select>
  )
}

// ---------------------------------------------------------------------------
// MAIN CONFIG — ReferenceBoardConfig
// Mirrors GenerateImageConfig's structure + fail-safe useEffect (step 12b).
// ---------------------------------------------------------------------------
function ReferenceBoardConfigImpl({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
  nodes,
  edges,
  nodeRefs,
  refMap,
  variableDisplayMode,
  nodeId,
}: ConfigProps<ReferenceBoardData> & { nodeId?: string }) {
  // Prefetch credits for the two supported providers
  useEffect(() => {
    prefetchModelCredits([...REFERENCE_BOARD_PROVIDERS])
  }, [])

  const currentProvider = data.provider || "nano-banana-pro"

  const aspectRatioOptions = getAspectRatiosForModel(currentProvider)
  const resolutionOptions = IMAGE_RESOLUTION_OPTIONS[currentProvider]
  const qualityOptions = IMAGE_QUALITY_OPTIONS[currentProvider]

  // ── Provider-aware fail-safe useEffect (CLAUDE.md Provider Enum Sync step 12b) ──
  // When provider changes, snap stale aspectRatio / resolution / quality values
  // to a valid option for the new provider, or clear them when the new provider
  // has no such lever — otherwise the backend Zod enum rejects at generate-time.
  useEffect(() => {
    const updates: Partial<ReferenceBoardData> = {}

    const aspectValues = aspectRatioOptions.map((o) => o.value)
    if (data.aspectRatio && !aspectValues.includes(data.aspectRatio)) {
      updates.aspectRatio = aspectValues[0] ?? "1:1"
    }

    // Resolution: snap to a valid option or provider default; clear when lever absent.
    const flux2Default = defaultResolutionFor(currentProvider)
    if (resolutionOptions) {
      if (flux2Default) {
        const valid = resolutionOptions.some((o) => o.value === data.resolution)
        if (!valid && data.resolution !== flux2Default) updates.resolution = flux2Default
      } else if (data.resolution && !resolutionOptions.some((o) => o.value === data.resolution)) {
        updates.resolution = resolutionOptions[0]?.value
      }
    } else if (data.resolution !== undefined) {
      updates.resolution = undefined
    }

    // Quality: snap to first valid or clear.
    if (qualityOptions) {
      if (data.quality && !qualityOptions.some((o) => o.value === data.quality)) {
        updates.quality = qualityOptions[0]?.value
      }
    } else if (data.quality !== undefined) {
      updates.quality = undefined
    }

    // gpt-image-2 constraints (per KIE docs):
    //   • aspect_ratio = auto → resolution must be 1K
    //   • aspect_ratio = 1:1  → resolution cannot be 4K
    if (currentProvider === "gpt-image-2") {
      const ar = updates.aspectRatio ?? data.aspectRatio
      const res = updates.resolution ?? data.resolution
      if (ar === "auto" && res !== "1K") updates.resolution = "1K"
      else if (ar === "1:1" && res === "4K") updates.resolution = "2K"
    }

    if (Object.keys(updates).length > 0) {
      onUpdate(updates)
    }
  }, [currentProvider, data.aspectRatio]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Board template seeding ──────────────────────────────────────────────
  // No entity context here — the connected entity's name/description are only
  // available at execution time, where the route re-seeds. All BoardPromptContext
  // fields are optional, so the prompt degrades gracefully.
  function handleTemplateChange(id: string) {
    onUpdate({ boardTemplate: id, prompt: buildBoardPrompt(id, {}) })
  }

  // ── Reference image upload via MediaEditor ──────────────────────────────
  const [uploadingRefImage, setUploadingRefImage] = useState(false)
  const refImageInputRef = useRef<HTMLInputElement>(null)
  const mediaEditor = useMediaEditor({
    onComplete: async (results) => {
      const currentManual = [...(data.referenceImageUrls ?? [])]
      for (const result of results) {
        const url = result.processedUrl ?? result.uploadResult.url
        const newImg: ManualReferenceImage = { id: crypto.randomUUID(), url }
        currentManual.push(newImg)
      }
      onUpdate({ referenceImageUrls: currentManual })
      setUploadingRefImage(false)
    },
    onCancel: () => setUploadingRefImage(false),
  })

  function handleRefImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingRefImage(true)
    mediaEditor.openEditor(Array.from(files))
    if (refImageInputRef.current) refImageInputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── Source mode (entity vs. image) ──────────────────────────── */}
      <div>
        <Label className="text-xs mb-1.5 block">Source</Label>
        <SourceSegmented
          value={data.sourceMode ?? "image"}
          onChange={(v) => onUpdate({ sourceMode: v })}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {data.sourceMode === "entity"
            ? "Connect an entity node (Character / Location / Object) for consistent context"
            : "Connect or upload reference images directly"}
        </p>
      </div>

      {/* ── Board template ──────────────────────────────────────────── */}
      <MappableField
        field="boardTemplate"
        label="Board Template"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <BoardTemplateSelect
          value={data.boardTemplate ?? "character/full-board"}
          onChange={handleTemplateChange}
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Selecting a template seeds the prompt below — you can edit it freely after
        </p>
      </MappableField>

      <Separator />

      {/* ── Provider ────────────────────────────────────────────────── */}
      <MappableField
        field="provider"
        label="Provider"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
        providerCategory="image"
      >
        <Select
          value={currentProvider}
          onValueChange={(v) =>
            onUpdate({ provider: v as ReferenceBoardData["provider"] })
          }
        >
          <SelectTrigger aria-label="Provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REFERENCE_BOARD_PROVIDER_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label} — {opt.desc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </MappableField>

      {/* ── Prompt ──────────────────────────────────────────────────── */}
      <MappableField
        field="prompt"
        label="Prompt"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
        labelAction={
          <PromptHelperButton
            nodeType="generate-image"
            currentPrompt={data.prompt || ""}
            provider={currentProvider}
            aspectRatio={data.aspectRatio}
            onAccept={(prompt, modelChange) =>
              onUpdate({
                prompt,
                ...(modelChange && { [modelChange.field]: modelChange.value }),
              })
            }
          />
        }
      >
        <PromptEditor
          rows={3}
          value={data.prompt}
          onChange={(v) => onUpdate({ prompt: v })}
          placeholder="Describe the reference board… or select a template above to seed this field"
          nodeRefs={nodeRefs}
        />
      </MappableField>

      {/* ── Negative Prompt ─────────────────────────────────────────── */}
      <MappableField
        field="negativePrompt"
        label="Negative Prompt"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <Textarea
          rows={2}
          value={data.negativePrompt ?? ""}
          onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
          placeholder="Things to avoid…"
          className="resize-none text-sm"
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Appended to prompt as exclusion guidance
        </p>
      </MappableField>

      {/* ── Reference Images ─────────────────────────────────────────── */}
      <div>
        <input
          ref={refImageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleRefImageUpload}
        />
        <ReferenceImageList
          manualImages={data.referenceImageUrls ?? []}
          imageOrder={data.referenceImageOrder ?? []}
          wiredImages={[]}
          charRefImages={[]}
          maxImages={13}
          onUpdateManualImages={(imgs) => onUpdate({ referenceImageUrls: imgs })}
          onUpdateOrder={(order) => onUpdate({ referenceImageOrder: order })}
          onUpload={() => refImageInputRef.current?.click()}
          uploadingRef={uploadingRefImage}
        />
      </div>

      <MediaEditorModal editor={mediaEditor} />

      {/* ── Model Settings ──────────────────────────────────────────── */}
      <div className="pt-1">
        <Separator className="mb-3" />
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Model Settings
        </label>
        <div className="flex flex-col gap-3 mt-2">
          {/* Aspect Ratio */}
          <MappableField
            field="aspectRatio"
            label="Aspect Ratio"
            sources={sources}
            fieldMappings={fieldMappings}
            onMapField={onMapField}
          >
            <AspectRatioSelector
              options={aspectRatioOptions}
              value={data.aspectRatio || aspectRatioOptions[0]?.value || "1:1"}
              onValueChange={(v) => onUpdate({ aspectRatio: v })}
            />
          </MappableField>

          {/* Resolution — only when the provider exposes this lever */}
          {resolutionOptions && (
            <MappableField
              field="resolution"
              label="Resolution"
              sources={sources}
              fieldMappings={fieldMappings}
              onMapField={onMapField}
            >
              <Select
                value={data.resolution || resolutionOptions[0]?.value || "1K"}
                onValueChange={(v) => onUpdate({ resolution: v })}
              >
                <SelectTrigger aria-label="Resolution">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {resolutionOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MappableField>
          )}

          {/* Quality — only when the provider exposes this lever */}
          {qualityOptions && (
            <MappableField
              field="quality"
              label="Quality"
              sources={sources}
              fieldMappings={fieldMappings}
              onMapField={onMapField}
            >
              <Select
                value={data.quality || qualityOptions[0]?.value}
                onValueChange={(v) => onUpdate({ quality: v })}
              >
                <SelectTrigger aria-label="Quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {qualityOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MappableField>
          )}

          {/* Seed */}
          <div>
            <Label className="text-xs">Seed</Label>
            <Input
              type="number"
              min={0}
              className="mt-1"
              value={data.seed ?? ""}
              onChange={(e) => {
                const val = e.target.value
                onUpdate({ seed: val === "" ? undefined : parseInt(val, 10) })
              }}
              placeholder="Random (leave empty)"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Fixed seed for reproducible board layouts
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export const ReferenceBoardConfig = memo(ReferenceBoardConfigImpl)
