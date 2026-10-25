import { ChevronDown } from "lucide-react"
import type { McpConversationList } from "@nodaro/sdk/workflows"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"

type Source = McpConversationList["sources"][number]

/** The MCP clients always offered, greyed out when the month has none of theirs. */
const KNOWN_SOURCES: ReadonlyArray<{ readonly client: string; readonly label: string }> = [
  { client: "claude", label: "Claude" },
  { client: "claude-code", label: "Claude Code" },
  { client: "chatgpt", label: "ChatGPT" },
  { client: "codex", label: "Codex" },
  { client: "cursor", label: "Cursor" },
]

interface SourceFilterProps {
  readonly sources: readonly Source[]
  /** The sources kept; empty means every source. */
  readonly selected: readonly string[]
  readonly onChange: (selected: readonly string[]) => void
}

/** The known clients plus any other the month has, each with its count. */
export function sourceOptions(sources: readonly Source[]): Source[] {
  const byClient = new Map(sources.map((s) => [s.client, s]))
  const known = KNOWN_SOURCES.map((k) => byClient.get(k.client) ?? { ...k, conversations: 0, connections: [] })
  const others = sources.filter((s) => !KNOWN_SOURCES.some((k) => k.client === s.client))
  return [...known, ...others]
}

/** Several sources at once; a source's connections (named connectors) show on hover. */
export function SourceFilter({ sources, selected, onChange }: SourceFilterProps) {
  const t = useT()
  const options = sourceOptions(sources)
  const label =
    selected.length === 0
      ? t("mcpconv.allSources")
      : selected.length === 1
        ? options.find((o) => o.client === selected[0])?.label ?? selected[0]
        : t("mcpconv.sourcesSelected", { n: formatNumber(selected.length) })
  const toggle = (client: string, on: boolean) =>
    onChange(on ? [...selected, client] : selected.filter((c) => c !== client))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label={t("mcpconv.sourceFilter")}>
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {options.map((source) => (
          <DropdownMenuCheckboxItem
            key={source.client}
            checked={selected.includes(source.client)}
            disabled={source.conversations === 0}
            onCheckedChange={(on) => toggle(source.client, on === true)}
            onSelect={(e) => e.preventDefault()}
            title={source.connections.map((c) => t("mcpconv.connectionCount", { name: c.clientName, n: formatNumber(c.conversations) })).join("\n")}
          >
            <span className="flex-1">{source.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatNumber(source.conversations)}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {selected.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>{t("mcpconv.allSources")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
