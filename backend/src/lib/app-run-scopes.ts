import type { Scope } from "./scopes.js"

/**
 * OAuth scopes for the published-app run routes (`/v1/app/:slug/...`).
 *
 * Starting, continuing, finishing and changing a run (run, resume,
 * render-final, the draft run, PATCH, delete, restore, permanent delete) need
 * `workflows:execute`, the scope the MCP `run_app` and `delete_app_run` tools
 * are registered under. So does running a published component
 * (`POST /v1/component/execute`), as the MCP `run_component` tool does.
 *
 * Reading the runner's runs (the run list, one run, and the archived runs at
 * `GET /v1/me/archived-runs`) passes with any of
 * these: `jobs:read` is the scope the app integration guide names for polling
 * a run, `assets:read` is the one the MCP `get_app_run` tool is registered
 * under, and `workflows:execute` lets an app that starts runs always poll
 * them. A refusal names the first.
 *
 * `GET /v1/app/:slug` is the public app loader (anonymous visitors, embeds)
 * and takes no scope.
 *
 * Known limit: `POST /v1/present/:token/run` (a presentation share link) is
 * not scope-checked here; the share token is that lane's authorization.
 *
 * The checks apply to developer-app OAuth tokens only: session, personal API
 * token and internal callers carry no `appAuthorization` and pass unchanged
 * (lib/scope-prehandler.ts).
 */
export const APP_RUN_READ_SCOPES: readonly [Scope, ...Scope[]] = ["jobs:read", "assets:read", "workflows:execute"]
