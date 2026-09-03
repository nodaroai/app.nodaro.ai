import { z } from "zod"
import {
  escapeHtml,
  normalizeLinkUrl,
  previewTextFrom,
  renderAdminMessageBody,
  sanitizeHeaderText,
} from "./admin-message-markdown.js"
import { greetingNameFrom } from "./recipient-first-name.js"

/**
 * The three admin → user email templates, and the ONE place that turns an
 * admin's input into what Loops receives.
 *
 * WHY A REGISTRY AND NOT THREE ROUTE BRANCHES. Four things have to agree
 * exactly or the feature lies to somebody: the preview the admin approves, the
 * `dataVariables` Loops substitutes, the `rendered_subject` / `rendered_body`
 * we keep as the record of truth, and the HTML the Loops template itself was
 * built to display. Three of those four are produced right here, from one
 * `render()` per template, so they cannot drift from each other. The fourth
 * lives in the Loops dashboard, and the `bodyHtml` below is exactly what its
 * template is built to render — see `docs/design/` handover notes and the
 * per-template comments.
 *
 * WHY THE transactionalId IS COMPILED IN, not an app_settings row. The id is
 * bound one-to-one to the variable NAMES the code fills. Making it runtime-
 * editable would let an operator point `issue_detected` at a template that
 * wants different variables — a change that passes every validation here and
 * produces an email with empty holes in it. Changing a template id is a code
 * change because changing what fills it is a code change.
 */

/** Admin-typed prose. Long enough for a real explanation, bounded so a paste
 *  accident cannot become a 2 MB email. */
const prose = (max: number) => z.string().trim().min(1).max(max)

/**
 * An http(s) URL we are willing to put in an email, NORMALISED.
 *
 * The transform is the load-bearing part. `new URL()` accepts `"`, `<` and `>`
 * and percent-encodes them; validating with a predicate and keeping the raw
 * string is how `https://x/"><b>owned</b><a href="` passes every check here and
 * then breaks out of an attribute in a sink that does not escape — which is
 * precisely what the Loops template is. Parsing once, at the edge, means every
 * later consumer (our HTML, the provider, the stored row) sees the same
 * canonical string and none of them has to be careful.
 */
const linkUrl = z
  .string()
  .trim()
  .max(2000)
  .transform((u, ctx) => {
    const normalized = normalizeLinkUrl(u)
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "must be an http(s) URL" })
      return z.NEVER
    }
    return normalized
  })

// ---------------------------------------------------------------------------
// Per-template input schemas
// ---------------------------------------------------------------------------

export const issueDetectedInput = z.object({
  whatHappened: prose(2000),
  whatWeDid: prose(2000),
  nextStep: prose(2000),
})

export const creditsRefundedInput = z.object({
  /** Credits, not currency. Integer: a fractional credit refund is not a thing
   *  the ledger can produce, so accepting one would only ever be a typo. */
  amount: z.coerce.number().int().positive().max(1_000_000),
  reason: prose(2000),
})

/**
 * The optional extras: a CTA button and a screenshot link. Both are PAIRS, and
 * a half-filled pair is refused rather than silently dropped — a button with no
 * destination, or a link with no words, is the kind of thing that reaches a
 * customer looking broken.
 *
 * `imageLabel` being required alongside `imageUrl` is the spec's alt-text rule,
 * surviving the move from inline image to link: the words are what the email
 * has to make sense with, and here they are the only thing the recipient sees
 * before they click.
 */
export const generalFollowupInput = z
  .object({
    subjectLine: z.string().trim().min(1).max(200),
    bodyText: prose(10_000),
    ctaLabel: z.string().trim().max(80).optional(),
    ctaUrl: linkUrl.optional(),
    imageUrl: linkUrl.optional(),
    imageLabel: z.string().trim().max(120).optional(),
  })
  .refine((v) => Boolean(v.ctaLabel) === Boolean(v.ctaUrl), {
    message: "a call to action needs both a label and a URL",
    path: ["ctaLabel"],
  })
  // SYMMETRIC, in both directions. A label with no URL is not harmless: the
  // preview and the stored copy would show nothing (the body renderer needs
  // both to emit the link) while Loops still received link text pointing at an
  // empty destination — the two halves of this feature disagreeing about what
  // was sent, which is the one thing the shared renderer exists to prevent.
  .refine((v) => Boolean(v.imageUrl) === Boolean(v.imageLabel), {
    message: "a screenshot needs both the file and its link text — the email must make sense as words",
    path: ["imageLabel"],
  })

