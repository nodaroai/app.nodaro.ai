import { Command } from "commander"
import { authCommand } from "./commands/auth.js"
import { projectsCommand } from "./commands/projects.js"
import { workflowsCommand } from "./commands/workflows.js"
import { jobsCommand } from "./commands/jobs.js"
import { executionsCommand } from "./commands/executions.js"
import { appsCommand } from "./commands/apps.js"
import { nodesCommand } from "./commands/nodes.js"

// Resolve the package version at runtime so we don't need to bake it in.
// Falls back to "0.0.0-dev" when running from source via tsx.
function readVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../package.json").version as string
  } catch {
    return "0.0.0-dev"
  }
}

const program = new Command()
  .name("nodaro")
  .description("Nodaro command-line interface — list and run workflows, inspect jobs and executions, manage projects.")
  .version(readVersion(), "-v, --version")

program.addCommand(authCommand())
program.addCommand(projectsCommand())
program.addCommand(workflowsCommand())
program.addCommand(appsCommand())
program.addCommand(nodesCommand())
program.addCommand(jobsCommand())
program.addCommand(executionsCommand())

program.parseAsync().catch((err: unknown) => {
  // commander surfaces argparse failures with exit codes already; this catch
  // only fires for unexpected runtime errors that bypass per-command try/catch.
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
