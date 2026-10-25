import { MessageSquare } from "lucide-react"
import { useT } from "@/lib/i18n"
import { formatDateTime } from "@/lib/i18n/format"
import { mcpClientLabel } from "@/lib/mcp-client-label"

/** What the server writes on a node an assistant made (`backend/src/lib/mcp/flows/record.ts`). */
interface McpProvenance {
  readonly tool?: string
  readonly client?: string
  readonly clientName?: string
  readonly userRequest?: string
  readonly at?: string
}

function provenanceOf(data: unknown): McpProvenance | null {
  const value = (data as { mcpProvenance?: unknown } | null)?.mcpProvenance
  return value && typeof value === "object" ? (value as McpProvenance) : null
}

/**
 * "Where it came from", first in the settings of a node an assistant made in
 * an MCP conversation: the user's own words, which assistant, and (under
 * Details) the tool it called and when. The node's own settings below are
 * what it ran with, and what a Run sends again.
 */
export function McpProvenanceSection({ data }: { readonly data: unknown }) {
  const t = useT()
  const provenance = provenanceOf(data)
  if (!provenance) return null
  const client = mcpClientLabel(provenance.client, provenance.clientName)
  return (
    <section className="mb-4 rounded-lg border border-[#ff0073]/30 bg-[#ff0073]/5 p-3" aria-label={t("mcpconv.provenanceTitle")}>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        <MessageSquare className="h-3.5 w-3.5 text-primary-ink" aria-hidden />
        {t("mcpconv.provenanceTitle")}
      </h3>
      {provenance.userRequest && (
        <div className="mb-2">
          <p className="text-[11px] text-muted-foreground">{t("mcpconv.youAsked")}</p>
          <p className="whitespace-pre-wrap text-sm" dir="auto">
            {provenance.userRequest}
          </p>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{t("mcpconv.viaClient", { client })}</p>
      {(provenance.tool || provenance.at) && (
        <details className="mt-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">{t("mcpconv.details")}</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {provenance.tool && (
              <>
                <dt>{t("mcpconv.tool")}</dt>
                <dd>
                  <code>{provenance.tool}</code>
                </dd>
              </>
            )}
            {provenance.at && (
              <>
                <dt>{t("mcpconv.madeAt")}</dt>
                <dd>{formatDateTime(provenance.at, { dateStyle: "medium", timeStyle: "short" })}</dd>
              </>
            )}
          </dl>
        </details>
      )}
    </section>
  )
}
