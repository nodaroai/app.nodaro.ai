import { useId, useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import type { MyRestriction } from "@/lib/api"
import { useCounterNoticeDeclaration, useSendCounterNotice } from "@/hooks/queries/use-my-restrictions"

/** The longest each detail may be, as the server takes it (routes/counter-notices.ts). */
const MAX_LENGTH = { name: 200, email: 320, address: 1000, phone: 60, signature: 200, content: 4000, location: 4000 } as const

type DetailKey = keyof typeof MAX_LENGTH
type Details = Readonly<Record<DetailKey, string>>

/**
 * What was restricted, in English: the counter-notification is forwarded to
 * the complainant beside the English declaration, whatever the language the
 * sender reads the app in.
 */
function englishItemName(restriction: MyRestriction): string {
  return restriction.item.name ?? (restriction.item.kind === "file" ? "A file" : "A generated result")
}

/** One detail of the sender: a labelled input, or a text area for those that may break lines. */
function DetailField({
  formId,
  field,
  label,
  value,
  onChange,
  multiline = false,
  type = "text",
  autoComplete,
}: {
  readonly formId: string
  readonly field: DetailKey
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly multiline?: boolean
  readonly type?: string
  readonly autoComplete?: string
}) {
  const id = `${formId}-${field}`
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea id={id} rows={2} value={value} maxLength={MAX_LENGTH[field]} onChange={(e) => onChange(e.target.value)} required />
      ) : (
        <Input id={id} type={type} value={value} maxLength={MAX_LENGTH[field]} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} required />
      )}
    </div>
  )
}

/** The declaration, shown verbatim as the server holds it, each statement ticked on its own. */
function DeclarationStatements({
  formId,
  declaration,
  statements,
}: {
  readonly formId: string
  readonly declaration: ReturnType<typeof useCounterNoticeDeclaration>
  readonly statements: ReadonlyArray<{ readonly key: string; readonly label: string; readonly checked: boolean; readonly onChange: (ticked: boolean) => void }>
}) {
  const t = useT()
  const paragraphs = declaration.data?.paragraphs ?? []
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{t("restrictions.form.declaration")}</legend>
      <p className="text-xs text-muted-foreground">{t("restrictions.form.declarationLanguage")}</p>
      {declaration.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : declaration.isError ? (
        <p className="text-sm text-red-600">{t("apiErr.counterNoticeDeclaration")}</p>
      ) : (
        statements.map((statement, i) => (
          <div key={statement.key} className="space-y-2 rounded-md bg-muted/40 p-3">
            <p dir="ltr" lang="en" className="text-start text-sm">{paragraphs[i]}</p>
            <div className="flex items-start gap-2">
              <Checkbox id={`${formId}-${statement.key}`} checked={statement.checked} onCheckedChange={(v) => statement.onChange(v === true)} />
              <Label htmlFor={`${formId}-${statement.key}`} className="text-sm font-normal leading-snug">{statement.label}</Label>
            </div>
          </div>
        ))
      )}
    </fieldset>
  )
}

/** The details as they are sent: trimmed, with the declaration's hash and both statements affirmed. */
function submissionOf(details: Details, declarationHash: string) {
  return {
    name: details.name.trim(),
    email: details.email.trim(),
    address: details.address.trim(),
    phone: details.phone.trim(),
    signature: details.signature.trim(),
    contentIdentification: details.content.trim(),
    locationBefore: details.location.trim(),
    declarationHash,
    perjury: true as const,
    jurisdiction: true as const,
  }
}

/**
 * The form's state and its send. Each statement is affirmed for the wording
 * shown (the hash it was ticked under), so a declaration that changed
 * meanwhile is read again and both statements must be affirmed anew.
 */
