import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { getAuthHeaders } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * The accessibility statement (Israeli Equal Rights for Persons with
 * Disabilities (Service Accessibility Adjustments) Regulations 2013, reg 35ה).
 *
 * Hebrew only, whatever the interface language (owner's decision 2026-10-23):
 * the text lives here, not in the five dictionaries, and the page sets its own
 * `lang="he" dir="rtl"`. It names no accessibility coordinator (fewer than 25
 * employees, reg 91). It is short on purpose (owner's decision 2026-10-23):
 * the level, what was made accessible, the accessibility menu, the content not
 * fully accessible, and how to report — the parts reg 35ה asks for.
 * Reports go to the founders through POST /v1/accessibility/report; when that
 * cannot deliver, the page gives the email instead.
 */

export const STATEMENT_UPDATED = "23 באוקטובר 2026"
export const REPORT_EMAIL = "info@nodaro.ai"

const DONE: readonly string[] = [
  "ניווט במקלדת, עם סימון ברור של המקום שבו נמצא המיקוד.",
  "תמיכה בקוראי מסך: לכפתורים, לשדות ולאזורים בדף יש שמות מתאימים.",
  "קישור ״דלג לתוכן״ באזור האישי ובעורך, ושם משלו לכל אחד מהדפים הראשיים.",
  "מבנה כותרות ותוויות לשדות בטפסים.",
  "ניגודיות צבעים לפי התקן בכפתורים ובטקסט של הממשק, וטקסט בגודל קריא.",
  "התאמה למחשב ולטלפון, ואפשרות להגדיל את התצוגה בדפדפן.",
  "תמיכה בעברית מימין לשמאל ובשפות נוספות.",
  "הפחתת אנימציות ומעברים למי שהגדיר ״הפחתת תנועה״ במכשיר.",
  "בעורך התהליכים אפשר לעבור בין רכיבים ולחבר ביניהם מהמקלדת.",
]

const LIMITS: readonly string[] = [
  "תמונות, סרטונים וקול שמשתמשים יוצרים או מעלים, כולל תוכן שנוצר בבינה מלאכותית.",
  "עורכי התמונה, הקול והווידאו המובנים, שמגיעים מצד שלישי.",
]

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

function ReportForm() {
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
        message:
          res.status === 429
            ? "שלחתם כמה דיווחים ברצף. נסו שוב בעוד כמה דקות, או כתבו לנו במייל."
            : "הדיווח לא נשלח. אפשר לכתוב לנו במייל.",
      })
    } catch {
      setState({ kind: "failed", message: "הדיווח לא נשלח. אפשר לכתוב לנו במייל." })
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="a11y-report-message">מה הבעיה? (חובה)</Label>
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
            כתבו כמה מילים על הבעיה.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a11y-report-page">באיזה דף? (לא חובה)</Label>
        <Input id="a11y-report-page" value={page} onChange={(e) => setPage(e.target.value)} maxLength={500} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a11y-report-contact">איך נחזור אליכם? מייל או טלפון (לא חובה)</Label>
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
        {sending ? "שולח…" : "שליחת הדיווח"}
      </Button>
      <div aria-live="polite" role="status">
        {state.kind === "sent" && <p className="text-sm">תודה. הדיווח הגיע אלינו ונטפל בו.</p>}
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
  // The page is Hebrew whatever the interface language, so the document says so
  // too (WCAG 3.1.1 reads <html lang>); the interface's values come back on leave.
  useEffect(() => {
    const html = document.documentElement
    const previous = { title: document.title, lang: html.lang, dir: html.dir }
    document.title = "הצהרת נגישות | Nodaro"
    html.lang = "he"
    html.dir = "rtl"
    return () => {
      document.title = previous.title
      html.lang = previous.lang
      html.dir = previous.dir
    }
  }, [])

  return (
    <div lang="he" dir="rtl" className="min-h-screen bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold">Nodaro</span>
          <Link to="/" className="text-sm underline underline-offset-4">
            חזרה לאתר
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl space-y-10 px-4 py-10 leading-relaxed">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold">הצהרת נגישות</h1>
          <p>
            אנחנו ב-Nodaro רוצים שכל אחד יוכל להשתמש באתר, כולל אנשים עם מוגבלות. ההצהרה הזו מתארת את מצב הנגישות של
            האתר app.nodaro.ai, לפי תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע״ג-2013.
          </p>
        </div>

        <Section title="רמת הנגישות">
          <p>
            ביצענו באתר התאמות נגישות לפי התקן הישראלי ת״י 5568 (חלק 1, ספטמבר 2023), שמבוסס על הנחיות WCAG 2.0
            ברמה AA.
          </p>
        </Section>

        <Section title="מה הונגש באתר">
          <ul className="list-disc space-y-1.5 ps-6">
            {DONE.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Section>

        <Section title="תפריט הנגישות">
          <p>
            בפינת המסך יש כפתור נגישות שפותח תפריט, וגם המקשים Alt+A פותחים אותו. בתפריט אפשר להגדיל את הטקסט, להגביר
            ניגודיות, להדגיש קישורים וכותרות, לעבור לגופן קריא, להגדיל ריווח, להגדיל את הסמן ולהפחית אנימציות. הבחירות
            נשמרות בדפדפן לביקור הבא.
          </p>
        </Section>

        <Section title="רכיבים שאינם נגישים במלואם">
          <p>למרות מאמצינו, ייתכן שתכנים מסוימים אינם נגישים במלואם:</p>
          <ul className="list-disc space-y-1.5 ps-6">
            {LIMITS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>אם נתקלתם בקושי, כתבו לנו ונעזור.</p>
        </Section>

        <Section title="נתקלתם בבעיית נגישות?">
          <p>
            ספרו לנו מה ניסיתם לעשות ובאיזה דף. כל דיווח מגיע ישירות אלינו. אפשר גם לכתוב במייל:{" "}
            <a href={`mailto:${REPORT_EMAIL}`} dir="ltr" className="underline">
              {REPORT_EMAIL}
            </a>
          </p>
          <ReportForm />
        </Section>

        <p className="text-sm">ההצהרה עודכנה לאחרונה: {STATEMENT_UPDATED}.</p>
      </main>
    </div>
  )
}
