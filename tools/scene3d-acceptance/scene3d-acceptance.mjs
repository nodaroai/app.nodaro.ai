#!/usr/bin/env node
/**
 * The Scene3D / 3D Render Pro acceptance harness.
 *
 * Six probes, one per acceptance question, each leaving a committable JSON
 * receipt of what it did and what it measured. Run `--help` on any of them.
 *
 * Every probe here spends REAL CREDITS on a real deployment. There is no
 * "test mode" and no mock: what is being accepted is the deployed system, and
 * a harness that could pass against a fake would be worth nothing. What it
 * does instead is refuse to spend when it can tell the answer would be
 * meaningless — an unavailable capability exits 3 without running anything —
 * and never, ever resubmit a paid request whose outcome is unknown.
 */
import { SUBCOMMANDS, topUsage } from "./lib/args.mjs"
import { executeAsProcess, EXIT } from "./lib/harness.mjs"

const [subcommand, ...rest] = process.argv.slice(2)

if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
  process.stdout.write(`${topUsage()}\n`)
  process.exit(EXIT.pass)
}

if (!Object.hasOwn(SUBCOMMANDS, subcommand)) {
  process.stderr.write(`unknown subcommand "${subcommand}"\n\n${topUsage()}\n`)
  process.exit(EXIT.error)
}

const module = await import(`./commands/${subcommand}.mjs`)
await executeAsProcess(subcommand, rest, module.main)
