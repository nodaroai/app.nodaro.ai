import { Command } from "commander"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import kleur from "kleur"
import { configPath, deleteProfile, getProfile, setProfile } from "../config.js"
import { success, info, dim, warn, emit, type OutputOpts } from "../output.js"

const DEFAULT_BASE_URL = "https://api.nodaro.ai"

export function authCommand(): Command {
  const cmd = new Command("auth").description("manage credentials for one or more Nodaro instances")

  cmd
    .command("login")
    .description("save a token for a profile")
    .option("--profile <name>", "profile name", "production")
    .option("--token <token>", "API token (defaults to interactive prompt)")
    .option("--base-url <url>", "Nodaro base URL", DEFAULT_BASE_URL)
    .action(async (opts: { profile: string; token?: string; baseUrl: string }) => {
      const token = opts.token ?? (await promptToken())
      if (!token || !token.trim()) {
        warn("no token provided — aborting")
        process.exit(1)
      }
      setProfile(opts.profile, { baseUrl: opts.baseUrl, token: token.trim() })
      success(`saved profile "${opts.profile}" → ${opts.baseUrl}`)
      dim(`config: ${configPath()} (chmod 0600)`)
    })

  cmd
    .command("status")
    .description("show the current profile (token is masked)")
    .option("--profile <name>", "profile name (defaults to the configured default)")
    .option("--json", "machine-readable output")
    .action((opts: { profile?: string } & OutputOpts) => {
      const { name, profile } = getProfile(opts.profile)
      if (!profile) {
        if (opts.json) emit({ profile: name, signedIn: false }, opts)
        else warn(`no credentials for profile "${name}"`)
        process.exit(1)
      }
      if (opts.json) {
        emit({ profile: name, baseUrl: profile.baseUrl, tokenMasked: maskToken(profile.token), signedIn: true }, opts)
      } else {
        info(`profile:  ${kleur.cyan(name)}`)
        info(`baseUrl:  ${profile.baseUrl}`)
        info(`token:    ${maskToken(profile.token)}`)
      }
    })

  cmd
    .command("logout")
    .description("delete a stored profile")
    .option("--profile <name>", "profile name", "production")
    .action((opts: { profile: string }) => {
      if (deleteProfile(opts.profile)) {
        success(`removed profile "${opts.profile}"`)
      } else {
        warn(`profile "${opts.profile}" not found`)
        process.exit(1)
      }
    })

  return cmd
}

async function promptToken(): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true })
  // We can't easily suppress echo across platforms without an extra dep —
  // accept the visible-input trade-off for now (terminal pastes obscure
  // anyway). The token is whitespace-trimmed before save.
  process.stdout.write("token: ")
  const line = await rl.question("")
  rl.close()
  return line
}

function maskToken(token: string): string {
  if (token.length <= 12) return "****"
  return token.slice(0, 8) + "…" + token.slice(-4)
}
