import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, info, success, table, warn, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * Organizations from a terminal.
 *
 * The reason this group is worth having at all is `invite`: bringing a class
 * or a team onto an instance is a bulk, scripted, one-off job — exactly what
 * a shell is for and a web form is not.
 */
export function orgCommand(): Command {
  const cmd = new Command("org").description("organizations, their members, and invitations")

  cmd
    .command("list")
    .description("the organizations this account belongs to")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const { data } = await client.organizations.list()
        if (opts.json) {
          emit(data, opts)
          return
        }
        if (data.length === 0) {
          info("this account belongs to no organizations")
          return
        }
        table(
          data.map((o) => ({ id: o.id, name: o.name, kind: o.kind, status: o.status, role: o.role ?? "" })),
          ["id", "name", "kind", "status", "role"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one organization")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const { data } = await client.organizations.get(id)
        if (opts.json) emit(data, opts)
        else detail(data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create an organization")
    .requiredOption("--name <name>", "organization name")
    .requiredOption("--kind <kind>", "school or team")
    .option("--slug <slug>", "url slug (derived from the name when omitted)")
    .option("--accept-terms", "accept the terms, where the instance requires it")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { name: string; kind: string; slug?: string; acceptTerms?: boolean } & GlobalOpts) => {
      try {
        if (opts.kind !== "school" && opts.kind !== "team") {
          throw new Error("--kind must be school or team")
        }
        const client = buildClient(opts.profile)
        const { data } = await client.organizations.create({
          name: opts.name,
          kind: opts.kind,
          ...(opts.slug ? { slug: opts.slug } : {}),
          ...(opts.acceptTerms ? { acceptTerms: true } : {}),
        })
        if (opts.json) {
          emit(data, opts)
          return
        }
        success(`created ${data.name} (${data.id})`)
        // Some instances hold new organizations for a platform admin. Saying
        // so here is the difference between "waiting" and "broken".
        if (data.status === "pending") {
          warn("status is pending — it grants nothing until a platform admin approves it")
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("members <orgId>")
    .description("who is in an organization")
    .option("--limit <n>", "page size", (v) => Number(v))
    .option("--cursor <cursor>", "continue a previous page")
    .option("--profile <name>")
    .option("--json")
    .action(async (orgId: string, opts: { limit?: number; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.organizations.listMembers(orgId, { limit: opts.limit, cursor: opts.cursor })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((m) => ({
            userId: m.userId,
            name: m.displayName ?? "",
            email: m.email ?? "",
            role: m.role,
            status: m.status,
          })),
          ["userId", "name", "email", "role", "status"],
        )
        if (page.nextCursor) dim(`more: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("invite <orgId>")
    .description("invite people by email (repeat --email, or pass a comma-separated list)")
    .option("--email <email...>", "one or more addresses")
    .option("--role <role>", "org role: admin or member", "member")
    .option("--workspace <id>", "also place them in this workspace on accept")
    .option("--workspace-role <role>", "workspace role: admin or member")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        orgId: string,
        opts: {
          email?: string[]
          role: string
          workspace?: string
          workspaceRole?: string
        } & GlobalOpts,
      ) => {
        try {
          const emails = (opts.email ?? [])
            .flatMap((e) => e.split(","))
            .map((e) => e.trim())
            .filter(Boolean)
          if (emails.length === 0) throw new Error("no addresses — pass --email at least once")
          if (opts.role !== "admin" && opts.role !== "member") {
            throw new Error("--role must be admin or member")
          }
          if (opts.workspaceRole && opts.workspaceRole !== "admin" && opts.workspaceRole !== "member") {
            throw new Error("--workspace-role must be admin or member")
          }
          const client = buildClient(opts.profile)
          const { data } = await client.organizations.invite(orgId, {
            emails,
            orgRole: opts.role,
            ...(opts.workspace ? { workspaceId: opts.workspace } : {}),
            ...(opts.workspaceRole ? { workspaceRole: opts.workspaceRole as "admin" | "member" } : {}),
          })
          if (opts.json) {
            emit(data, opts)
            return
          }
          // The link is the whole answer on an install with no mail provider.
          // Printing "invited" and swallowing it would create invitations
          // nobody can reach — so every non-sent row shows its link.
          for (const row of data) {
            if (row.status === "sent") success(`${row.email} — emailed`)
            else if (row.link) {
              warn(`${row.email} — not emailed (${row.status}); send this link yourself:`)
              info(`  ${row.link}`)
            } else {
              warn(`${row.email} — ${row.status}, and no link was returned`)
            }
          }
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("invitations <orgId>")
    .description("outstanding invitations")
    .option("--status <status>", "open, accepted, revoked or expired")
    .option("--limit <n>", "page size", (v) => Number(v))
    .option("--cursor <cursor>", "continue a previous page")
    .option("--profile <name>")
    .option("--json")
    .action(async (orgId: string, opts: { status?: string; limit?: number; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.organizations.listInvitations(orgId, {
          ...(opts.status ? { status: opts.status as "open" } : {}),
          limit: opts.limit,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((i) => ({
            id: i.id,
            email: i.email,
            role: i.orgRole,
            state: i.state,
            expiresAt: i.expiresAt,
          })),
          ["id", "email", "role", "state", "expiresAt"],
        )
        if (page.nextCursor) dim(`more: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("revoke <invitationId>")
    .description("revoke an invitation")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const { data } = await client.organizations.revokeInvitation(id)
        if (opts.json) emit(data, opts)
        else success(`revoked invitation ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("audit <orgId>")
    .description("what happened in an organization, newest first")
    .option("--limit <n>", "page size", (v) => Number(v))
    .option("--cursor <cursor>", "continue a previous page")
    .option("--profile <name>")
    .option("--json")
    .action(async (orgId: string, opts: { limit?: number; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.organizations.audit(orgId, { limit: opts.limit, cursor: opts.cursor })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((e) => ({
            at: e.createdAt,
            action: e.action,
            actor: e.actor?.displayName ?? e.actor?.email ?? e.actor?.userId ?? "system",
            target: e.targetId ?? "",
          })),
          ["at", "action", "actor", "target"],
        )
        if (page.nextCursor) dim(`more: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("usage <orgId>")
    .description("credits by workspace, member, model or day for a date range")
    .option("--from <YYYY-MM-DD>", "inclusive start date")
    .option("--to <YYYY-MM-DD>", "inclusive end date")
    .option("--tz <iana>", "IANA time zone (default: your local zone)")
    .option("--group-by <dim>", "workspace | member | model | day | none", "day")
    .option("--workspace <id>", "narrow to one workspace")
    .option("--user <id>", "narrow to one member")
    .option("--limit <n>", "rows page size (with --group-by none)", (v) => Number(v))
    .option("--cursor <cursor>", "continue a rows page")
    .option("--csv", "write the report as CSV to stdout")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        orgId: string,
        opts: {
          from?: string
          to?: string
          tz?: string
          groupBy: string
          workspace?: string
          user?: string
          limit?: number
          cursor?: string
          csv?: boolean
        } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const tz = opts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
          const common = { from: opts.from, to: opts.to, tz, workspaceId: opts.workspace, userId: opts.user }
          if (opts.csv) {
            process.stdout.write(
              await client.organizations.usageCsv(orgId, {
                ...common,
                groupBy: opts.groupBy as "workspace" | "member" | "model" | "day" | "none",
              }),
            )
            return
          }
          if (opts.groupBy === "none") {
            const page = await client.organizations.usageRows(orgId, { ...common, limit: opts.limit, cursor: opts.cursor })
            if (opts.json) {
              emit(page, opts)
              return
            }
            table(
              page.data.map((e) => ({
                at: e.createdAt,
                member: e.member?.displayName ?? e.member?.email ?? e.member?.userId ?? "",
                model: e.model,
                status: e.status,
                credits: e.credits,
              })),
              ["at", "member", "model", "status", "credits"],
            )
            if (page.nextCursor) dim(`more: --cursor ${page.nextCursor}`)
            return
          }
          const { data: report } = await client.organizations.usage(orgId, {
            ...common,
            groupBy: opts.groupBy as "workspace" | "member" | "model" | "day",
          })
          if (opts.json) {
            emit(report, opts)
            return
          }
          table(
            report.rows.map((r) => ({
              group: r.workspace
                ? (r.workspace.name ?? r.workspace.slug ?? r.workspace.id)
                : r.member
                  ? (r.member.displayName ?? r.member.email ?? r.member.userId)
                  : (r.model ?? r.day ?? r.key),
              runs: r.runCount,
              credits: r.credits,
              settled: r.settledCredits,
              in_flight: r.inFlightCredits,
            })),
            ["group", "runs", "credits", "settled", "in_flight"],
          )
          dim(
            `total: ${report.totals.credits} credits (${report.totals.settledCredits} settled, ` +
              `${report.totals.inFlightCredits} in flight, ${report.totals.platformAbsorbedCredits} absorbed by the platform)`,
          )
          if (report.truncated) warn("report truncated at 5000 groups — narrow the window")
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
