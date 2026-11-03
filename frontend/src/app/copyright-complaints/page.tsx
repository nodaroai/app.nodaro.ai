import { useEffect, useId, useState, type FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { NodaroLogo } from "@/components/nodaro-logo"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"

/**
 * The public complaints page: a copyright notice (the twelve fields and the
 * two statements the policy names) or another complaint about content on
 * this service. Public: a complainant has no account here. It is linked from
 * sign-in, the sidebar and the account menu (components/legal/
 * complaints-link.tsx) wherever the admin's Complaints screen handles the
 * cases. What a complainant types is masked from session recordings.
 *
 * The two legal statements are read from the server and shown verbatim; the
 * page never carries their text. A submission answers a reference number and
 * asks the person to confirm their email through the link sent to them; the
 * verify link lands back here with `?verified=ok|invalid`.
 */

type Kind = "copyright" | "other"
type OtherCategory = "likeness" | "voice" | "impersonation" | "privacy" | "other"
const OTHER_CATEGORIES: readonly OtherCategory[] = ["likeness", "voice", "impersonation", "privacy", "other"]
const CATEGORY_KEYS = {
  likeness: "complaints.cat.likeness",
  voice: "complaints.cat.voice",
  impersonation: "complaints.cat.impersonation",
  privacy: "complaints.cat.privacy",
  other: "complaints.cat.other",
} as const

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "received"; reference: string | null }
  | { kind: "failed"; message: string }

interface Statements {
  readonly goodFaith: string
  readonly accuracy: string
}

interface Fields {
  name: string
  email: string
  address: string
  phone: string
  claimantRole: "owner" | "agent"
  originalWork: string
  originalWorkUrl: string
  reportedContent: string
  explanation: string
  signature: string
  goodFaith: boolean
  accuracy: boolean
  category: OtherCategory
  website: string
}

const EMPTY: Fields = {
  name: "",
  email: "",
  address: "",
  phone: "",
  claimantRole: "owner",
  originalWork: "",
  originalWorkUrl: "",
  reportedContent: "",
  explanation: "",
  signature: "",
  goodFaith: false,
  accuracy: false,
  category: "likeness",
  website: "",
}