// ---------------------------------------------------------------------------
// Shared HTML fragments
// ---------------------------------------------------------------------------

/**
 * WHAT WE AUTHOR AND WHAT LOOPS AUTHORS.
 *
 * The Loops templates are LMX — a closed component language, not HTML with
 * `{{var}}` holes. The wrapper, the layout, the labels and the styling all live
 * inside Loops and are not ours to write. What we author is the HTML INSIDE
 * each variable, which is why this file's renderer exists at all.
 *
 * So `bodyHtml` below is our best reconstruction of what the recipient sees —
 * the variables in the order and shape the template arranges them — and NOT a
 * template we hand over. It is what the preview paints and what is stored as
 * `rendered_body`. Where the template's own fixed copy is known, it is mirrored
 * here so the reconstruction is honest; those strings are marked, and they move
 * when the template moves.
 *
 * Email clients drop stylesheets, so every rule here is inline.
 */
const P = 'style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#111827;"'
const BUTTON =
  'style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#ffffff;' +
  'font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;"'
const IMAGE_LINK =
  'style="display:inline-block;padding:10px 16px;border:1px solid #d1d5db;border-radius:8px;' +
  'font-size:14px;color:#4f46e5;text-decoration:none;"'

/** One rendered paragraph — the shape the templates arrange variables into. */
function para(body: string): string {
  return `<p ${P}>${renderAdminMessageBody(body)}</p>`
}

/**
 * THE ESCAPING POLICY for `dataVariables`, in one place.
 *
 * Loops does NOT escape variables — verified by a live send — so anything that
 * arrives as markup renders as markup. Every value that lands in the template's
 * HTML must therefore be escaped here, and specifically not on the reasoning
 * "the prose fields are rendered, so the short ones must be fine". They were
 * not: `ctaLabel` and `imageLabel` went raw while `bodyText` went escaped, so
 * an admin approved `&lt;b&gt;` in the preview and the recipient got bold text,
 * with the stored "record of truth" siding with the preview over the email.
 *
 * Two escaped shapes:
 *   - `proseVar`  — multi-line, may carry the markdown subset (escape, then
 *                   rebuild links and breaks from the escaped text).
 *   - `phraseVar` — a short single-line string with no markdown (escape only).
 *
 * And three values that are deliberately NOT html-escaped, each for a stated
 * reason rather than by omission:
 *   - `ctaUrl` / `imageUrl` — canonicalised by `normalizeLinkUrl` at the schema
 *     edge instead. Percent-encoding is what makes them safe in an href, and it
 *     is applied once, at the boundary, so every consumer sees the safe form.
 *   - `subjectLine` — a mail header, not markup. `sanitizeHeaderText` strips the
 *     line breaks that would forge one; escaping would show the recipient a
 *     literal `&amp;`. (This assumes the template uses it only as the subject.)
 */
const proseVar = renderAdminMessageBody
const phraseVar = escapeHtml

/**
 * WHO the email is addressed to.
 *
 * `firstName` is the one variable that is not the admin's input, and all three
 * Loops templates open with it. It is PASSED IN rather than looked up here so
 * that rendering stays a pure function of (input, recipient) — which is what
 * lets the preview and the send keep sharing one code path.
 */
export interface AdminMessageRecipient {
  /** The recipient's name as `profiles.full_name` has it. Often absent. */
  readonly fullName?: string | null
}

