import { createClient, StaticTokenAuth, NodaroError, UnauthorizedError } from "@nodaro/client"
import kleur from "kleur"
import { getProfile } from "./config.js"

export function buildClient(profileName?: string): ReturnType<typeof createClient> {
  const { name, profile } = getProfile(profileName)
  if (!profile) {
    console.error(kleur.red(`✗ no credentials for profile "${name}"`))
    console.error(kleur.dim(`  run: nodaro auth login${profileName ? ` --profile ${profileName}` : ""}`))
    process.exit(1)
  }
  return createClient({
    baseUrl: profile.baseUrl,
    auth: new StaticTokenAuth(profile.token),
  })
}

export function handleError(err: unknown): never {
  if (err instanceof UnauthorizedError) {
    console.error(kleur.red("✗ unauthorized — token missing, expired, or invalid"))
    console.error(kleur.dim("  run: nodaro auth login"))
    process.exit(1)
  }
  if (err instanceof NodaroError) {
    console.error(kleur.red(`✗ ${err.message}`))
    if (err.code) console.error(kleur.dim(`  code: ${err.code}`))
    process.exit(1)
  }
  if (err instanceof Error) {
    console.error(kleur.red(`✗ ${err.message}`))
    process.exit(1)
  }
  console.error(kleur.red("✗ unknown error"), err)
  process.exit(1)
}
