import { Check, Plus, User } from "lucide-react"
import { Link } from "react-router-dom"
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { hasOrganizations } from "@/lib/edition"
import { useWorkspace } from "@/ee/hooks/use-workspace"
import { pluralize } from "@/ee/lib/pluralize"

/**
 * Switching between the personal space and the workspaces someone belongs
 * to, rendered inside the sidebar's existing menu rather than as a control
 * of its own.
 *
 * It returns NOTHING at all on a build without organizations, and nothing
 * while the memberships are still loading — an empty switcher is a
 * permanent invitation to wonder what is missing.
 *
 * An account that belongs to NO organization is the third case and is
 * different: there is no list to show, but there is somewhere to go. Hiding
 * the whole section would orphan "Create organization" for exactly the
 * person it exists for, so the ways IN are shown without the empty list
 * above them.
 *
 * When a lookup FAILED (`status: "unavailable"`) the last known list is
 * still shown, because a cache blip is not a departure and hiding someone's
 * school over one is worse than showing it a minute stale.
 *
 * Archived workspaces stay listed and stay selectable — they are read-only,
 * not gone, and the work inside them is what someone is usually looking for.
 */
export function OrgSwitcherSection() {
  const { organizations, workspaces, activeWorkspaceId, status, setActiveWorkspace } = useWorkspace()

  if (!hasOrganizations()) return null
  if (status === "idle" || status === "loading") return null

  const belongsToNone = organizations.length === 0

  return (
    <>
      <DropdownMenuSeparator />
      {!belongsToNone && (
        <>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuItem className="px-3" onSelect={() => setActiveWorkspace(null)}>
            <User className="size-4" />
            <span className="flex-1">Personal</span>
            {activeWorkspaceId === null && <Check className="size-4" aria-label="Selected" />}
          </DropdownMenuItem>
        </>
      )}

      {organizations.map((org) => {
        const own = workspaces.filter((w) => w.orgId === org.id)
        return (
          <div key={org.id}>
            <DropdownMenuLabel className="pt-2 text-xs font-normal text-muted-foreground">
              {org.name}
              {org.status === "pending" && " · awaiting approval"}
            </DropdownMenuLabel>

            {/* The organization's own word, so a school says "classes". One
                expression, one text node — a JSX comment beside it would put
                whitespace nodes either side and split the string. */}
            {own.length === 0 && (
              <DropdownMenuItem disabled className="px-3 text-xs text-muted-foreground">
                {`No ${pluralize(org.vocabulary.workspace ?? "workspace").toLowerCase()} yet`}
              </DropdownMenuItem>
            )}

            {own.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                className="px-3"
                onSelect={() => setActiveWorkspace(workspace.id)}
              >
                <span className={cn("flex-1 truncate", workspace.archived && "text-muted-foreground")}>
                  {workspace.name}
                  {workspace.archived && " · archived"}
                </span>
                {activeWorkspaceId === workspace.id && <Check className="size-4" aria-label="Selected" />}
              </DropdownMenuItem>
            ))}
          </div>
        )
      })}

      {!belongsToNone && <DropdownMenuSeparator />}
      <DropdownMenuItem asChild className="px-3">
        <Link to="/org/new">
          <Plus className="size-4" />
          <span>Create organization</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild className="px-3">
        <Link to="/join">
          <span className="pl-6">Join with a code</span>
        </Link>
      </DropdownMenuItem>
    </>
  )
}
