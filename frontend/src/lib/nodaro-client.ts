import {
  createClient as createNodaroClient,
  CallbackAuth,
  type NodaroClient,
} from "@nodaro/client"
import { createClient as createSupabaseClient } from "./supabase"

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
export const nodaroClient: NodaroClient = createNodaroClient({
  baseUrl: "",
  auth: new CallbackAuth(async () => {
    const supabase = createSupabaseClient()
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }),
})
