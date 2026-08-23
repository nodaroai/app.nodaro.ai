import { createClient, StaticTokenAuth, NodaroError, UnauthorizedError } from "@nodaro/sdk"
import pc from "picocolors"
import { getProfile } from "./config.js"
import { resolveWorkspace } from "./workspace.js"

/** Replaced at build time by tsup `define` from package.json; the fallback
 *  keeps source-mode runs (tsx / vitest) working. */
declare const __CLI_VERSION__: string | undefined
const CLI_VERSION = typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0-dev"

export function buildClient(profileName?: string): ReturnType<typeof createClient> {
  const { name, profile } = getProfile(profileName)
  if (!profile) {
    console.error(pc.red(`✗ no credentials for profile "${name}"`))
    console.error(pc.dim(`  run: nodaro auth login${profileName ? ` --profile ${profileName}` : ""}`))
    process.exit(1)
  }
  const { workspaceId } = resolveWorkspace(profile)
  return createClient({
    baseUrl: profile.baseUrl,
    auth: new StaticTokenAuth(profile.token),
    // Scope, not access — see ./workspace.ts. Absent means the personal space.
    ...(workspaceId ? { workspaceId } : {}),
    // Without this the CLI is indistinguishable from any other SDK consumer:
    // it IS an SDK consumer, so it would otherwise report `sdk/<sdk version>`
    // and every CLI-created job would be filed under the wrong surface.
    clientLabel: `cli/${CLI_VERSION}`,
  })
}

export function handleError(err: unknown): never {
  if (err instanceof UnauthorizedError) {
    console.error(pc.red("✗ unauthorized — token missing, expired, or invalid"))
    console.error(pc.dim("  run: nodaro auth login"))
    process.exit(1)
  }
  if (err instanceof NodaroError) {
    console.error(pc.red(`✗ ${err.message}`))
    if (err.code) console.error(pc.dim(`  code: ${err.code}`))
    process.exit(1)
  }
  if (err instanceof Error) {
    console.error(pc.red(`✗ ${err.message}`))
    process.exit(1)
  }
  console.error(pc.red("✗ unknown error"), err)
  process.exit(1)
}
