import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { getAuthHeaders } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useLocaleStore } from "@/lib/locale-store"
import { getLocaleDirection, type LocaleId } from "@nodaro/shared/i18n"
import { statementFor, statementIntro, type StatementForm } from "./statement-content"

/**
 * The accessibility statement (Israeli Equal Rights for Persons with
 * Disabilities (Service Accessibility Adjustments) Regulations 2013, reg 35ה).
 *
 * In the interface language (owner's decision 2026-10-23; the text and its
 * five copies live in statement-content.ts, a language without a copy reads
 * the English). It names no accessibility coordinator (fewer than 25
 * employees, reg 91). It is short on purpose: the level, what was made
 * accessible, the accessibility menu, the content not fully accessible, and
 * how to report — the parts reg 35ה asks for.
 * Reports go to the founders through POST /v1/accessibility/report; when that
 * cannot deliver, the page gives the email instead.
 */

export const REPORT_EMAIL = "info@nodaro.ai"

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

type ReportState = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string }

function ReportForm({ text }: { readonly text: StatementForm }) {
  const [message, setMessage] = useState("")
  const [page, setPage] = useState("")
  const [contact, setContact] = useState("")
  const [website, setWebsite] = useState("")
  const [state, setState] = useState<ReportState>({ kind: "idle" })
  const [missing, setMissing] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const sending = state.kind === "sending"

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    if (!message.trim()) {
      setMissing(true)
      messageRef.current?.focus()
      return
    }
    setMissing(false)
    setState({ kind: "sending" })
    try {
      // Signed in, the report names the account, so we can follow up; signed
      // out it goes anonymously (the route is public).
      const auth = await getAuthHeaders().catch(() => ({}))
      const res = await fetch("/v1/accessibility/report", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({
          message,
          page: page || undefined,
          contact: contact || undefined,
          website: website || undefined,
        }),
      })
      if (res.ok) {
        setState({ kind: "sent" })
        setMessage("")
        setPage("")
        setContact("")
        return
      }
      setState({
        kind: "failed",
        message: res.status === 429 ? text.rateLimited : text.failed,
      })
    } catch {
      setState({ kind: "failed", message: text.failed })
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="a11y-report-message">{text.message}</Label>
        <Textarea
          ref={messageRef}
          id="a11y-report-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          aria-required="true"
          aria-invalid={missing || undefined}
          aria-describedby={missing ? "a11y-report-message-error" : undefined}
          maxLength={2000}
          rows={5}
        />
        {missing && (
          <p id="a11y-report-message-error" role="alert" className="text-sm text-destructive">
            {text.messageMissing}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a11y-report-page">{text.page}</Label>
        <Input id="a11y-report-page" value={page} onChange={(e) => setPage(e.target.value)} maxLength={500} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a11y-report-contact">{text.contact}</Label>
        <Input
          id="a11y-report-contact"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={200}
        />
      </div>
      {/* A field only a form-filling bot fills: hidden from people and from screen readers. */}
      <div aria-hidden="true" className="sr-only">
        <label htmlFor="a11y-report-website">Website</label>
        <input
          id="a11y-report-website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>
      {/* aria-disabled, not disabled: a disabled button drops the keyboard focus. */}
      <Button type="submit" aria-disabled={sending || undefined}>
        {sending ? text.sending : text.send}
      </Button>
      <div aria-live="polite" role="status">
        {state.kind === "sent" && <p className="text-sm">{text.sent}</p>}
      </div>
      {state.kind === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}{" "}
          <a href={`mailto:${REPORT_EMAIL}`} dir="ltr" className="underline">
            {REPORT_EMAIL}
          </a>
        </p>
      )}
    </form>
  )
}

export default function AccessibilityStatementPage() {
  const locale = useLocaleStore((st) => st.locale)
  const text = statementFor(locale)
  const dir = getLocaleDirection(text.lang as LocaleId)

  // The copy shown may be the English one for a language without its own, so
  // the document follows the copy (WCAG 3.1.1 reads <html lang>); the
  // interface's values come back on leave.
  useEffect(() => {
    const html = document.documentElement
    const previous = { title: document.title, lang: html.lang, dir: html.dir }
    document.title = `${text.pageTitle} | Nodaro`
    html.lang = text.lang
    html.dir = dir
    return () => {
      document.title = previous.title
      html.lang = previous.lang
      html.dir = previous.dir
    }
  }, [text, dir])

  return (
    <div lang={text.lang} dir={dir} className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold">Nodaro</span>
          <Link to="/" className="text-sm underline underline-offset-4">
            {text.backToSite}
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl space-y-10 px-4 py-10 leading-relaxed">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold">{text.title}</h1>
          <p>{statementIntro(text)}</p>
        </div>

        <Section title={text.levelTitle}>
          <p>{text.level}</p>
        </Section>

        <Section title={text.doneTitle}>
          <ul className="list-disc space-y-1.5 ps-6">
            {text.done.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>

        <Section title={text.menuTitle}>
          <p>{text.menu}</p>
        </Section>

        <Section title={text.limitsTitle}>
          <p>{text.limitsIntro}</p>
          <ul className="list-disc space-y-1.5 ps-6">
            {text.limits.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{text.limitsOutro}</p>
        </Section>

        <Section title={text.reportTitle}>
          <p>
            {text.reportIntro}{" "}
            <a href={`mailto:${REPORT_EMAIL}`} dir="ltr" className="underline">
              {REPORT_EMAIL}
            </a>
          </p>
          <ReportForm text={text.form} />
        </Section>

        <p className="text-sm">{text.updated}</p>
      </main>
    </div>
  )
}
