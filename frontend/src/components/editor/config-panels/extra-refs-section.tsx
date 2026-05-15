"use client"

/**
 * Extra reference images section — a collapsible block rendered in each
 * image / video generator's config panel BELOW the prompt area, ABOVE the
 * normal references handle UI.
 *
 * An "extra ref" is a user-attached reference image whose intent is captured
 * by a per-ref `description`. At build time (see `execute-node.ts` /
 * `payload-builder.ts`) each row maps to a `ConnectedReference` entry that
 * carries `isExtraRef: true`; the shared `buildImagePrompt` then emits a
 * dedicated directive in the assembled prompt:
 *   - manual upload row →   "Image N (reference): <description>."
 *   - picked-from-character row whose character was ALSO mentioned/canonical-
 *     attached upstream →   "Image N is the same subject as Image M, <description>."
 *   - picked-from-character row whose character has NOT been emitted yet →
 *     a canonical-style directive using the description.
 *
 * The component is shared across Generate Image, Modify Image, Image-to-Video,
 * Text-to-Video, and Video-to-Video config panels.
 */

import { useMemo, useRef, useState } from "react"
import { Plus, X, Loader2, Upload, UserCircle, ChevronDown, ChevronRight } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { uploadImage } from "@/lib/api"
import { toast } from "sonner"
import { USAGE_MODES, type UsageMode, characterMentionSlug, usageModeLabel } from "@nodaro/shared"
import type {
  ExtraRef,
  WorkflowNode,
  WorkflowEdge,
  CharacterNodeData,
  CharacterAssetItem,
} from "@/types/nodes"

interface ExtraRefsSectionProps {
  readonly extraRefs: readonly ExtraRef[] | undefined
  readonly onChange: (next: readonly ExtraRef[]) => void
  readonly consumerNodeId: string | undefined
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
}

/** Single picker entry: a character variant the user can pick as an extra. */
interface CharacterVariantOption {
  readonly key: string                  // unique key for React lists
  readonly characterSlug: string
  readonly characterName: string
  readonly variantSlug: string | undefined
  readonly variantDisplayName: string
  readonly description: string          // pre-fill for the row description
  readonly url: string
}

/**
 * Walk back through edges from the consumer node, find wired Character
 * upstreams, and produce one option per (character × variant). The canonical
 * entry uses `variantSlug = undefined` and the character's `description` as
 * pre-fill; per-asset variants use the asset's `description` (or its name).
 */
function buildCharacterOptions(
  consumerNodeId: string | undefined,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): CharacterVariantOption[] {
  if (!consumerNodeId) return []
  const out: CharacterVariantOption[] = []
  const incoming = edges.filter((e) => e.target === consumerNodeId)
  for (const e of incoming) {
    const upstream = nodes.find((n) => n.id === e.source)
    if (!upstream || upstream.type !== "character") continue
    const charData = upstream.data as CharacterNodeData
    const charName = charData.characterName || (charData.label as string) || "Character"
    const slug = characterMentionSlug(charName)
    if (!slug) continue

    // Canonical entry (the character's portrait / source image).
    const canonicalUrl = charData.defaultAssetUrl as string | undefined
      ?? charData.sourceImageUrl
      ?? ""
    if (canonicalUrl) {
      out.push({
        key: `${upstream.id}__canonical`,
        characterSlug: slug,
        characterName: charName,
        variantSlug: undefined,
        variantDisplayName: "canonical",
        description: charData.description ?? "",
        url: canonicalUrl,
      })
    }

    // Asset variants — same set used by @-mention autocomplete elsewhere.
    const assetArrays: Record<string, readonly CharacterAssetItem[]> = {
      expressions: charData.expressions ?? [],
      poses: charData.poses ?? [],
      motions: charData.motions ?? [],
      angles: charData.angles ?? [],
      bodyAngles: charData.bodyAngles ?? [],
      lightingVariations: charData.lightingVariations ?? [],
    }
    for (const [arrayName, items] of Object.entries(assetArrays)) {
      for (const item of items) {
        if (!item.url) continue
        const variantSlug = characterMentionSlug(item.name)
        if (!variantSlug) continue
        out.push({
          key: `${upstream.id}__${arrayName}__${variantSlug}`,
          characterSlug: slug,
          characterName: charName,
          variantSlug,
          variantDisplayName: item.name,
          description: item.description ?? "",
          url: item.url,
        })
      }
    }
  }
  return out
}

