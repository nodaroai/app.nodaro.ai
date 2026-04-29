import type { FC } from "react"

export interface McpConsentNoticeProps {
  kind: "user" | "dynamic_mcp" | "first_party_mcp" | string
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
  if (kind !== "dynamic_mcp") return null
  return (
    <div className="rounded-md border-l-4 border-orange-400 bg-orange-50 dark:bg-orange-950/40 p-3 my-3">
      <p className="text-sm text-orange-900 dark:text-orange-200">
        <strong>"{clientName}" was claimed via MCP.</strong> The client name is self-reported by
        the MCP client and was not verified by Nodaro. Verify the application requesting access
        is genuinely the one you're using before approving.{" "}
        <a
          href="/docs/mcp/troubleshooting"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Learn more
        </a>
      </p>
    </div>
  )
}
