import { useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { McpConversation } from "@nodaro/sdk/workflows"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAuth } from "@/hooks/use-auth"
import { useMcpConversations } from "@/hooks/queries/use-mcp-conversations"
import { useUpdateMcpFlowsMutation, useUserSettings } from "@/hooks/queries/use-user-settings-queries"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { exportWorkflow } from "@/lib/api"
import { createClient } from "@/lib/supabase"
import { useT } from "@/lib/i18n"
import { queryKeys } from "@/lib/query-keys"
import { ConversationCard, type ConversationAction } from "./conversation-card"
import { CopyToProjectDialog } from "./copy-to-project-dialog"
import { MonthPicker } from "./month-picker"
import { SourceFilter } from "./source-filter"

interface McpConversationsViewProps {
  /** The home screen's Jump back in search text: matches a conversation's name and first request. */
  readonly search?: string
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/** Download a flow as a JSON template, as the editor's Export does. */
async function downloadJson(workflowId: string, name: string): Promise<void> {
  const bundle = await exportWorkflow(workflowId, { assets: false })
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${(name || "conversation").replace(/[^a-z0-9]/gi, "-").toLowerCase()}-template.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * The MCP Conversations tab: one month of the flows assistants built from
 * their conversations, with a year/month picker, a source filter, and the
 * switch that turns the feature on or off.
 */
export function McpConversationsView({ search = "" }: McpConversationsViewProps) {
  const t = useT()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [sources, setSources] = useState<readonly string[]>([])
  const { data, isLoading } = useMcpConversations(month, sources)
  const { data: settings } = useUserSettings(user?.id)
  const flowsMutation = useUpdateMcpFlowsMutation()
  const renameWorkflow = useProjectsStore((s) => s.renameWorkflow)
  const deleteWorkflow = useProjectsStore((s) => s.deleteWorkflow)
  const [copyTarget, setCopyTarget] = useState<McpConversation | null>(null)
  const [renameTarget, setRenameTarget] = useState<McpConversation | null>(null)
  const [renameText, setRenameText] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<McpConversation | null>(null)

  // The month picked shows at once; the server's answer names it only before any pick.
  const shownMonth = month ?? data?.month ?? thisMonth()
  const counts = useMemo(() => new Map((data?.months ?? []).map((m) => [m.month, m.conversations])), [data])
  const needle = search.trim().toLowerCase()
  const conversations = (data?.data ?? []).filter(
    (c) => !needle || c.name.toLowerCase().includes(needle) || (c.firstRequest ?? "").toLowerCase().includes(needle),
  )
  const flowsEnabled = settings?.mcpFlowsEnabled ?? true

  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.mcpConversations.all })

  const onAction = async (action: ConversationAction, c: McpConversation) => {
    if (action === "copy") return setCopyTarget(c)
    if (action === "delete") return setDeleteTarget(c)
    if (action === "rename") {
      setRenameText(c.name)
      return setRenameTarget(c)
    }
    if (action === "export") {
      try {
        await downloadJson(c.id, c.name)
        toast.success(t("editor.exportedTemplate"))
      } catch {
        toast.error(t("apiErr.exportWorkflow"))
      }
      return
    }
    // A cover the user set is cleared, so the latest result shows again.
    const { error } = await createClient().from("workflows").update({ thumbnail_url: null }).eq("id", c.id)
    if (error) toast.error(t("mcpconv.coverFailed"))
    refresh()
  }

  return (
    <section aria-label={t("dash.mcpConversations")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker
            month={shownMonth}
            counts={counts}
            onChange={(next) => {
              // Sources are the month's own: a source picked in another month may have none here.
              setSources([])
              setMonth(next)
            }}
            currentMonth={thisMonth()}
          />
          <SourceFilter sources={data?.sources ?? []} selected={sources} onChange={setSources} />
        </div>
        {user && (
          <div className="flex items-center gap-2">
            <Switch
              id="mcp-flows-enabled"
              checked={flowsEnabled}
              disabled={flowsMutation.isPending}
              onCheckedChange={(enabled) =>
                flowsMutation.mutate({ userId: user.id, enabled }, { onError: () => toast.error(t("common.somethingWentWrong")) })
              }
            />
            <Label htmlFor="mcp-flows-enabled" className="cursor-pointer text-xs text-[var(--home-muted)]">
              {t("mcpconv.flowsSwitch")}
            </Label>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
        </div>
      ) : conversations.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {needle ? t("dash.noWorkflowsMatch") : flowsEnabled ? t("mcpconv.empty") : t("mcpconv.flowsOff")}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {conversations.map((c) => (
            <ConversationCard key={c.id} conversation={c} onAction={onAction} />
          ))}
        </div>
      )}

      <CopyToProjectDialog
        open={copyTarget !== null}
        onOpenChange={(open) => !open && setCopyTarget(null)}
        workflowId={copyTarget?.id ?? null}
        workflowName={copyTarget?.name ?? null}
      />

      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("mcpconv.renameTitle")}</DialogTitle>
          </DialogHeader>
          <Input
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            aria-label={t("mcpconv.renameTitle")}
            dir="auto"
            maxLength={200}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!renameText.trim()}
              onClick={async () => {
                if (!renameTarget) return
                await renameWorkflow(renameTarget.id, renameText.trim())
                setRenameTarget(null)
                refresh()
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t("mcpconv.deleteTitle")}
        description={t("mcpconv.deleteDesc")}
        warning={t("mcpconv.deleteWarning")}
        onConfirm={async () => {
          if (!deleteTarget) return
          await deleteWorkflow(deleteTarget.id)
          setDeleteTarget(null)
          refresh()
        }}
      />
    </section>
  )
}
