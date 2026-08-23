import { Command } from "commander"
import pc from "picocolors"
import { buildClient, handleError } from "../client.js"
import { getProfile } from "../config.js"
import { detail, dim, emit, info, success, table, warn, type OutputOpts } from "../output.js"
import { resolveWorkspace, saveWorkspace } from "../workspace.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * Where work lands.
 *
 * The whole group exists because a terminal has no switcher: a browser shows
 * the current workspace on every screen, and a shell shows nothing. So
 * `current` is not a convenience — it is the only way to answer "where am I"
 * before running something that creates.
 */
export function workspaceCommand(): Command {
  const cmd = new Command("workspace").description("choose which workspace the CLI works in")

  cmd
    .command("list")
    .description("the workspaces this account belongs to")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const { data, lastWorkspaceId } = await client.workspaces.list()
        if (opts.json) {
          emit({ data, lastWorkspaceId }, opts)
          return
        }
        if (data.length === 0) {
          info("this account belongs to no workspaces — everything happens in its personal space")
          return
        }
        const active = resolveWorkspace(getProfile(opts.profile).profile).workspaceId
        table(
          data.map((w) => ({
            id: w.id,
            name: w.name,
            role: w.role,
            archived: w.archived ? "yes" : "",
            active: w.id === active ? "←" : "",
          })),
          ["id", "name", "role", "archived", "active"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("current")
    .description("which workspace this profile is working in, and why")
    .option("--profile <name>")
    .option("--json")
    .action((opts: GlobalOpts) => {
      const { name, profile } = getProfile(opts.profile)
      const { workspaceId, source } = resolveWorkspace(profile)
      if (opts.json) {
        emit({ profile: name, workspaceId: workspaceId ?? null, source }, opts)
        return
      }
      info(`profile:    ${pc.cyan(name)}`)
      info(`workspace:  ${workspaceId ?? "(personal space)"}`)
      // Reported before the source, because "personal space" on a machine
      // with no token reads as an answer when it is really an absence.
      if (!profile) {
        warn(`no credentials for profile "${name}" — run: nodaro auth login`)
        return
      }
      if (!workspaceId) return
      // Naming the source is what makes a surprising answer debuggable: an
      // inherited NODARO_WORKSPACE looks identical to a saved one otherwise.
      dim(`from:       ${SOURCE_LABELS[source]}`)
    })

  cmd
    .command("use <id>")
    .description("remember this workspace for the profile")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        // Verified before it is saved: a workspace this account cannot work
        // in would fail every later command with nothing pointing back here.
        //
        // Checked against the LIST, not against `get`. `get` answers "may I
        // read this", and the two are not the same question: a platform
        // administrator may read any workspace and can select only their own,
        // so a `get` probe would happily save one the server then refuses on
        // every command — the exact failure this check exists to prevent. The
        // list is the identity route, defined as what the caller may switch
        // into, so it answers the question actually being asked.
        const client = buildClient(opts.profile)
        const { data: mine } = await client.workspaces.list()
        const data = mine.find((w) => w.id === id)
        if (!data) {
          throw new Error(
            `${id} is not one of the workspaces this account can work in — run: nodaro workspace list`,
          )
        }
        const name = saveWorkspace(opts.profile, id)
        if (opts.json) {
          emit({ profile: name, workspaceId: id, workspace: data }, opts)
          return
        }
        success(`profile "${name}" now works in ${data.name} (${id})`)
        if (data.archived) warn("this workspace is archived — reads work, new work does not")
        const { source } = resolveWorkspace(getProfile(opts.profile).profile)
        if (source !== "profile") {
          warn(`saved, but ${SOURCE_LABELS[source]} still wins for now`)
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("clear")
    .description("go back to the personal space")
    .option("--profile <name>")
    .action((opts: GlobalOpts) => {
      try {
        const name = saveWorkspace(opts.profile, null)
        success(`profile "${name}" now works in its personal space`)
        const { source } = resolveWorkspace(getProfile(opts.profile).profile)
        if (source !== "none") warn(`cleared, but ${SOURCE_LABELS[source]} still wins`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("members <id>")
    .description("who is in a workspace")
    .option("--limit <n>", "page size", (v) => Number(v))
    .option("--cursor <cursor>", "continue a previous page")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { limit?: number; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.workspaces.listMembers(id, { limit: opts.limit, cursor: opts.cursor })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((m) => ({
            userId: m.userId,
            name: m.displayName ?? "",
            role: m.role,
            status: m.status ?? "",
          })),
          ["userId", "name", "role", "status"],
        )
        if (page.nextCursor) dim(`more: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("join <code>")
    .description("join a workspace with a join code")
    .option("--profile <name>")
    .option("--json")
    .action(async (code: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const { data } = await client.workspaces.join(code)
        if (opts.json) {
          emit(data, opts)
          return
        }
        success(`joined workspace ${data.workspaceId}`)
        dim(`work in it: nodaro workspace use ${data.workspaceId}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one workspace")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const { data } = await client.workspaces.get(id)
        if (opts.json) emit(data, opts)
        else detail(data)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

const SOURCE_LABELS: Record<string, string> = {
  flag: "--workspace on this command",
  env: "the NODARO_WORKSPACE environment variable",
  profile: "the profile's saved workspace",
  none: "nothing — the personal space",
}
