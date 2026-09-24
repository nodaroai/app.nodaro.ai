import type { FC } from "react"
import type { DeveloperAppKind } from "@nodaro/sdk"
import { useT } from "@/lib/i18n"

export type { DeveloperAppKind }

export interface McpConsentNoticeProps {
  // `& {}` keeps autocomplete for known kinds while allowing forward-compat string values.
  kind: DeveloperAppKind | (string & {})
  clientName: string
}

/**
 * Warns the user when an OAuth client was registered via RFC 7591 Dynamic Client
 * Registration (kind === "dynamic_mcp"). For DCR clients, the displayed name is
 * self-reported by the MCP client and is not verified by Nodaro, so the user
 * should confirm the requesting application is genuine before approving.
 *
 * Returns null for any other kind ("user", "first_party_mcp", etc).
 */
export const McpConsentNotice: FC<McpConsentNoticeProps> = ({ kind, clientName }) => {
  const t = useT()
  if (kind !== "dynamic_mcp") return null
  return (
    <div className="rounded-md border-s-4 border-orange-400 bg-orange-50 dark:bg-orange-950/40 p-3 my-3">
      <p className="text-sm text-orange-900 dark:text-orange-200">
        <strong>{t("oauth.mcpClaimed", { name: clientName })}</strong> {t("oauth.mcpSelfReported")}{" "}
        <a
          href="/docs/mcp/troubleshooting"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {t("common.learnMore")}
        </a>
      </p>
    </div>
  )
}