function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  readonly id: string
  readonly label: string
  readonly help?: string
  readonly error?: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && !error && (
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export default function CopyrightComplaintsPage() {
  const t = useT()
  const [params] = useSearchParams()
  const verified = params.get("verified")
  const base = useId()
  const [kind, setKind] = useState<Kind>("copyright")
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [statements, setStatements] = useState<Statements | null>(null)
  const [statementsFailed, setStatementsFailed] = useState(false)
  const [statementsAttempt, setStatementsAttempt] = useState(0)
  const [state, setState] = useState<SendState>({ kind: "idle" })
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({})

  useEffect(() => {
    document.title = t("complaints.title")
  }, [t])

  // The statements come from the server, verbatim; until they are here the
  // boxes that affirm them cannot be ticked, so nobody affirms text they never saw.
  useEffect(() => {
    let cancelled = false
    setStatementsFailed(false)
    fetch("/v1/content-complaints/statements")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { data?: Statements } | null) => {
        if (cancelled) return
        if (body?.data) setStatements(body.data)
        else setStatementsFailed(true)
      })
      .catch(() => {
        if (!cancelled) setStatementsFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [statementsAttempt])

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((f) => ({ ...f, [key]: value }))
  const id = (name: string) => `${base}-${name}`
  const copyright = kind === "copyright"
  const sending = state.kind === "sending"
  const canSubmit = !sending && (!copyright || (statements !== null && fields.goodFaith && fields.accuracy))

  function chooseKind(next: Kind) {
    setKind(next)
    setErrors({})
  }

  function validate(): Partial<Record<keyof Fields, string>> {
    const required = t("complaints.required")
    const next: Partial<Record<keyof Fields, string>> = {}
    if (!fields.name.trim()) next.name = required
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) next.email = t("complaints.invalidEmail")
    if (!fields.reportedContent.trim()) next.reportedContent = required
    if (!fields.explanation.trim()) next.explanation = required
    if (copyright) {
      if (!fields.address.trim()) next.address = required
      if (!fields.phone.trim()) next.phone = required
      if (!fields.originalWork.trim()) next.originalWork = required
      if (!fields.signature.trim()) next.signature = required
      if (fields.originalWorkUrl.trim() && !/^https?:\/\//i.test(fields.originalWorkUrl.trim())) next.originalWorkUrl = t("complaints.invalidLink")
    }
    return next
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setState({ kind: "sending" })
    const common = {
      name: fields.name.trim(),
      email: fields.email.trim(),
      reportedContent: fields.reportedContent.trim(),
      explanation: fields.explanation.trim(),
      ...(fields.website ? { website: fields.website } : {}),
    }
    const body = copyright
      ? {
          kind: "copyright",
          ...common,
          address: fields.address.trim(),
          phone: fields.phone.trim(),
          claimantRole: fields.claimantRole,
          originalWork: fields.originalWork.trim(),
          ...(fields.originalWorkUrl.trim() ? { originalWorkUrl: fields.originalWorkUrl.trim() } : {}),
          signature: fields.signature.trim(),
          goodFaith: true,
          accuracy: true,
        }
      : {
          kind: "other",
          ...common,
          category: fields.category,
          ...(fields.address.trim() ? { address: fields.address.trim() } : {}),
          ...(fields.phone.trim() ? { phone: fields.phone.trim() } : {}),
        }
    try {
      const res = await fetch("/v1/content-complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.status === 202) {
        const answer = (await res.json()) as { data?: { reference?: string | null } }
        setState({ kind: "received", reference: answer.data?.reference ?? null })
        setFields(EMPTY)
        return
      }
      const message =
        res.status === 429 ? t("complaints.rateLimited") : res.status === 503 ? t("complaints.unavailable") : t("complaints.failed")
      setState({ kind: "failed", message })
    } catch {
      setState({ kind: "failed", message: t("complaints.failed") })
    }
  }

  return (
    // A complainant types their name, address, phone and signature here: session recordings mask the page.
    <div className="min-h-screen bg-background text-foreground" data-clarity-mask="true">
      <header className="border-b border-border px-6 py-4">
        <NodaroLogo />
      </header>
      <main className="mx-auto max-w-2xl space-y-8 px-6 py-10">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold">{t("complaints.title")}</h1>
          <p className="text-muted-foreground">{t("complaints.intro")}</p>
          <p className="text-sm text-muted-foreground">{t("complaints.reviewNote")}</p>
        </div>

        {verified === "ok" && (
          <p role="status" className="rounded-md border border-border bg-muted p-4">
            {t("complaints.verifiedOk")}
          </p>
        )}
        {verified === "invalid" && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
            {t("complaints.verifiedInvalid")}
          </p>
        )}

        {state.kind === "received" ? (
          <section aria-live="polite" className="space-y-3 rounded-md border border-border bg-muted p-6">
            <h2 className="text-xl font-semibold">{t("complaints.receivedTitle")}</h2>
            {state.reference && <p>{t("complaints.receivedRef", { reference: state.reference })}</p>}
            <p>{t("complaints.receivedVerify")}</p>
          </section>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-6">
            <fieldset className="space-y-2">
              <legend className="font-medium">{t("complaints.kind")}</legend>
              <RadioGroup value={kind} onValueChange={(v) => chooseKind(v as Kind)}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id={id("kind-copyright")} value="copyright" />
                  <Label htmlFor={id("kind-copyright")}>{t("complaints.kindCopyright")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id={id("kind-other")} value="other" />
                  <Label htmlFor={id("kind-other")}>{t("complaints.kindOther")}</Label>
                </div>
              </RadioGroup>
            </fieldset>

            {!copyright && (
              <fieldset className="space-y-2">
                <legend className="font-medium">{t("complaints.category")}</legend>
                <RadioGroup value={fields.category} onValueChange={(v) => set("category", v as OtherCategory)}>
                  {OTHER_CATEGORIES.map((category) => (
                    <div key={category} className="flex items-center gap-2">
                      <RadioGroupItem id={id(`cat-${category}`)} value={category} />
                      <Label htmlFor={id(`cat-${category}`)}>{t(CATEGORY_KEYS[category])}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            )}

            <Field id={id("name")} label={t("complaints.name")} error={errors.name}>
              <Input id={id("name")} value={fields.name} onChange={(e) => set("name", e.target.value)} maxLength={200} required aria-invalid={errors.name ? true : undefined} />
            </Field>
            <Field id={id("email")} label={t("complaints.email")} error={errors.email}>
              <Input id={id("email")} type="email" value={fields.email} onChange={(e) => set("email", e.target.value)} maxLength={320} required aria-invalid={errors.email ? true : undefined} />
            </Field>
            <Field id={id("address")} label={copyright ? t("complaints.address") : t("complaints.addressOptional")} error={errors.address}>
              <Input id={id("address")} value={fields.address} onChange={(e) => set("address", e.target.value)} maxLength={500} required={copyright} aria-invalid={errors.address ? true : undefined} />
            </Field>
            <Field id={id("phone")} label={copyright ? t("complaints.phone") : t("complaints.phoneOptional")} error={errors.phone}>
              <Input id={id("phone")} type="tel" value={fields.phone} onChange={(e) => set("phone", e.target.value)} maxLength={60} required={copyright} aria-invalid={errors.phone ? true : undefined} />
            </Field>

            {copyright && (
              <>
                <fieldset className="space-y-2">
                  <legend className="font-medium">{t("complaints.role")}</legend>
                  <RadioGroup value={fields.claimantRole} onValueChange={(v) => set("claimantRole", v as "owner" | "agent")}>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id={id("role-owner")} value="owner" />
                      <Label htmlFor={id("role-owner")}>{t("complaints.roleOwner")}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem id={id("role-agent")} value="agent" />
                      <Label htmlFor={id("role-agent")}>{t("complaints.roleAgent")}</Label>
                    </div>
                  </RadioGroup>
                </fieldset>
                <Field id={id("work")} label={t("complaints.originalWork")} error={errors.originalWork}>
                  <Textarea id={id("work")} value={fields.originalWork} onChange={(e) => set("originalWork", e.target.value)} maxLength={4000} rows={3} required aria-invalid={errors.originalWork ? true : undefined} />
                </Field>
                <Field id={id("work-url")} label={t("complaints.originalWorkUrl")} error={errors.originalWorkUrl}>
                  <Input id={id("work-url")} type="url" value={fields.originalWorkUrl} onChange={(e) => set("originalWorkUrl", e.target.value)} maxLength={4000} aria-invalid={errors.originalWorkUrl ? true : undefined} />
                </Field>
              </>
            )}

            <Field id={id("content")} label={t("complaints.reportedContent")} help={t("complaints.reportedContentHelp")} error={errors.reportedContent}>
              <Textarea id={id("content")} value={fields.reportedContent} onChange={(e) => set("reportedContent", e.target.value)} maxLength={8000} rows={4} required aria-describedby={errors.reportedContent ? `${id("content")}-error` : `${id("content")}-help`} aria-invalid={errors.reportedContent ? true : undefined} />
            </Field>
            <Field id={id("explanation")} label={copyright ? t("complaints.explanation") : t("complaints.explanationOther")} error={errors.explanation}>
              <Textarea id={id("explanation")} value={fields.explanation} onChange={(e) => set("explanation", e.target.value)} maxLength={8000} rows={5} required aria-invalid={errors.explanation ? true : undefined} />
            </Field>

            {copyright && (
              <>
                <fieldset className="space-y-3">
                  <legend className="font-medium">{t("complaints.statements")}</legend>
                  {statementsFailed ? (
                    <p role="alert" className="text-sm text-destructive">
                      {t("complaints.statementsFailed")}{" "}
                      <button type="button" className="underline" onClick={() => setStatementsAttempt((n) => n + 1)}>
                        {t("complaints.retry")}
                      </button>
                    </p>
                  ) : (
                    <>
                      <div className="flex items-start gap-2">
                        <Checkbox id={id("good-faith")} checked={fields.goodFaith} disabled={statements === null} onCheckedChange={(v) => set("goodFaith", v === true)} aria-required="true" />
                        <Label htmlFor={id("good-faith")} className="font-normal leading-relaxed">
                          {statements?.goodFaith ?? t("complaints.statementsLoading")}
                        </Label>
                      </div>
                      <div className="flex items-start gap-2">
                        <Checkbox id={id("accuracy")} checked={fields.accuracy} disabled={statements === null} onCheckedChange={(v) => set("accuracy", v === true)} aria-required="true" />
                        <Label htmlFor={id("accuracy")} className="font-normal leading-relaxed">
                          {statements?.accuracy ?? t("complaints.statementsLoading")}
                        </Label>
                      </div>
                      {!(fields.goodFaith && fields.accuracy) && <p className="text-sm text-muted-foreground">{t("complaints.statementsRequired")}</p>}
                    </>
                  )}
                </fieldset>
                <Field id={id("signature")} label={t("complaints.signature")} error={errors.signature}>
                  <Input id={id("signature")} value={fields.signature} onChange={(e) => set("signature", e.target.value)} maxLength={200} required aria-invalid={errors.signature ? true : undefined} />
                </Field>
              </>
            )}

            {/* A field only a form-filling bot fills: hidden from people and from screen readers. */}
            <div aria-hidden="true" className="sr-only">
              <label htmlFor={id("website")}>{t("complaints.website")}</label>
              <input id={id("website")} name="website" tabIndex={-1} autoComplete="off" value={fields.website} onChange={(e) => set("website", e.target.value)} />
            </div>

            {state.kind === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                {state.message}
              </p>
            )}
            {/* aria-disabled, not disabled: a disabled button drops the keyboard focus. */}
            <Button type="submit" aria-disabled={!canSubmit || undefined}>
              {sending ? t("complaints.sending") : t("complaints.submit")}
            </Button>
          </form>
        )}
      </main>
    </div>
  )
}
