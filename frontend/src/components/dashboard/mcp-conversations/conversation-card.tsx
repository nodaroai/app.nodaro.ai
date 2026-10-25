import { Link } from "react-router-dom"
import { Copy, Download, ImageIcon, MessageSquare, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react"
import type { McpConversation } from "@nodaro/sdk/workflows"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useT, type MessageKey, type TFunction } from "@/lib/i18n"
import { formatDateTime, formatNumber } from "@/lib/i18n/format"
import { hasCredits } from "@/lib/edition"
import { cn } from "@/lib/utils"

export type ConversationAction = "export" | "copy" | "rename" | "delete" | "useLatestCover"

interface ConversationCardProps {
  readonly conversation: McpConversation
  readonly onAction: (action: ConversationAction, conversation: McpConversation) => void
}

/** "N images · M videos": a count that can be 1 has its own key in every language. */
function mediaCounts(counts: McpConversation["counts"], t: TFunction): string {
  const parts: string[] = []
  const add = (n: number, one: MessageKey, many: MessageKey) => {
    if (n > 0) parts.push(n === 1 ? t(one) : t(many, { n: formatNumber(n) }))
  }
  add(counts.image, "mcpconv.imagesOne", "mcpconv.images")
  add(counts.video, "mcpconv.videosOne", "mcpconv.videos")
  add(counts.audio, "mcpconv.audiosOne", "mcpconv.audios")
  return parts.join(t("common.listComma"))
}

function Cover({ cover }: { readonly cover: McpConversation["cover"] }) {
  if (!cover) return <ImageIcon className="h-7 w-7 text-muted-foreground" aria-hidden />
  if (cover.kind === "video") {
    return <video src={cover.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
  }
  return <img src={cover.url} alt="" loading="lazy" className="h-full w-full object-cover" />
}

/** One MCP conversation: its cover, source, start time, name, steps and credits. */
export function ConversationCard({ conversation: c, onAction }: ConversationCardProps) {
  const t = useT()
  const href = `/projects/${c.projectId}/workflows/${c.id}`
  const steps = c.nodeCount === 1 ? t("mcpconv.nodesOne") : t("mcpconv.nodes", { n: formatNumber(c.nodeCount) })
  const media = mediaCounts(c.counts, t)

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card transition-colors hover:bg-accent/30",
        c.live && "border-[#ff0073]/60 ring-1 ring-[#ff0073]/40",
      )}
    >
      <Link to={href} className="block">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-muted">
          <Cover cover={c.cover} />
          <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
            <MessageSquare className="h-3 w-3" aria-hidden />
            {c.clientLabel}
          </span>
          {c.live && (
            <span className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-full bg-cta px-2 py-0.5 text-[11px] font-semibold text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
              {t("mcpconv.live")}
            </span>
          )}
        </div>
        <div className="px-3 py-2">
          <p className="truncate text-sm font-medium" title={c.firstRequest ?? c.name} dir="auto">
            {c.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {formatDateTime(c.startedAt, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {media ? `${steps}${t("common.dashJoin")}${media}` : steps}
            {hasCredits() && c.credits !== null
              ? `${t("common.listComma")}${t("mcpconv.credits", { n: formatNumber(c.credits) })}`
              : ""}
          </p>
        </div>
      </Link>
      <div className="absolute bottom-2 end-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="h-7 w-7 p-0 shadow-sm" aria-label={t("dash.workflowOptions", { name: c.name })}>
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to={href}>{t("common.open")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("export", c)}>
              <Download className="me-2 h-3.5 w-3.5" aria-hidden />
              {t("mcpconv.exportJson")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("copy", c)}>
              <Copy className="me-2 h-3.5 w-3.5" aria-hidden />
              {t("mcpconv.copyToProject")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("rename", c)}>
              <Pencil className="me-2 h-3.5 w-3.5" aria-hidden />
              {t("common.rename")}
            </DropdownMenuItem>
            {c.cover?.setByUser && (
              <DropdownMenuItem onSelect={() => onAction("useLatestCover", c)}>
                <RefreshCw className="me-2 h-3.5 w-3.5" aria-hidden />
                {t("mcpconv.useLatestResult")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => onAction("delete", c)}>
              <Trash2 className="me-2 h-3.5 w-3.5" aria-hidden />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
