import { Command } from "commander"
import type { WebhookDelivery, WebhookDeliveryStatus, WebhookJobEvent } from "@nodaro/sdk"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, info, success, table, terminalSafe, warn, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

const JOB_EVENTS: readonly WebhookJobEvent[] = ["job.completed", "job.failed"]
const DELIVERY_STATUSES: readonly WebhookDeliveryStatus[] = ["pending", "delivered", "failed"]

/** `--events job.completed,job.failed` (comma- or space-separated). */
function eventList(value: string | undefined): WebhookJobEvent[] | undefined {
  if (value === undefined) return undefined
  const events = value.split(/[\s,]+/).filter(Boolean)
  const unknown = events.filter((e) => !JOB_EVENTS.includes(e as WebhookJobEvent))
  if (unknown.length > 0) throw new Error(`unknown event ${unknown.join(", ")} — use ${JOB_EVENTS.join(" or ")}`)
  return events as WebhookJobEvent[]
}

function printSecret(secret: string, what: string): void {
  info("")
  info(`Signing secret (${what} — shown this once, store it now):`)
  info(`  ${secret}`)
  info("")
}

function deliveryRow(d: WebhookDelivery) {
  return {
    id: d.id,
    event: d.event,
    status: d.status,
    attempts: d.attempts,
    response: d.responseStatus ?? "",
    error: d.error ?? "",
    createdAt: d.createdAt,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function webhooksCommand(): Command {
  const cmd = new Command("webhooks").description(
    "outbound webhooks: endpoints that receive your job.completed / job.failed, signed — create, rotate the secret, delivery log, test",
  )

  cmd
    .command("list")
    .description("your webhook endpoints")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.webhooks.list()
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        table(
          result.data.map((e) => ({
            id: e.id,
            url: e.url,
            events: e.events.join(","),
            active: e.isActive ? "yes" : e.disabledReason ? `no (${e.disabledReason})` : "no",
            app: e.appId ?? "",
          })),
          ["id", "url", "events", "active", "app"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one endpoint")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.webhooks.get(id)
        if (opts.json) emit(result.data, opts)
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("register an https endpoint; prints its signing secret once")
    .requiredOption("--url <url>", "https address on a public host")
    .option("--events <events>", `comma-separated: ${JOB_EVENTS.join(",")} (default: both)`)
    .option("--description <text>")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { url: string; events?: string; description?: string } & GlobalOpts) => {
      try {
        const events = eventList(opts.events)
        const client = buildClient(opts.profile)
        const result = await client.webhooks.create({ url: opts.url, events, description: opts.description })
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`created webhook endpoint ${result.data.id}`)
        printSecret(result.secret, "new endpoint")
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("change the address, events or description; switch on or off")
    .option("--url <url>")
    .option("--events <events>", `comma-separated: ${JOB_EVENTS.join(",")}`)
    .option("--description <text>")
    .option("--clear-description")
    .option("--enable", "switch on (clears an automatic switch-off)")
    .option("--disable", "switch off")
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: { url?: string; events?: string; description?: string; clearDescription?: boolean; enable?: boolean; disable?: boolean } & GlobalOpts,
      ) => {
        try {
          if (opts.enable && opts.disable) throw new Error("choose one of --enable or --disable")
          const events = eventList(opts.events)
          const isActive = opts.enable ? true : opts.disable ? false : undefined
          const description = opts.clearDescription ? null : opts.description
          if (opts.url === undefined && events === undefined && isActive === undefined && description === undefined) {
            throw new Error("nothing to update — provide --url, --events, --description, --clear-description, --enable or --disable")
          }
          const client = buildClient(opts.profile)
          const result = await client.webhooks.update(id, { url: opts.url, events, isActive, description })
          if (opts.json) {
            emit(result.data, opts)
            return
          }
          success(`updated webhook endpoint ${result.data.id}`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("delete <id>")
    .description("delete an endpoint and its delivery log")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.webhooks.delete(id)
        if (opts.json) {
          emit({ success: true, id }, opts)
          return
        }
        success(`deleted webhook endpoint ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("rotate-secret <id>")
    .description("replace the signing secret; the old one keeps signing beside it for a grace period (a day by default); prints the new one once")
    .option("--grace <seconds>", "how long the old secret keeps signing (0 = stop it now; at most 604800)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { grace?: string } & GlobalOpts) => {
      try {
        let input: { gracePeriodSeconds?: number } = {}
        if (opts.grace !== undefined) {
          const seconds = Number(opts.grace)
          if (!Number.isInteger(seconds) || seconds < 0 || seconds > 604_800) {
            throw new Error(`--grace must be whole seconds from 0 to 604800, not ${opts.grace}`)
          }
          input = { gracePeriodSeconds: seconds }
        }
        const client = buildClient(opts.profile)
        const result = await client.webhooks.rotateSecret(id, input)
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`rotated the signing secret of ${id}`)
        printSecret(result.secret, "rotated")
        info(
          result.previousSecretExpiresAt
            ? `The old secret keeps signing too until ${result.previousSecretExpiresAt}: update your receiver before then.`
            : "The old secret no longer signs: update your receiver now.",
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("deliveries <id>")
    .description("the endpoint's delivery log, newest first (kept 30 days)")
    .option("--status <status>", DELIVERY_STATUSES.join("|"))
    .option("--limit <n>", "page size (1-100)")
    .option("--cursor <cursor>", "the previous page's next")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { status?: string; limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        if (opts.status && !DELIVERY_STATUSES.includes(opts.status as WebhookDeliveryStatus)) {
          throw new Error(`unknown status ${opts.status} — use ${DELIVERY_STATUSES.join(", ")}`)
        }
        const client = buildClient(opts.profile)
        const page = await client.webhooks.deliveries(id, {
          status: opts.status as WebhookDeliveryStatus | undefined,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(page.data.map(deliveryRow), ["id", "event", "status", "attempts", "response", "error", "createdAt"])
        if (page.next) dim(`next: --cursor ${page.next}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("test <id>")
    .description("send a ping to the endpoint (tried once); --wait shows how it answered")
    .option("--wait", "wait for the result (up to 60 s)")
    .option("--poll-interval <ms>", "how often to look (default 1000)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { wait?: boolean; pollInterval?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const queued = await client.webhooks.test(id)
        if (!opts.wait) {
          if (opts.json) emit(queued.data, opts)
          else success(`queued ping ${queued.data.id} — follow it with: nodaro webhooks deliveries ${id}`)
          return
        }
        const interval = Math.max(1, Number(opts.pollInterval ?? 1000) || 1000)
        const deadline = Date.now() + 60_000
        let last: WebhookDelivery = queued.data
        for (;;) {
          // That delivery, by its id — however many others the log has since.
          last = (await client.webhooks.getDelivery(id, queued.data.id)).data
          if (last.status !== "pending" || Date.now() > deadline) break
          await sleep(interval)
        }
        if (opts.json) {
          emit(last, opts)
          return
        }
        if (last.status === "delivered") success(`ping delivered: ${last.responseStatus} in ${last.durationMs ?? "?"} ms`)
        else if (last.status === "failed") {
          // The receiver's answer is a third party's text: never printed raw.
          warn(terminalSafe(`ping failed: ${last.error ?? "no answer"}${last.responseBody ? ` — ${last.responseBody}` : ""}`))
        } else warn(`ping still pending after 60 s — check: nodaro webhooks deliveries ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
