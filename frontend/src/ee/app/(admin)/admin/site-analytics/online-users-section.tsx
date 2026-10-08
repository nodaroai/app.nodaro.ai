import { Loader2 } from "lucide-react"
import { Link } from "react-router-dom"
import { clockText } from "./format"
import { SectionShell } from "./parts"
import { agoText, countryText, deviceText } from "./presence-format"
import type { OnlineSurface, OnlineUser, OnlineUsersReport } from "./types"
import { useIdle } from "./use-idle"
import { REALTIME_IDLE_MS, useOnlineUsers } from "./use-site-analytics"

/** The admin users page, opened on this person. */
export const adminUserLink = (userId: string): string => `/admin/users?user=${encodeURIComponent(userId)}`

function subtitleOf(data: OnlineUsersReport | undefined, idle: boolean, failed: Error | null): string | undefined {
  if (idle) return `Paused after ${REALTIME_IDLE_MS / 60_000} minutes without activity — move the mouse to resume`
  if (failed && data) return `Could not refresh (${failed.message}) — showing ${clockText(data.checkedAt)}`
  if (!data) return undefined
  return `People with Nodaro open in the last ${data.windowMinutes} minutes — an open tab counts, even idle · updated ${clockText(data.checkedAt)}`
}

/**
 * Who is signed in right now, on which surface (the app, the studio, the
 * extension, an MCP client…), from which country and address — from the
 * server's own record of signed-in requests, so it names people, unlike
 * Google's anonymous count above. A name opens the person on the users page.
 */
export function OnlineUsersSection() {
  const idle = useIdle(REALTIME_IDLE_MS)
  const { data, error, isLoading } = useOnlineUsers(!idle)
  const count = data?.available ? ` · ${data.users.length}` : ""

  return (
    <SectionShell title={`Signed in now${count}`} subtitle={subtitleOf(data, idle, error)}>
      {isLoading && !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : !data ? (
        <p className="text-sm text-muted-foreground">{error?.message ?? "Failed to load who is signed in."}</p>
      ) : !data.available ? (
        <p className="text-sm text-muted-foreground">The server could not read who is signed in right now. It will try again.</p>
      ) : data.users.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is signed in right now.</p>
      ) : (
        <OnlineUsersTable users={data.users} />
      )}
    </SectionShell>
  )
}

function surfaceTitle(surface: OnlineSurface): string {
  return [surface.detail ?? surface.label, surface.address ?? "no address", countryText(surface.country), deviceText(surface.userAgent), agoText(surface.lastSeenAt)].join(" · ")
}

function OnlineUsersTable({ users }: { users: readonly OnlineUser[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-start py-2 font-medium">Person</th>
            <th className="text-start py-2 font-medium">Where</th>
            <th className="text-start py-2 font-medium">Country</th>
            <th className="text-start py-2 font-medium">IP</th>
            <th className="text-start py-2 font-medium">Device</th>
            <th className="text-end py-2 font-medium">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            // The latest surface speaks for the row; each badge carries its own on hover.
            const latest = user.surfaces[0]!
            return (
              <tr key={user.userId} className="border-b border-border/50 align-top">
                <td className="py-1.5 pe-3">
                  <Link to={adminUserLink(user.userId)} className="font-medium hover:underline">
                    {user.name ?? user.email ?? user.userId}
                  </Link>
                  {user.name && user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                </td>
                <td className="py-1.5 pe-3">
                  <div className="flex flex-wrap gap-1">
                    {user.surfaces.map((surface) => (
                      <span key={`${surface.source}|${surface.detail ?? ""}`} title={surfaceTitle(surface)} className="rounded border px-1.5 py-0.5 text-xs font-medium">
                        {surface.label}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-1.5 pe-3 whitespace-nowrap">{countryText(latest.country)}</td>
                <td className="py-1.5 pe-3 font-mono text-xs">{latest.address ?? "—"}</td>
                <td className="py-1.5 pe-3 whitespace-nowrap">{deviceText(latest.userAgent)}</td>
                <td className="py-1.5 text-end whitespace-nowrap">{agoText(user.lastSeenAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
