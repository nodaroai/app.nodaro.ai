import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { Rocket, Copy, Check, Loader2, ExternalLink, ChevronDown, ChevronRight, X, Store, AlertTriangle } from "lucide-react"
import type { WorkflowNode } from "@/types/nodes"
import { getNodeLabel } from "@/lib/presentation-utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { publishApp, getAppByWorkflow } from "@/lib/api"
import { getNodeResult, getOutputType } from "@/lib/presentation-utils"
import type { PresentationSettings, PresentationViewMode } from "@/hooks/use-workflow-store"
import { VIEW_MODES, ALL_VIEW_MODES } from "./view-mode-selector"
import { APP_CATEGORIES, OUTPUT_TYPES } from "@/lib/app-categories"
import { INPUT_FIELD_MAP, OUTPUT_FIELD_MAP } from "@nodaro-shared/component-types"

interface PublishDialogProps {
  workflowId: string
  presentationSettings?: PresentationSettings
  updatePresentationSettings?: (patch: Partial<PresentationSettings>) => void
  nodes?: WorkflowNode[]
}

export function PublishDialog({ workflowId, presentationSettings, updatePresentationSettings, nodes }: PublishDialogProps) {
  const [open, setOpen] = useState(false)
  const [publishName, setPublishName] = useState("")
  const [publishSlug, setPublishSlug] = useState("")
  const [publishDesc, setPublishDesc] = useState("")
  const [publishing, setPublishing] = useState(false)
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null)
  const [publishCopied, setPublishCopied] = useState(false)
  const [thumbnailNodeId, setThumbnailNodeId] = useState<string>("__none__")
  const [loadingExisting, setLoadingExisting] = useState(false)

  // Publish type (app vs component)
  const [publishType, setPublishType] = useState<"app" | "component">("app")

  // Component handle configuration
  const [componentHandles, setComponentHandles] = useState<{
    inputs: Array<{ id: string; name: string; type: string; required: boolean; fieldKey: string }>
    outputs: Array<{ id: string; name: string; type: string; required: boolean; mediaPreview: boolean; fieldKey: string }>
  }>({ inputs: [], outputs: [] })


  // Marketplace settings
  const [showMarketplace, setShowMarketplace] = useState(false)
  const [isListed, setIsListed] = useState(false)
  const [category, setCategory] = useState("other")
  const [outputTypes, setOutputTypes] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [supportsRemix, setSupportsRemix] = useState(false)

  // Reset all form state when dialog opens so we get a fresh fetch
  // (prevents stale publishedSlug from a prior publish from lingering)
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      setPublishedSlug(null)
      setPublishCopied(false)
      setPublishing(false)
    }
    setOpen(nextOpen)
  }, [])

  // Pre-fill from existing published app when dialog opens
  useEffect(() => {
    if (!open || !workflowId) return
    let cancelled = false
    setLoadingExisting(true)
    getAppByWorkflow(workflowId).then((app) => {
      if (cancelled) return
      if (!app) { setLoadingExisting(false); return }
      setPublishName(app.name)
      setPublishSlug(app.slug)
      setPublishDesc(app.description || "")
      setThumbnailNodeId(app.thumbnailNodeId || "__none__")
      setIsListed(app.isListed)
      setCategory(app.category || "other")
      setOutputTypes(app.outputTypes || [])
      setTags(app.tags || [])
      setSupportsRemix(app.supportsRemix)
      setPublishType(app.publishType || "app")
      if (app.isListed || app.category !== "other" || (app.tags && app.tags.length > 0)) {
        setShowMarketplace(true)
      }
      setLoadingExisting(false)
    })
    return () => { cancelled = true }
  }, [open, workflowId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive component handles from presentation-flagged nodes.
  // Uses a ref to only derive ONCE when switching to component mode,
  // so user edits (rename, delete) are not overwritten by re-derivation.
  const handlesInitialized = useRef(false)
  useEffect(() => {
    if (publishType !== "component") {
      setComponentHandles({ inputs: [], outputs: [] })
      handlesInitialized.current = false
      return
    }
    if (handlesInitialized.current || !nodes) return
    handlesInitialized.current = true

    const inputNodes = nodes.filter((n) => (n.data as Record<string, unknown>)?.presentationInput)
    const outputNodes = nodes.filter((n) => (n.data as Record<string, unknown>)?.presentationOutput)

    // Only source node types (text-prompt, upload-*, parameters) can be component
    // input handles. AI generation nodes (generate-image etc.) are NOT valid inputs —
    // their settings should be exposed settings, not input handles.
    const validInputNodes = inputNodes.filter((n) => INPUT_FIELD_MAP[n.type || ""])

    const inputs = validInputNodes.map((n) => {
      const nodeType = n.type || ""
      const outputType = getOutputType(nodeType)
      const handleType = outputType !== "data" ? outputType : "text"
      const fieldKey = INPUT_FIELD_MAP[nodeType] || "text"
      return {
        id: n.id,
        name: getNodeLabel(n),
        type: handleType,
        required: true,
        fieldKey,
      }
    })

    // Exclude from outputs: nodes already used as input handles,
    // AND nodes that are ONLY presentationInput (not also presentationOutput)
    // — those are input-config-only nodes, not true outputs.
    const inputIdSet = new Set(inputs.map((h) => h.id))
    const outputIdSet = new Set(outputNodes.map((n) => n.id))
    const inputOnlyIds = new Set(
      inputNodes.filter((n) => !outputIdSet.has(n.id)).map((n) => n.id),
    )
    const validOutputNodes = outputNodes.filter((n) =>
      !inputIdSet.has(n.id) && !inputOnlyIds.has(n.id),
    )

    const outputs = validOutputNodes.map((n, idx) => {
      const nodeType = n.type || ""
      const outputType = getOutputType(nodeType)
      const handleType = outputType !== "data" ? outputType : "text"
      const fieldKey = OUTPUT_FIELD_MAP[handleType] || "text"
      return {
        id: n.id,
        name: getNodeLabel(n),
        type: handleType,
        required: true,
        mediaPreview: idx === 0, // First output gets mediaPreview by default
        fieldKey,
      }
    })

    setComponentHandles({ inputs, outputs })
  }, [publishType, nodes])

  // Build exposed settings fresh from current nodes — called at publish time
  // so it's never stale. Detects configurable fields from presentationInput
  // nodes that are NOT source types (e.g., generate-image settings).
  const CONFIGURABLE_FIELDS: Record<string, Array<{ field: string; label: string; type: "select" | "text" | "number" | "toggle" }>> = {
    "generate-image": [
      { field: "provider", label: "Model", type: "select" },
      { field: "aspectRatio", label: "Aspect Ratio", type: "select" },
      { field: "quality", label: "Quality", type: "select" },
      { field: "style", label: "Style", type: "text" },
    ],
    "image-to-video": [
      { field: "provider", label: "Model", type: "select" },
      { field: "duration", label: "Duration", type: "number" },
    ],
    "text-to-video": [
      { field: "provider", label: "Model", type: "select" },
      { field: "duration", label: "Duration", type: "number" },
    ],
    "text-to-speech": [
      { field: "provider", label: "Model", type: "select" },
      { field: "voiceId", label: "Voice", type: "select" },
    ],
    "generate-music": [
      { field: "provider", label: "Model", type: "select" },
    ],
  }

  const buildExposedSettingsFromNodes = useCallback(() => {
    if (!nodes) return []
    const inputNodes = nodes.filter((n) => (n.data as Record<string, unknown>)?.presentationInput)
    const nonSourceInputNodes = inputNodes.filter((n) => !INPUT_FIELD_MAP[n.type || ""])
    const settings: Array<{ nodeId: string; field: string; label: string; type: "select" | "text" | "number" | "toggle"; allowedValues?: unknown[]; defaultValue: unknown }> = []
    for (const node of nonSourceInputNodes) {
      const fields = CONFIGURABLE_FIELDS[node.type || ""]
      if (!fields) continue
      const nd = (node.data ?? {}) as Record<string, unknown>
      const label = getNodeLabel(node)
      for (const f of fields) {
        const val = nd[f.field]
        if (val !== undefined) {
          settings.push({ nodeId: node.id, field: f.field, label: `${label} — ${f.label}`, type: f.type, defaultValue: val })
        }
      }
    }
    return settings
  }, [nodes])

  const handlePublish = useCallback(async () => {
    if (!publishName.trim()) {
      toast.error("Name is required")
      return
    }
    setPublishing(true)
    try {
      const slug = publishSlug.trim() || undefined

      // Derive preview media from workflow nodes
      let previewMediaUrl: string | undefined
      let previewMediaType: string | undefined
      if (nodes) {
        const thumbId = thumbnailNodeId !== "__none__" ? thumbnailNodeId : null
        const thumbNode = thumbId ? nodes.find((n) => n.id === thumbId) : null
        if (thumbNode?.data) {
          const result = getNodeResult(thumbNode.data as Record<string, unknown>)
          if (result.url) {
            previewMediaUrl = result.url
            const otype = getOutputType(thumbNode.type)
            previewMediaType = otype === "video" ? "video" : "image"
          }
        }
        if (!previewMediaUrl) {
          for (const n of nodes) {
            const otype = getOutputType(n.type)
            if ((otype === "image" || otype === "video") && n.data) {
              const r = getNodeResult(n.data as Record<string, unknown>)
              if (r.url) {
                previewMediaUrl = r.url
                previewMediaType = otype
                break
              }
            }
          }
        }
      }

      const result = await publishApp({
        workflowId,
        name: publishName.trim(),
        slug,
        description: publishDesc.trim() || undefined,
        thumbnailNodeId: thumbnailNodeId === "__none__" ? null : thumbnailNodeId,
        // Marketplace fields
        isListed,
        category: category !== "other" ? category : undefined,
        outputTypes: outputTypes.length > 0 ? outputTypes : undefined,
        tags: tags.length > 0 ? tags : undefined,
        supportsRemix: supportsRemix || undefined,
        previewMediaUrl,
        previewMediaType,
        // Component fields
        publishType,
        componentMetadata: publishType === "component" ? {
          inputs: componentHandles.inputs.map((h) => ({ ...h, type: h.type as "image" | "video" | "audio" | "text" })),
          outputs: componentHandles.outputs.map((h) => ({ ...h, type: h.type as "image" | "video" | "audio" | "text" })),
          exposedSettings: buildExposedSettingsFromNodes(),
        } : undefined,
      })
      setPublishedSlug(result.slug)
      toast.success(publishType === "component" ? "Component published!" : "App published!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish")
    } finally {
      setPublishing(false)
    }
  }, [workflowId, publishName, publishSlug, publishDesc, thumbnailNodeId, isListed, category, outputTypes, tags, supportsRemix, publishType, componentHandles, buildExposedSettingsFromNodes])

  const publishedUrl = publishedSlug
    ? `${window.location.origin}/app/${publishedSlug}`
    : ""

  const handleCopyPublished = useCallback(() => {
    if (publishedUrl) {
      navigator.clipboard.writeText(publishedUrl)
      setPublishCopied(true)
      toast.success("Link copied")
      setTimeout(() => setPublishCopied(false), 2000)
    }
  }, [publishedUrl])

  // View mode settings
  const allowedModes = presentationSettings?.shareAllowedModes ?? ALL_VIEW_MODES
  const allowedSet = useMemo(() => new Set(allowedModes), [allowedModes])
  const defaultMode = presentationSettings?.shareDefaultMode ?? "horizontal"

  const handleToggleMode = useCallback((mode: PresentationViewMode) => {
    if (!updatePresentationSettings) return
    const current = presentationSettings?.shareAllowedModes ?? ALL_VIEW_MODES
    const currentSet = new Set(current)

    if (currentSet.has(mode)) {
      if (currentSet.size <= 1) return
      const next = current.filter((m) => m !== mode)
      const patch: Partial<PresentationSettings> = { shareAllowedModes: next }
      if (presentationSettings?.shareDefaultMode === mode) {
        patch.shareDefaultMode = next[0]
      }
      updatePresentationSettings(patch)
    } else {
      updatePresentationSettings({ shareAllowedModes: [...current, mode] })
    }
  }, [updatePresentationSettings, presentationSettings?.shareAllowedModes, presentationSettings?.shareDefaultMode])

  const handleDefaultModeChange = useCallback((mode: string) => {
    updatePresentationSettings?.({ shareDefaultMode: mode as PresentationViewMode })
  }, [updatePresentationSettings])

  const handleReadOnlyChange = useCallback((checked: boolean) => {
    updatePresentationSettings?.({ shareReadOnly: checked })
  }, [updatePresentationSettings])

  // Compare node options
  const nodeOptions = useMemo(() => {
    if (!nodes) return []
    return nodes.map((n) => ({ id: n.id, label: getNodeLabel(n) }))
  }, [nodes])

  const handleCompareChange = useCallback((side: "compareLeft" | "compareRight", nodeId: string) => {
    updatePresentationSettings?.({ [side]: nodeId })
  }, [updatePresentationSettings])

  const showSettings = !!updatePresentationSettings && !!presentationSettings
  const showCompareSettings = showSettings && allowedSet.has("compare")

  // Tag handling
  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase()
    if (!trimmed || tags.includes(trimmed) || tags.length >= 10) return
    setTags([...tags, trimmed])
    setTagInput("")
  }, [tagInput, tags])

  const handleRemoveTag = useCallback((tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }, [tags])

  const handleToggleOutputType = useCallback((type: string) => {
    setOutputTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    )
  }, [])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Rocket className="h-4 w-4 mr-1" />
          Publish
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publish {publishType === "component" ? "Component" : "App"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {publishType === "component"
              ? "Publish as a reusable component that can be used inside other workflows."
              : "Publish as a standalone mini-app with its own URL, persistent run history, and versioning."}
          </p>

          {loadingExisting ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : publishedSlug ? (
            <>
              <div className="flex gap-2">
                <Input value={publishedUrl} readOnly className="text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopyPublished}>
                  {publishCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setOpen(false)
                  window.open(`/app/${publishedSlug}`, "_blank")
                }}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Open {publishType === "component" ? "Component" : "App"}
              </Button>
            </>
          ) : (
            <>
              {/* Publish type selector */}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded-lg border p-2 text-sm font-medium transition-colors ${
                    publishType === "app" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                  onClick={() => setPublishType("app")}
                >
                  App
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded-lg border p-2 text-sm font-medium transition-colors ${
                    publishType === "component" ? "border-purple-400 bg-purple-400/10 text-purple-400" : "border-border text-muted-foreground"
                  }`}
                  onClick={() => setPublishType("component")}
                >
                  Component
                </button>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">{publishType === "component" ? "Component" : "App"} Name *</label>
                <Input
                  value={publishName}
                  onChange={(e) => setPublishName(e.target.value)}
                  placeholder="My AI App"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">URL Slug</label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground shrink-0">/app/</span>
                  <Input
                    value={publishSlug}
                    onChange={(e) => setPublishSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                    placeholder="auto-generated"
                    className="text-xs"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Optional custom slug — leave blank to auto-generate. URL stays the same across versions.</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Input
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  placeholder="What does this app do?"
                />
              </div>

              {/* Component handle configuration */}
              {publishType === "component" && (
                <div className="space-y-3 border border-border rounded-lg p-3">
                  <h3 className="text-sm font-medium text-foreground">Component Handles</h3>

                  {componentHandles.inputs.length === 0 && componentHandles.outputs.length === 0 && (
                    <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 rounded-md p-2.5">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>No presentation inputs or outputs flagged. Mark nodes as presentation I/O in the workflow editor to define component handles.</span>
                    </div>
                  )}

                  {componentHandles.inputs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Inputs</p>
                      <div className="space-y-2">
                        {componentHandles.inputs.map((handle) => (
                          <div key={handle.id} className="flex items-center gap-2">
                            <Input
                              value={handle.name}
                              onChange={(e) => {
                                setComponentHandles((prev) => ({
                                  ...prev,
                                  inputs: prev.inputs.map((h) =>
                                    h.id === handle.id ? { ...h, name: e.target.value } : h,
                                  ),
                                }))
                              }}
                              className="h-8 text-xs flex-1"
                              placeholder="Handle name"
                            />
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              {handle.type}
                            </span>
                            {handle.required && (
                              <span className="text-[11px] text-amber-500 shrink-0">req</span>
                            )}
                            <button
                              type="button"
                              onClick={() => setComponentHandles((prev) => ({
                                ...prev,
                                inputs: prev.inputs.filter((h) => h.id !== handle.id),
                              }))}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {componentHandles.outputs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2">Outputs</p>
                      <div className="space-y-2">
                        {componentHandles.outputs.map((handle) => (
                          <div key={handle.id} className="flex items-center gap-2">
                            <Input
                              value={handle.name}
                              onChange={(e) => {
                                setComponentHandles((prev) => ({
                                  ...prev,
                                  outputs: prev.outputs.map((h) =>
                                    h.id === handle.id ? { ...h, name: e.target.value } : h,
                                  ),
                                }))
                              }}
                              className="h-8 text-xs flex-1"
                              placeholder="Handle name"
                            />
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              {handle.type}
                            </span>
                            <label className="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 cursor-pointer">
                              <input
                                type="radio"
                                name="mediaPreview"
                                checked={handle.mediaPreview}
                                onChange={() => {
                                  setComponentHandles((prev) => ({
                                    ...prev,
                                    outputs: prev.outputs.map((h) => ({
                                      ...h,
                                      mediaPreview: h.id === handle.id,
                                    })),
                                  }))
                                }}
                                className="h-3 w-3"
                              />
                              preview
                            </label>
                            <button
                              type="button"
                              onClick={() => setComponentHandles((prev) => ({
                                ...prev,
                                outputs: prev.outputs.filter((h) => h.id !== handle.id),
                              }))}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Marketplace Settings (collapsible) */}
              <div className="border border-border rounded-lg">
                <button
                  type="button"
                  className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors"
                  onClick={() => setShowMarketplace(!showMarketplace)}
                >
                  <span className="flex items-center gap-2">
                    <Store className="h-4 w-4" />
                    Marketplace Settings
                  </span>
                  {showMarketplace ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {showMarketplace && (
                  <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                    {/* List on marketplace toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">List on marketplace</p>
                        <p className="text-xs text-muted-foreground">Make discoverable in the Apps browse page</p>
                      </div>
                      <Switch checked={isListed} onCheckedChange={setIsListed} />
                    </div>

                    {/* Category */}
                    <div>
                      <p className="text-sm font-medium mb-1.5">Category</p>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger className="w-full h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {APP_CATEGORIES.map((cat) => (
                            <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Output types (multi-select checkboxes) */}
                    <div>
                      <p className="text-sm font-medium mb-1.5">Output types</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {OUTPUT_TYPES.map((ot) => (
                          <label
                            key={ot.value}
                            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer transition-colors ${
                              outputTypes.includes(ot.value)
                                ? "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/30"
                                : "text-muted-foreground border-border hover:border-zinc-400"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={outputTypes.includes(ot.value)}
                              onChange={() => handleToggleOutputType(ot.value)}
                            />
                            {ot.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Tags */}
                    <div>
                      <p className="text-sm font-medium mb-1.5">Tags <span className="text-xs text-muted-foreground font-normal">({tags.length}/10)</span></p>
                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 text-[11px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground"
                            >
                              {tag}
                              <button type="button" onClick={() => handleRemoveTag(tag)} className="hover:text-destructive">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5">
                        <Input
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          placeholder="Add a tag..."
                          className="h-8 text-xs flex-1"
                          maxLength={30}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag() } }}
                          disabled={tags.length >= 10}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={handleAddTag}
                          disabled={!tagInput.trim() || tags.length >= 10}
                        >
                          Add
                        </Button>
                      </div>
                    </div>

                    {/* RemX support toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Supports RemX</p>
                        <p className="text-xs text-muted-foreground">Users can customize and remix this app</p>
                      </div>
                      <Switch checked={supportsRemix} onCheckedChange={setSupportsRemix} />
                    </div>
                  </div>
                )}
              </div>

              {/* View mode settings */}
              {showSettings && (
                <div className="space-y-3 border-t border-border pt-3">
                  <h3 className="text-sm font-medium text-foreground">App Settings</h3>

                  {/* Read-only toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Read-only</p>
                      <p className="text-xs text-muted-foreground">Users can only see results, not edit inputs</p>
                    </div>
                    <Switch
                      checked={!!presentationSettings.shareReadOnly}
                      onCheckedChange={handleReadOnlyChange}
                    />
                  </div>

                  {/* Allowed view modes */}
                  <div>
                    <p className="text-sm font-medium mb-2">Allowed view modes</p>
                    <div className="flex items-center gap-1">
                      {VIEW_MODES.map(({ mode, icon: Icon, label }) => {
                        const isActive = allowedSet.has(mode)
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => handleToggleMode(mode)}
                            title={label}
                            className={`flex items-center justify-center w-9 h-8 rounded-md border transition-colors ${
                              isActive
                                ? "bg-[#ff0073]/10 text-[#ff0073] border-[#ff0073]/30"
                                : "text-muted-foreground/40 border-border hover:text-muted-foreground hover:border-border"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Default view mode */}
                  <div>
                    <p className="text-sm font-medium mb-1.5">Default view mode</p>
                    <Select value={defaultMode} onValueChange={handleDefaultModeChange}>
                      <SelectTrigger className="w-full h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIEW_MODES.filter((m) => allowedSet.has(m.mode)).map(({ mode, label }) => (
                          <SelectItem key={mode} value={mode}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Compare side defaults */}
                  {showCompareSettings && nodeOptions.length >= 2 && (
                    <div>
                      <p className="text-sm font-medium mb-1.5">Compare defaults</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Left</p>
                          <Select
                            value={presentationSettings.compareLeft || undefined}
                            onValueChange={(v) => handleCompareChange("compareLeft", v)}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue placeholder="Select node" />
                            </SelectTrigger>
                            <SelectContent>
                              {nodeOptions.map(({ id, label }) => (
                                <SelectItem key={id} value={id}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Right</p>
                          <Select
                            value={presentationSettings.compareRight || undefined}
                            onValueChange={(v) => handleCompareChange("compareRight", v)}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue placeholder="Select node" />
                            </SelectTrigger>
                            <SelectContent>
                              {nodeOptions.map(({ id, label }) => (
                                <SelectItem key={id} value={id}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Thumbnail node for runs list */}
                  {nodeOptions.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-1.5">Run thumbnail</p>
                      <p className="text-xs text-muted-foreground mb-1.5">
                        Select a node whose output will be shown as a thumbnail in the runs list
                      </p>
                      <Select value={thumbnailNodeId} onValueChange={setThumbnailNodeId}>
                        <SelectTrigger className="w-full h-9 text-sm">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {nodeOptions.map(({ id, label }) => (
                            <SelectItem key={id} value={id}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              <Button
                onClick={handlePublish}
                disabled={publishing || !publishName.trim()}
                className="w-full text-white hover:opacity-90"
                style={{ backgroundColor: "#ff0073" }}
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4 mr-2" />
                )}
                Publish {publishType === "component" ? "Component" : "App"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
