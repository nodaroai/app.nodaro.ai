import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { config } from "../../lib/config.js"
import { rateLimitAddressKey } from "../../lib/client-address.js"
import { getNotifyConfig } from "../notifications/notify-config.js"
import { sendSlack } from "../notifications/slack-client.js"

/**
 * POST /v1/accessibility/report: the "report an accessibility problem" form on
 * the accessibility statement (Cloud only; the statement is Nodaro's own).
 *
 * The regulations (reg 35א(ד)) give a reported problem 60 days to be fixed, so
 * a report must never vanish: it goes to the founders' Slack channel (the same
 * admin-configured webhook as the founder alerts), and when that is not set or
 * the post fails the route answers 503 with the email to write to instead —
 * never a 200 for a report nobody received.
 *
 * Public on purpose (a visitor who cannot use the site cannot sign in to it):
 * rate-limited per network, text capped, Slack markup neutralised so a report
 * cannot ping the channel or hide a link. A filled `website` field is the
 * honeypot a form-filling bot fills and a person never sees.
 */

export const ACCESSIBILITY_REPORT_EMAIL = "info@nodaro.ai"

const reportBody = z.object({
  message: z.string().trim().min(1).max(2000),
  page: z.string().trim().max(500).optional(),
  contact: z.string().trim().max(200).optional(),
  website: z.string().max(200).optional(),
})

/** Slack mrkdwn treats `<…>` as a link, mention or `<!channel>`; `&` escapes them. */
export function slackPlain(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function siteHost(): string {
  try {
    return config.PUBLIC_URL ? new URL(config.PUBLIC_URL).host : "unknown"
  } catch {
    return "unknown"
  }
}

export function buildReportText(report: { message: string; page?: string; contact?: string }, userId?: string): string {
  const lines = [
    `:wheelchair: דיווח נגישות (${siteHost()})`,
    `*דף:* ${report.page ? slackPlain(report.page) : "לא צוין"}`,
    `*פרטי קשר:* ${report.contact ? slackPlain(report.contact) : "לא נמסרו"}`,
    ...(userId ? [`*משתמש מחובר:* ${userId}`] : []),
    `*תיאור:*`,
    slackPlain(report.message),
  ]
  return lines.join("\n")
}

export async function accessibilityReportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/accessibility/report",
    {
      // Three short text fields; nothing near the global 1 MiB.
      bodyLimit: 16_384,
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "10 minutes",
          keyGenerator: (req: FastifyRequest) => rateLimitAddressKey(req),
        },
      },
    },
    async (req, reply) => {
      const parsed = reportBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid report" },
        })
      }
      const { website, ...report } = parsed.data
      if (website) return reply.send({ ok: true })

      const unavailable = () =>
        reply.status(503).send({
          error: {
            code: "report_unavailable",
            message: `The report could not be sent. Please email ${ACCESSIBILITY_REPORT_EMAIL}.`,
            email: ACCESSIBILITY_REPORT_EMAIL,
          },
        })

      const { slackWebhookUrl } = await getNotifyConfig()
      if (!slackWebhookUrl) {
        req.log.error("[accessibility-report] no Slack webhook configured; report not delivered")
        return unavailable()
      }
      const result = await sendSlack(slackWebhookUrl, { text: buildReportText(report, req.userId), noUnfurl: true })
      if (!result.ok) {
        req.log.error({ status: result.status, error: result.error }, "[accessibility-report] Slack post failed")
        return unavailable()
      }
      return reply.send({ ok: true })
    },
  )
}