/**
 * Group options by character so the picker can render a per-character section
 * with all its variants underneath. Stable order — insertion order from
 * `buildCharacterOptions` matches edge order.
 */
function groupByCharacter(
  options: readonly CharacterVariantOption[],
): ReadonlyArray<{ readonly characterSlug: string; readonly characterName: string; readonly variants: readonly CharacterVariantOption[] }> {
  const groups = new Map<string, { characterName: string; variants: CharacterVariantOption[] }>()
  for (const opt of options) {
    let g = groups.get(opt.characterSlug)
    if (!g) {
      g = { characterName: opt.characterName, variants: [] }
      groups.set(opt.characterSlug, g)
    }
    g.variants.push(opt)
  }
  return Array.from(groups, ([characterSlug, g]) => ({
    characterSlug,
    characterName: g.characterName,
    variants: g.variants,
  }))
}

export function ExtraRefsSection({
  extraRefs,
  onChange,
  consumerNodeId,
  nodes,
  edges,
}: ExtraRefsSectionProps) {
  const refs: readonly ExtraRef[] = extraRefs ?? []
  // Start collapsed when there are no extras; expanded once the user has
  // added one (so the rows are immediately visible after they pick).
  const [expanded, setExpanded] = useState<boolean>(refs.length > 0)
  const [uploading, setUploading] = useState(false)
  const [addPopoverOpen, setAddPopoverOpen] = useState(false)
  const [charPickerOpen, setCharPickerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const characterOptions = useMemo(
    () => buildCharacterOptions(consumerNodeId, nodes, edges),
    [consumerNodeId, nodes, edges],
  )
  const groupedOptions = useMemo(
    () => groupByCharacter(characterOptions),
    [characterOptions],
  )
  const hasCharacterUpstream = groupedOptions.length > 0

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    setAddPopoverOpen(false)
    try {
      const next: ExtraRef[] = [...refs]
      for (const file of Array.from(files)) {
        try {
          const { url } = await uploadImage(file)
          next.push({
            url,
            description: "",
          })
        } catch (err) {
          // uploadImage already toasts on failure; keep iterating other files.
          console.error("upload failed", err)
        }
      }
      onChange(next)
      setExpanded(true)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  function handlePickCharacter(opt: CharacterVariantOption) {
    const next: ExtraRef = {
      url: opt.url,
      description: opt.description,
      characterSlug: opt.characterSlug,
      variantSlug: opt.variantSlug,
      variantDisplayName: opt.variantDisplayName,
    }
    onChange([...refs, next])
    setCharPickerOpen(false)
    setAddPopoverOpen(false)
    setExpanded(true)
  }

  function removeRow(idx: number) {
    onChange(refs.filter((_, i) => i !== idx))
  }

  function updateRow(idx: number, patch: Partial<ExtraRef>) {
    const current = refs[idx]
    const next: ExtraRef = { ...current, ...patch }
    onChange(refs.map((r, i) => (i === idx ? next : r)))
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Extra reference images
          {refs.length > 0 && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary normal-case tracking-normal">
              {refs.length}
            </span>
          )}
        </button>
        <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Plus className="w-3 h-3 mr-1" />
              )}
              Add
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleUpload}
            />
            <button
              type="button"
              className="w-full flex items-center gap-2 px-2 py-2 text-xs rounded hover:bg-muted text-left"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-3.5 h-3.5 text-primary" />
              <div className="flex-1">
                <div className="font-medium">Upload from device</div>
                <div className="text-[10px] text-muted-foreground">PNG, JPG, WebP</div>
              </div>
            </button>
            {hasCharacterUpstream ? (
              <Popover open={charPickerOpen} onOpenChange={setCharPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-2 text-xs rounded hover:bg-muted text-left"
                  >
                    <UserCircle className="w-3.5 h-3.5 text-pink-500" />
                    <div className="flex-1">
                      <div className="font-medium">Pick from connected character</div>
                      <div className="text-[10px] text-muted-foreground">{groupedOptions.length} wired</div>
                    </div>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-1" side="left" align="start">
                  <div className="flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
                    {groupedOptions.map((group) => (
                      <div key={group.characterSlug}>
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase px-2 py-1">
                          {group.characterName}
                        </div>
                        {group.variants.map((opt) => (
                          <button
                            key={opt.key}
                            type="button"
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted text-left"
                            onClick={() => handlePickCharacter(opt)}
                          >
                            <div className="w-8 h-10 rounded overflow-hidden bg-muted flex-shrink-0">
                              {opt.url && (
                                <CachedImage
                                  src={opt.url}
                                  alt={opt.variantDisplayName}
                                  className="w-full h-full object-cover"
                                  thumbnail
                                  thumbnailWidth={80}
                                />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{opt.variantDisplayName}</div>
                              {opt.description && (
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {opt.description}
                                </div>
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            ) : (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground/60">
                <UserCircle className="w-3.5 h-3.5" />
                <div className="flex-1">
                  <div>Pick from connected character</div>
                  <div className="text-[10px]">No character wired</div>
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {expanded && (
        <div className="flex flex-col gap-1.5">
          {refs.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/60 px-1">
              Add extra images with per-image descriptions (e.g. &quot;full body, standing, facing right&quot;).
              Descriptions are injected as identity directives at generate time.
            </p>
          ) : (
            refs.map((ref, i) => (
              <ExtraRefRow
                key={`${ref.url}_${i}`}
                ref={ref}
                index={i}
                onRemove={() => removeRow(i)}
                onUpdate={(patch) => updateRow(i, patch)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

interface ExtraRefRowProps {
  readonly ref: ExtraRef
  readonly index: number
  readonly onRemove: () => void
  readonly onUpdate: (patch: Partial<ExtraRef>) => void
}

function ExtraRefRow({ ref, onRemove, onUpdate }: ExtraRefRowProps) {
  const label = ref.characterSlug
    ? `${ref.characterSlug}${ref.variantDisplayName ? ` / ${ref.variantDisplayName}` : ""}`
    : "Uploaded reference"
  return (
    <div className="flex gap-2 p-1.5 rounded border border-border/40 bg-background">
      <div className="w-12 h-16 rounded overflow-hidden bg-muted flex-shrink-0">
        {ref.url && (
          <CachedImage
            src={ref.url}
            alt={label}
            className="w-full h-full object-cover"
            thumbnail
            thumbnailWidth={96}
          />
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium truncate" title={label}>{label}</span>
          {ref.characterSlug && (
            <span className="text-[8px] px-1 py-0 rounded bg-pink-500/10 text-pink-500">character</span>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto p-0.5 rounded hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
            aria-label="Remove reference"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        <Textarea
          rows={2}
          className="text-xs min-h-[40px] resize-y"
          value={ref.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder="full body, standing, facing right…"
        />
        <Select
          value={ref.usageMode ?? "__inherit__"}
          onValueChange={(v) =>
            onUpdate({ usageMode: v === "__inherit__" ? undefined : (v as UsageMode) })
          }
        >
          <SelectTrigger className="h-6 text-[10px]" aria-label="Usage mode">
            <SelectValue placeholder="Inherit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__inherit__">Inherit</SelectItem>
            {USAGE_MODES.map((m) => (
              <SelectItem key={m} value={m}>{usageModeLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
