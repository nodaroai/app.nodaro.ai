import { useState, useCallback, useMemo } from "react"
import { Share2, Copy, Check, Loader2, Link2Off } from "lucide-react"
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
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useT, tx } from "@/lib/i18n"
import { getWorkflowAccess, isNotFoundError, shareWorkflow, unshareWorkflow, CredentialUnboundError, type UnboundCredentialUse } from "@/lib/api"
import { CredentialLockDialog } from "./credential-lock-dialog"
import { CollaboratorsPanel } from "./collaborators-panel"
import type { PresentationSettings, PresentationViewMode } from "@/hooks/use-workflow-store"
import { VIEW_MODES, ALL_VIEW_MODES } from "./view-mode-selector"
import { getNodeLabel } from "@/lib/presentation-utils"
import type { WorkflowNode } from "@/types/nodes"

interface ShareDialogProps {
  workflowId: string
  presentationSettings?: PresentationSettings
  updatePresentationSettings?: (patch: Partial<PresentationSettings>) => void
  nodes?: WorkflowNode[]
}

export function ShareDialog({ workflowId, presentationSettings, updatePresentationSettings, nodes }: ShareDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unboundUses, setUnboundUses] = useState<ReadonlyArray<UnboundCredentialUse> | null>(null)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const t = useT()

  // Asked only once the dialog is actually open. It is a per-workflow
  // authorization question, so it belongs to whoever is looking at it right
  // now — not to the editor's load path, which would pay for it on every
  // workflow anyone opens whether or not they ever share one.
  const { data: accessData, refetch } = useQuery({
    queryKey: ["workflow-access", workflowId],
    queryFn: () => getWorkflowAccess(workflowId),
    enabled: open,
    staleTime: 30_000,
  })
  const access = accessData?.data
  const refetchAccess = useCallback(() => { void refetch() }, [refetch])

  const shareUrl = shareToken
    ? `${window.location.origin}/present/${shareToken}`
    : ""

  const handleShare = useCallback(async () => {
    setLoading(true)
    try {
      const result = await shareWorkflow(workflowId)
      setShareToken(result.shareToken)
    } catch (err) {
      // The gate (409 credential_unbound): lock the credential(s) to the
      // node's address, then share again.
      if (err instanceof CredentialUnboundError) {
        if (err.details.length === 0) {
          // Refused, but nothing named to lock: say so rather than do nothing.
          toast.error(err.message)
          return
        }
        setUnboundUses(err.details)
        return
      }
      toast.error(err instanceof Error ? err.message : tx("present.failedToShare"))
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  const handleRevoke = useCallback(async () => {
    setLoading(true)
    try {
      await unshareWorkflow(workflowId)
      setShareToken(null)
      toast.success(tx("present.sharingDisabled"))
    } catch (err) {
      // Nothing to revoke (404) is the state the click asked for (#722).
      if (isNotFoundError(err)) {
        setShareToken(null)
        toast.success(tx("present.sharingDisabled"))
        return
      }
      toast.error(err instanceof Error ? err.message : tx("present.failedToRevoke"))
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  const handleCopy = useCallback(() => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      toast.success(tx("runner.linkCopied"))
      setTimeout(() => setCopied(false), 2000)
    }
  }, [shareUrl])

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

  const showSettings = shareToken && updatePresentationSettings && presentationSettings
  const showCompareSettings = showSettings && allowedSet.has("compare")

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="h-4 w-4 me-1" />
          {t("common.share")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("common.share")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Sharing with NAMED people, and the workspace-wide switch beside
              it. Above the presentation link rather than folded into it: a
              link is for anyone who has it and cannot be taken back from one
              person, a grant is for one person and can. They are different
              decisions and the dialog should not blur them. Absent until the
              server has answered who this caller is. */}
          {access && (
            <>
              <CollaboratorsPanel
                workflowId={workflowId}
                access={access}
                onVisibilityChanged={refetchAccess}
              />
              <div className="border-t" />
            </>
          )}

          <p className="text-sm text-muted-foreground">
            {t("present.shareDesc")}
          </p>

          {shareToken ? (
            <>
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly className="text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              {/* Share settings */}
              {showSettings && (
                <div className="space-y-4 border-t border-border pt-4">
                  <h3 className="text-sm font-medium text-foreground">{t("present.viewerSettings")}</h3>

                  {/* Read-only toggle */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{t("pubDialog.readOnlyLabel")}</p>
                      <p className="text-xs text-muted-foreground">{t("present.viewersOnlySeeResults")}</p>
                    </div>
                    <Switch
                      checked={!!presentationSettings.shareReadOnly}
                      onCheckedChange={handleReadOnlyChange}
                    />
                  </div>

                  {/* Allowed view modes */}
                  <div>
                    <p className="text-sm font-medium mb-2">{t("present.allowedViewModes")}</p>
                    <div className="flex items-center gap-1">
                      {VIEW_MODES.map(({ mode, icon: Icon, label }) => {
                        const isActive = allowedSet.has(mode)
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => handleToggleMode(mode)}
                            title={t(label)}
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
                    <p className="text-sm font-medium mb-1.5">{t("present.defaultViewMode")}</p>
                    <Select value={defaultMode} onValueChange={handleDefaultModeChange}>
                      <SelectTrigger className="w-full h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VIEW_MODES.filter((m) => allowedSet.has(m.mode)).map(({ mode, label }) => (
                          <SelectItem key={mode} value={mode}>{t(label)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Compare side defaults */}
                  {showCompareSettings && nodeOptions.length >= 2 && (
                    <div>
                      <p className="text-sm font-medium mb-1.5">{t("present.compareDefaults")}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">{t("common.left")}</p>
                          <Select
                            value={presentationSettings.compareLeft ?? ""}
                            onValueChange={(v) => handleCompareChange("compareLeft", v)}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue placeholder={t("present.selectNode")} />
                            </SelectTrigger>
                            <SelectContent>
                              {nodeOptions.map(({ id, label }) => (
                                <SelectItem key={id} value={id}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">{t("common.right")}</p>
                          <Select
                            value={presentationSettings.compareRight ?? ""}
                            onValueChange={(v) => handleCompareChange("compareRight", v)}
                          >
                            <SelectTrigger className="w-full h-8 text-xs">
                              <SelectValue placeholder={t("present.selectNode")} />
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
                variant="destructive"
                size="sm"
                onClick={handleRevoke}
                disabled={loading}
                className="w-full"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                ) : (
                  <Link2Off className="h-4 w-4 me-2" />
                )}
                {t("present.revokeSharing")}
              </Button>
            </>
          ) : (
            <Button
              onClick={handleShare}
              disabled={loading}
              className="w-full text-white hover:opacity-90"
              style={{ backgroundColor: "#ff0073" }}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 me-2 animate-spin" />
              ) : (
                <Share2 className="h-4 w-4 me-2" />
              )}
              {t("present.generateShareLink")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
    <CredentialLockDialog
      uses={unboundUses}
      onLocked={() => { setUnboundUses(null); void handleShare() }}
      onClose={() => setUnboundUses(null)}
    />
    </>
  )
}
