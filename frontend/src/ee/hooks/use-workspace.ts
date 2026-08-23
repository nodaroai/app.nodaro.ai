import { useSyncExternalStore } from "react"
import {
  setActiveWorkspace,
  workspaceStore,
  type OrganizationSummary,
  type WorkspaceState,
  type WorkspaceSummary,
} from "@/lib/workspace-context"

/**
 * React bindings over the workspace seam, plus the vocabulary that renders
 * an organization's own words.
 *
 * The store itself is core plumbing (`@/lib/workspace-context`) because
 * `api.ts` reads it on every request. What is enterprise is everything
 * here: the components that show a switcher, and the labels that make a
 * workspace a Class in a school and a Team in a company.
 */

export type { OrganizationSummary, WorkspaceState, WorkspaceSummary } from "@/lib/workspace-context"
export {
  clearActiveWorkspaceAfterRefusal,
  getActiveWorkspaceId,
  getWorkspaceState,
  hydrateWorkspaces,
  resetWorkspaceState,
  setActiveWorkspace,
  ACTIVE_WORKSPACE_STORAGE_KEY,
} from "@/lib/workspace-context"

export function useWorkspace(): WorkspaceState & {
  activeWorkspace: WorkspaceSummary | null
  activeOrganization: OrganizationSummary | null
  setActiveWorkspace: typeof setActiveWorkspace
} {
  const snapshot = useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getSnapshot, workspaceStore.getSnapshot)
  const activeWorkspace = snapshot.workspaces.find((w) => w.id === snapshot.activeWorkspaceId) ?? null
  const activeOrganization = activeWorkspace
    ? (snapshot.organizations.find((o) => o.id === activeWorkspace.orgId) ?? null)
    : null
  return { ...snapshot, activeWorkspace, activeOrganization, setActiveWorkspace }
}

/**
 * The organization's own words for the shared concepts — a class in a
 * school, a team in a company. The UI renders these and never a hard-coded
 * "Class", so relabelling is a setting rather than a fork.
 *
 * Falls back to the team vocabulary, which is the neutral one: an interface
 * with no organization in view should not call anything a classroom.
 */
export const FALLBACK_VOCABULARY: Record<string, string> = Object.freeze({
  organization: "Organization",
  workspace: "Team",
  org_owner: "Owner",
  org_admin: "Admin",
  workspace_admin: "Lead",
  workspace_member: "Member",
  collaborator: "Collaborator",
  template: "Template",
  assignment: "Brief",
  submission: "Submission",
  submit_action: "Request review",
  budget_allocation: "Team budget",
  member_cap: "Member limit",
  join_code: "Join code",
  model_policy: "Model policy",
  safe_mode: "Safe mode",
})

export function useVocabulary(orgId?: string | null): Record<string, string> {
  const { organizations, activeOrganization } = useWorkspace()
  const org = orgId ? (organizations.find((o) => o.id === orgId) ?? null) : activeOrganization
  return org?.vocabulary ?? FALLBACK_VOCABULARY
}