function useCounterNoticeDraft(restriction: MyRestriction, defaultEmail: string, onDone: () => void) {
  const t = useT()
  const declaration = useCounterNoticeDeclaration(true)
  const send = useSendCounterNotice()
  const item = englishItemName(restriction)
  const [details, setDetails] = useState<Details>({
    name: "",
    email: defaultEmail,
    address: "",
    phone: "",
    content: `${item} (complaint ${restriction.caseReference})`,
    location: `In my Nodaro account: ${item}`,
    signature: "",
  })
  const [perjuryFor, setPerjuryFor] = useState<string | null>(null)
  const [jurisdictionFor, setJurisdictionFor] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const hash = declaration.data?.hash ?? null
  const perjury = hash !== null && perjuryFor === hash
  const jurisdiction = hash !== null && jurisdictionFor === hash
  const ready = Object.values(details).every((value) => value.trim() !== "") && perjury && jurisdiction && !send.isPending

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || hash === null) return
    setProblem(null)
    try {
      const { data } = await send.mutateAsync({ restrictionId: restriction.id, input: submissionOf(details, hash) })
      toast.success(t("restrictions.form.sent", { reference: data.reference }))
      onDone()
    } catch (err) {
      if ((err as { code?: string }).code === "declaration_changed") {
        setPerjuryFor(null)
        setJurisdictionFor(null)
        setProblem(t("restrictions.form.declarationChanged"))
        void declaration.refetch()
        return
      }
      setProblem(err instanceof Error ? err.message : t("apiErr.sendCounterNotice"))
    }
  }

  const setDetail = (key: DetailKey) => (value: string) => setDetails((current) => ({ ...current, [key]: value }))
  const tick = (set: (hash: string | null) => void) => (ticked: boolean) => set(ticked ? hash : null)
  return { declaration, details, setDetail, perjury, jurisdiction, tickPerjury: tick(setPerjuryFor), tickJurisdiction: tick(setJurisdictionFor), problem, ready, pending: send.isPending, submit }
}

/**
 * The counter-notification for one restriction: the sender's details, what
 * was restricted and where it was (prefilled in English, editable), and the
 * declaration, read from the server and shown verbatim, each statement
 * affirmed on its own and only for the wording shown. That the details go to
 * the person who complained is said before the button, never after. Masked
 * from session recordings: it holds a person's address and phone.
 */
export function CounterNoticeForm({ restriction, defaultEmail, onDone }: { readonly restriction: MyRestriction; readonly defaultEmail: string; readonly onDone: () => void }) {
  const t = useT()
  const id = useId()
  const draft = useCounterNoticeDraft(restriction, defaultEmail, onDone)
  const detail = (field: DetailKey, label: string, opts: { multiline?: boolean; type?: string; autoComplete?: string } = {}) => (
    <DetailField formId={id} field={field} label={label} value={draft.details[field]} onChange={draft.setDetail(field)} {...opts} />
  )

  return (
    <form onSubmit={draft.submit} className="mt-4 space-y-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4" data-clarity-mask="true" aria-labelledby={`${id}-title`}>
      <div className="space-y-1">
        <h3 id={`${id}-title`} className="text-base font-semibold">{t("restrictions.form.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("restrictions.form.intro")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {detail("name", t("restrictions.form.name"), { autoComplete: "name" })}
        {detail("email", t("restrictions.form.email"), { type: "email", autoComplete: "email" })}
        {detail("address", t("restrictions.form.address"), { multiline: true, autoComplete: "street-address" })}
        {detail("phone", t("restrictions.form.phone"), { type: "tel", autoComplete: "tel" })}
      </div>
      {detail("content", t("restrictions.form.content"), { multiline: true })}
      {detail("location", t("restrictions.form.location"), { multiline: true })}
      <DeclarationStatements
        formId={id}
        declaration={draft.declaration}
        statements={[
          { key: "perjury", label: t("restrictions.form.perjury"), checked: draft.perjury, onChange: draft.tickPerjury },
          { key: "jurisdiction", label: t("restrictions.form.jurisdiction"), checked: draft.jurisdiction, onChange: draft.tickJurisdiction },
        ]}
      />
      {detail("signature", t("restrictions.form.signature"), { autoComplete: "name" })}

      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{t("restrictions.form.forwardWarning")}</p>
      {draft.problem && <p role="alert" className="text-sm text-red-600">{draft.problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!draft.ready}>
          {draft.pending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {t("restrictions.form.submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={draft.pending}>{t("restrictions.form.cancel")}</Button>
      </div>
    </form>
  )
}
