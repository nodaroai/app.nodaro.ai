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

  return cmd
}
