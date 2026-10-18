import type { ClientOptions } from "@nodaro/sdk/client"
import { NodaroClientCore, CallbackAuth } from "@nodaro/sdk/core"
import { DeveloperAppsResource } from "@nodaro/sdk/developer-apps"
import { ExecutionsResource } from "@nodaro/sdk/executions"
import { JobsResource } from "@nodaro/sdk/jobs"
import { NodesResource } from "@nodaro/sdk/nodes"
import { ProjectsResource } from "@nodaro/sdk/projects"
import { Scene3DResource } from "@nodaro/sdk/scene3d"
import { WorkflowsResource } from "@nodaro/sdk/workflows"
import { createClient as createSupabaseClient } from "./supabase"

/**
 * The SDK client this app uses: the SDK's core (config, auth, transport)
 * with ONLY the resources the app calls.
 *
 * Not `createClient()`'s full `NodaroClient`, on purpose: that one loads every
 * resource module, so every test reaching `api.ts` (most of the suite) would
 * depend on all of them, and a change to any SDK resource would select those
 * tests. Built from the core, the app — and its tests — load only these.
 *
 * Need another resource? Add it here as one more field, imported from its
 * subpath entry (`@nodaro/sdk/<resource>`). A resource that calls another
 * through the client (`nodes` polls through `jobs`, `scene3d` runs `nodes`)
 * says so in its constructor type, so forgetting the dependency fails tsc.
 */
export class AppNodaroClient extends NodaroClientCore {
  readonly executions = new ExecutionsResource(this)
  readonly jobs = new JobsResource(this)
  readonly nodes = new NodesResource(this)
  readonly scene3d = new Scene3DResource(this)
  readonly developerApps = new DeveloperAppsResource(this)
  readonly projects = new ProjectsResource(this)
  readonly workflows = new WorkflowsResource(this)
}

/**
 * Singleton Nodaro API client configured for the existing Vite proxy:
 * baseUrl="" so paths resolve same-origin (Caddy/Vite proxies /v1/* to backend).
 * Auth is sourced live from the Supabase session.
 *
 * For new code, prefer using this client directly:
 *
 *   import { nodaroClient } from "@/lib/nodaro-client"
 *   const { data } = await nodaroClient.executions.get(executionId)
 *
 * Legacy functions in api.ts delegate to this client where the SDK covers
 * the endpoint cleanly (executions resource), and otherwise still use raw
 * fetch for endpoints with bespoke error semantics (e.g. runWorkflow's
 * 409 -> WorkflowAlreadyRunningError) or routes the SDK doesn't expose
 * yet (callable workflows, workflow interface, sub-workflows, etc.).
 *
 * NOTE: Workflow CRUD (create/read/update/delete) is NOT routed through the
 * SDK because the frontend talks to Supabase REST directly for those
 * (see use-projects-store.ts, use-workflow-persistence.ts). The SDK's
 * `client.workflows.*` API surface is exercised by external consumers
 * (server-to-server scripts, third-party integrations) rather than by
 * this frontend.
 *
 * The auth callback is lazy — it doesn't invoke `createSupabaseClient()`
 * until a request is made. This keeps the singleton import-safe for tests
 * that mock `@/lib/supabase` after module load.
 */
export const NODARO_CLIENT_OPTIONS: ClientOptions = {
  baseUrl: "",
  auth: new CallbackAuth(async () => {
    const supabase = createSupabaseClient()
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }),
}

/**
 * Every SDK client the app builds takes {@link NODARO_CLIENT_OPTIONS} — this
 * one and the shared header's full client (`ee/shell/app-header.tsx`) — so a
 * base URL, auth, timeout or workspace set for one cannot miss the other.
 */
export const nodaroClient: AppNodaroClient = new AppNodaroClient(NODARO_CLIENT_OPTIONS)