/** The greeting name, escaped like every other value that lands in the HTML. */
function greetingVar(recipient: AdminMessageRecipient): string {
  return phraseVar(greetingNameFrom(recipient.fullName))
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

export type AdminMessageTemplateId =
  | "issue_detected"
  | "credits_refunded"
  | "general_followup"

export interface RenderedAdminMessage {
  /** What the recipient sees in their inbox list. */
  readonly subject: string
  /** The message body, as HTML, exactly as the Loops template will show it. */
  readonly bodyHtml: string
  /** Flat string map handed to the Loops transactional API verbatim. */
  readonly dataVariables: Readonly<Record<string, string>>
}

export interface AdminMessageTemplate {
  readonly id: AdminMessageTemplateId
  /** Loops transactional id. Bound to the variable names below — see header. */
  readonly transactionalId: string
  /**
   * EXACTLY the variables the Loops template declares — the contract the
   * provider validates every send against.
   *
   * Loops refuses a send when a declared variable is absent OR empty
   * ("Missing required data variable(s): …"), and it does not care that the
   * value was optional to us. This list is the transactional id's twin: the id
   * names a template, this names what that template asks for, and neither is
   * runtime-editable for the same reason.
   *
   * Checked two ways rather than trusted: the totality test renders every
   * optional-field combination and compares key sets against this list, and
   * `backend/scripts/check-loops-templates.ts` compares it against the live
   * Loops API. Both exist because the first admin → user email ever sent failed
   * on exactly this: `firstName` was declared by all three templates and sent by
   * none, so every message bounced with a 502 until it was fixed.
   */
  readonly dataVariableNames: readonly string[]
  readonly label: string
  /** One line telling the admin when this template is the right one. */
  readonly description: string
  /**
   * Whether this template's Loops design has the screenshot-link block. Only
   * templates that can DISPLAY an image may accept one: attaching a screenshot
   * that the template has nowhere to render is a silent loss, and the admin
   * would have no way to know it happened.
   */
  readonly supportsImage: boolean
  /**
   * True when the SUBJECT is written by the admin. False means the subject
   * lives in the Loops template, and `render()` returns our copy of it —
   * accurate as of the template's creation, shown to the admin as
   * template-owned, and stored so the log is readable.
   */
  readonly subjectIsAuthored: boolean
  readonly schema: z.ZodType<unknown>
  readonly render: (input: never, recipient: AdminMessageRecipient) => RenderedAdminMessage
}

/**
 * Subjects that live in the Loops template, mirrored here so the preview and
 * the log are not blank. If a template's subject is edited in the Loops
 * dashboard, edit it here in the same change — these are copies, and they are
 * labelled as template-owned everywhere they are shown.
 */
const TEMPLATE_OWNED_SUBJECT: Record<"issue_detected" | "credits_refunded", string> = {
  issue_detected: "About your recent activity on Nodaro",
  credits_refunded: "We've credited your Nodaro account",
}

/**
 * The template's own fixed sentence around `amount`, mirrored for the same
 * reason as the subjects above. `{amount}` is where the variable lands — and
 * because the template supplies no unit, the variable itself has to carry one
 * (see the `credits_refunded` renderer).
 */
const CREDITS_REFUNDED_SENTENCE = (amount: string) =>
  `We've credited ${amount} back to your Nodaro account`

/**
 * The amount as the recipient reads it, unit included.
 *
 * Deliberately NOT grouped ("1500", not "1,500"): the same string is both sent
 * and stored, so a separator added on one side only would put a number in
 * `rendered_body` that nobody ever saw.
 */
function creditsAmount(amount: number): string {
  return `${amount} credit${amount === 1 ? "" : "s"}`
}

const issueDetected: AdminMessageTemplate = {
  id: "issue_detected",
  transactionalId: "cmtl3elqj0b9k0i0bjfd4vtxp",
  label: "Issue detected",
  description: "We noticed something went wrong on their side and want to get ahead of it.",
  supportsImage: false,
  subjectIsAuthored: false,
  dataVariableNames: ["firstName", "whatHappened", "whatWeDid", "nextStep"],
  schema: issueDetectedInput,
  render: (
    input: z.infer<typeof issueDetectedInput>,
    recipient: AdminMessageRecipient,
  ): RenderedAdminMessage => ({
    subject: TEMPLATE_OWNED_SUBJECT.issue_detected,
    // Three plain paragraphs, in template order. No "WHAT HAPPENED" headings:
    // the Loops template already structures these three variables, so labels
    // invented here would appear in the preview and the stored record and
    // nowhere in the actual email.
    bodyHtml: [para(input.whatHappened), para(input.whatWeDid), para(input.nextStep)].join("\n"),
    dataVariables: {
      // The template's own greeting. Not mirrored into `bodyHtml` above: the
      // wording of "Hi {firstName}," lives in Loops, and inventing a copy of it
      // here would put a sentence in the preview and the stored record that
      // nobody can verify against the real email.
      firstName: greetingVar(recipient),
      whatHappened: proseVar(input.whatHappened),
      whatWeDid: proseVar(input.whatWeDid),
      nextStep: proseVar(input.nextStep),
    },
  }),
}

const creditsRefunded: AdminMessageTemplate = {
  id: "credits_refunded",
  transactionalId: "cmtl3f0cm0bgd0jyqubm4y6dj",
  label: "Credits refunded",
  description: "Credits have been returned to their balance and we're telling them why.",
  supportsImage: false,
  subjectIsAuthored: false,
  dataVariableNames: ["firstName", "amount", "reason"],
  schema: creditsRefundedInput,
  render: (
    input: z.infer<typeof creditsRefundedInput>,
    recipient: AdminMessageRecipient,
  ): RenderedAdminMessage => ({
    subject: TEMPLATE_OWNED_SUBJECT.credits_refunded,
    bodyHtml: [
      // The template's own sentence with the variable in it, so the preview and
      // the stored record read as the recipient's email does rather than as an
      // invented "Amount:" row.
      `<p ${P}>${escapeHtml(CREDITS_REFUNDED_SENTENCE(creditsAmount(input.amount)))}</p>`,
      para(input.reason),
    ].join("\n"),
    dataVariables: {
      firstName: greetingVar(recipient),
      // WITH the unit. The template reads "We've credited {amount} back to your
      // Nodaro account" and supplies no noun, so a bare "1500" would reach the
      // recipient as "We've credited 1500 back to your Nodaro account".
      amount: creditsAmount(input.amount),
      reason: proseVar(input.reason),
    },
  }),
}

const generalFollowup: AdminMessageTemplate = {
  id: "general_followup",
  transactionalId: "cmtl3fdnc0b700jzbp6j1af1d",
  label: "General follow-up",
  description: "Anything else service-related — you write the subject and the message.",
  supportsImage: true,
  subjectIsAuthored: true,
  /**
   * THE BUTTON AND THE SCREENSHOT ARE NOT VARIABLES, and cannot be.
   *
   * They are optional; LMX has no conditionals; and Loops refuses a send whose
   * declared variable is empty. Those three facts together leave a template
   * that declares `ctaUrl` with exactly two possible behaviours — every
   * message carries a button, or no message sends at all. It shipped as the
   * second: an unused pair went out as `""` and Loops answered "Missing
   * required data variable(s): ctaUrl, ctaLabel", so every general follow-up
   * bounced.
   *
   * So the conditionals live HERE, where they already existed, and the links
   * are composed into `bodyText`. The Loops template must therefore declare
   * these four variables and no others — its button block and its
   * screenshot-link block have no value to render any more, and while it still
   * declares them every send is refused. `backend/scripts/check-loops-templates.ts`
   * is what confirms the dashboard agrees; this comment cannot.
   */
  dataVariableNames: ["firstName", "subjectLine", "previewText", "bodyText"],
  schema: generalFollowupInput,
  render: (
    input: z.infer<typeof generalFollowupInput>,
    recipient: AdminMessageRecipient,
  ): RenderedAdminMessage => {
    const parts = [renderAdminMessageBody(input.bodyText)]
    if (input.ctaLabel && input.ctaUrl) {
      parts.push(
        `<a href="${escapeHtml(input.ctaUrl)}" ${BUTTON}>${escapeHtml(input.ctaLabel)}</a>`,
      )
    }
    if (input.imageUrl && input.imageLabel) {
      parts.push(
        `<a href="${escapeHtml(input.imageUrl)}" ${IMAGE_LINK}>${escapeHtml(input.imageLabel)}</a>`,
      )
    }
    // `<br /><br />` and not `<p>`: this string is substituted INTO the
    // template's own text block, and a paragraph nested inside the paragraph
    // Loops wraps it in is invalid HTML that clients render inconsistently.
    // It is also the separator `renderAdminMessageBody` already puts between
    // the admin's own paragraphs, so the spacing stays uniform.
    const body = parts.join("<br /><br />")
    // A subject is a mail HEADER, not markup: stripped of the line breaks that
    // would forge one, and NOT HTML-escaped (which would show the recipient a
    // literal `&amp;`).
    const subject = sanitizeHeaderText(input.subjectLine)
    return {
      subject,
      // ONE paragraph, because one block is now what the recipient gets. This
      // wraps the exact string sent as `bodyText`, so the preview, the stored
      // record and the email cannot disagree about the button or the link.
      bodyHtml: `<p ${P}>${body}</p>`,
      dataVariables: {
        firstName: greetingVar(recipient),
        subjectLine: subject,
        // The preheader — the grey line beside the subject in the inbox list.
        // Falls back to the subject rather than risk an empty variable, which
        // Loops counts as a missing one and refuses the whole send over.
        previewText: phraseVar(previewTextFrom(input.bodyText) || subject),
        bodyText: body,
      },
    }
  },
}

export const ADMIN_MESSAGE_TEMPLATES: readonly AdminMessageTemplate[] = [
  issueDetected,
  creditsRefunded,
  generalFollowup,
]

const BY_ID = new Map<string, AdminMessageTemplate>(
  ADMIN_MESSAGE_TEMPLATES.map((t) => [t.id, t]),
)

export function getAdminMessageTemplate(id: string): AdminMessageTemplate | undefined {
  return BY_ID.get(id)
}

/** The template ids, as a Zod enum for route validation. Derived from the
 *  registry so a fourth template cannot be half-added. */
export const adminMessageTemplateId = z.enum(
  ADMIN_MESSAGE_TEMPLATES.map((t) => t.id) as [AdminMessageTemplateId, ...AdminMessageTemplateId[]],
)

export interface ParsedAdminMessage extends RenderedAdminMessage {
  readonly template: AdminMessageTemplate
  /** The admin's input after validation — stored as `variables` on the row. */
  readonly input: Record<string, unknown>
}

export type ParseResult =
  | { readonly ok: true; readonly value: ParsedAdminMessage }
  | { readonly ok: false; readonly message: string }

/**
 * Validate + render in one step. Every caller (preview AND send) goes through
 * this, so a preview can never be produced from input the send would reject —
 * or, worse, the other way round.
 */
export function parseAdminMessage(
  templateId: string,
  raw: unknown,
  recipient: AdminMessageRecipient = {},
): ParseResult {
  const template = getAdminMessageTemplate(templateId)
  if (!template) {
    return { ok: false, message: `Unknown template: ${templateId}` }
  }

  // Checked HERE, against the raw input, so preview and send give the same
  // answer. It has to run before the schema, because the schema's job is to
  // STRIP a key the template does not declare — which is what makes the send
  // safe and would also make the loss silent. It used to live in the route, and
  // the two surfaces disagreed: preview rendered a clean 200 for a message the
  // send then refused.
  const requested = (raw ?? {}) as Record<string, unknown>
  const wantsImage = typeof requested.imageUrl === "string" && requested.imageUrl.trim().length > 0
  if (wantsImage && !template.supportsImage) {
    return {
      ok: false,
      message: `The "${template.label}" template cannot carry a screenshot — use General follow-up`,
    }
  }

  const parsed = template.schema.safeParse(raw ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue?.path?.length ? `${issue.path.join(".")}: ` : ""
    return { ok: false, message: `${where}${issue?.message ?? "Invalid input"}` }
  }
  const input = parsed.data as Record<string, unknown>
  const rendered = template.render(input as never, recipient)

  // THE BACKSTOP, and the reason this class of bug cannot reach a customer
  // again. Loops validates our payload against the variables the template
  // declares and refuses the send when one is absent OR empty — which is how
  // every admin message failed between shipping and this fix: `firstName` was
  // declared by all three templates and sent by none, and the admin saw a bare
  // 502 from a provider they cannot see. Checking it here turns a silent
  // provider rejection into an answer that names the problem.
  const problem = checkDataVariables(template, rendered.dataVariables)
  if (problem) return { ok: false, message: problem }

  return { ok: true, value: { ...rendered, template, input } }
}

/**
 * Every declared variable present and non-blank, and nothing sent that the
 * template did not ask for. Both directions matter: a missing one is a refused
 * send, and an extra one means this file and the Loops dashboard have drifted —
 * which is worth knowing BEFORE it becomes the missing one.
 */
function checkDataVariables(
  template: AdminMessageTemplate,
  vars: Readonly<Record<string, string>>,
): string | null {
  const declared = new Set(template.dataVariableNames)
  const blank = template.dataVariableNames.filter((name) => !(vars[name] ?? "").trim())
  const extra = Object.keys(vars).filter((name) => !declared.has(name))
  if (blank.length === 0 && extra.length === 0) return null
  const detail = [
    blank.length > 0 ? `missing ${blank.join(", ")}` : "",
    extra.length > 0 ? `unexpected ${extra.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ")
  return `The "${template.label}" email could not be built (${detail}). This is a bug in Nodaro, not in what you typed — please report it.`
}
