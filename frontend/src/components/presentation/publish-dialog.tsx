import { useState, useCallback, useMemo } from "react"
import { Rocket, Copy, Check, Loader2, ExternalLink } from "lucide-react"
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
import { publishApp } from "@/lib/api"
import type { PresentationSettings, PresentationViewMode } from "@/hooks/use-workflow-store"
import { VIEW_MODES, ALL_VIEW_MODES } from "./view-mode-selector"

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

  const handlePublish = useCallback(async () => {
    if (!publishName.trim()) {
      toast.error("Name is required")
      return
    }
    setPublishing(true)
    try {
      const slug = publishSlug.trim() || undefined
      const result = await publishApp({
        workflowId,
        name: publishName.trim(),
        slug,
        description: publishDesc.trim() || undefined,
      })
      setPublishedSlug(result.slug)
      toast.success("App published!")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish")
    } finally {
      setPublishing(false)
    }
  }, [workflowId, publishName, publishSlug, publishDesc])

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Rocket className="h-4 w-4 mr-1" />
          Publish
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish App</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Publish as a standalone mini-app with its own URL, persistent run history, and versioning.
          </p>

          {publishedSlug ? (
            <>
              <div className="flex gap-2">
                <Input value={publishedUrl} readOnly className="text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopyPublished}>
                  {publishCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <a href={`/app/${publishedSlug}`} target="_blank" rel="noopener noreferrer" className="block w-full">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Open App
                </Button>
              </a>
            </>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium mb-1 block">App Name *</label>
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
                <p className="text-[11px] text-muted-foreground mt-1">Optional base slug — a random suffix is always appended for uniqueness</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Input
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  placeholder="What does this app do?"
                />
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
                            value={presentationSettings.compareLeft ?? ""}
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
                            value={presentationSettings.compareRight ?? ""}
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
                Publish App
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
