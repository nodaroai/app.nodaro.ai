/**
 * Compose and send one message to one user.
 *
 * There is no HTML editor here on purpose: the admin picks a template and fills
 * named blanks. What that buys is that every message is service-shaped by
 * construction — which is the thing that makes sending these without marketing
 * consent legitimate, so the dialog says so out loud rather than leaving it as
 * an unwritten rule.
 *
 * The preview comes from the SERVER, through the same renderer the send uses.
 * A locally-approximated preview would be a second implementation of the email,
 * and the first time it drifted an admin would approve one message and send
 * another.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Info, Loader2, Mail, Send } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AdminMessageError,
  useAdminMessagePreviewMutation,
  useAdminMessageTemplates,
  useAdminSendMessageMutation,
  type AdminMessageTemplate,
} from "@/ee/hooks/queries/use-admin-messages"
import { MessagePreview } from "./message-preview"
import { ScreenshotField } from "./screenshot-field"

/** Where replies actually land. Loops cannot receive email. */
export const REPLY_TO_ADDRESS = "info@nodaro.ai"

type Vars = Record<string, string>

/** The fields each template asks for, in the order they should be filled. */
const FIELDS: Record<string, ReadonlyArray<{ key: string; label: string; multiline: boolean; placeholder: string }>> = {
  issue_detected: [
    { key: "whatHappened", label: "What happened", multiline: true, placeholder: "Your video generation failed partway through on 2 September." },
    { key: "whatWeDid", label: "What we did", multiline: true, placeholder: "We refunded the credits and fixed the underlying bug." },
    { key: "nextStep", label: "Next step", multiline: true, placeholder: "Nothing to do — just re-run the workflow when you're ready." },
  ],
  credits_refunded: [
    { key: "amount", label: "Amount (credits)", multiline: false, placeholder: "1500" },
    { key: "reason", label: "Reason", multiline: true, placeholder: "A failed run on 2 September that was our fault." },
  ],
  general_followup: [
    { key: "subjectLine", label: "Subject", multiline: false, placeholder: "About your recent workflow" },
    { key: "bodyText", label: "Message", multiline: true, placeholder: "Hi — just following up on…" },
  ],
}

function initialVars(templateId: string): Vars {
  const out: Vars = {}
  for (const f of FIELDS[templateId] ?? []) out[f.key] = ""
  if (templateId === "general_followup") {
    out.ctaLabel = ""
    out.ctaUrl = ""
    out.imageUrl = ""
    out.imageLabel = ""
  }
  return out
}

/** Only send what the template asked for — an empty optional is omitted, not
 *  sent as "", so the server's paired-field validation reads it as absent. */
function toPayload(templateId: string, vars: Vars): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of FIELDS[templateId] ?? []) {
    out[f.key] = vars[f.key] ?? ""
  }
  if (templateId === "general_followup") {
    for (const k of ["ctaLabel", "ctaUrl", "imageUrl", "imageLabel"]) {
      const v = (vars[k] ?? "").trim()
      if (v) out[k] = v
    }
  }
  return out
}

export function MessageUserDialog({
  open,
  onOpenChange,
  userId,
  userEmail,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly userId: string
  readonly userEmail: string
}) {
  const { data: config, isLoading: loadingTemplates } = useAdminMessageTemplates()
  const previewMut = useAdminMessagePreviewMutation()
  const sendMut = useAdminSendMessageMutation()

  const templates = config?.templates ?? []
  const [templateId, setTemplateId] = useState("issue_detected")
  const [vars, setVars] = useState<Vars>(() => initialVars("issue_detected"))
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewSubject, setPreviewSubject] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  /**
   * Set when the provider never answered. Latches the dialog: the message may
   * already be in the recipient's inbox, so the only safe next actions are to
   * check the history or close — never to press Send again.
   */
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null)

  /**
   * Which draft an in-flight preview belongs to. Bumped on every edit; a
   * response whose token no longer matches is dropped rather than painted.
   *
   * SECOND line of defence, and deliberately so. The first is that `busy`
   * disables every field and both buttons while a preview is in flight, so a
   * response cannot currently be overtaken by an edit — which is why no test
   * here reaches this branch, and why the one written for it was dropped
   * instead of contorted into passing. The test for the LOCK is the real
   * coverage.
   *
   * It stays because the thing it protects is the feature's core promise —
   * that the preview an admin approves is the message that goes — and because
   * the lock is a UI decision that a later change could reasonably relax (a
   * non-blocking preview, an inline re-render on type). If that happens this
   * keeps the promise true instead of quietly breaking it.
   */
  const draftToken = useRef(0)

  const template: AdminMessageTemplate | undefined = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  )

  // The initial `templateId` is a compiled guess made before the server has
  // said which templates exist. If it turns out not to be one of them, fall to
  // the first the server DID offer — otherwise the Select displays a value that
  // is not among its own options and the admin cannot see what is selected.
  useEffect(() => {
    if (templates.length > 0 && !templates.some((t) => t.id === templateId)) {
      setTemplateId(templates[0].id)
    }
  }, [templates, templateId])

  // Switching template resets the form: the fields are different, and carrying
  // a half-filled body from one template into another is how a wrong message
  // gets sent.
  useEffect(() => {
    setVars(initialVars(templateId))
    // Invalidate an in-flight preview too — it was rendered for the template
    // being left behind.
    draftToken.current += 1
    setPreviewHtml(null)
    setPreviewSubject(null)
  }, [templateId])

  // A stale preview is worse than none — it is the thing the admin is about to
  // approve. Any edit clears it AND invalidates any preview still in flight.
  const discardPreview = () => {
    draftToken.current += 1
    setUnconfirmed(null)
    setPreviewHtml(null)
    setPreviewSubject(null)
  }

  const setVar = (key: string, value: string) => {
    setVars((prev) => ({ ...prev, [key]: value }))
    discardPreview()
  }

  const fields = FIELDS[templateId] ?? []
  // `fields.length > 0` is load-bearing, not defensive noise: `[].every()` is
  // true, so a template id this map does not know would render no inputs, count
  // as fully filled, and enable Send with an empty payload.
  const requiredFilled =
    fields.length > 0 && fields.every((f) => (vars[f.key] ?? "").trim().length > 0)
  const ctaHalfFilled =
    templateId === "general_followup" &&
    Boolean((vars.ctaLabel ?? "").trim()) !== Boolean((vars.ctaUrl ?? "").trim())
  const imageMissingLabel =
    Boolean((vars.imageUrl ?? "").trim()) && !(vars.imageLabel ?? "").trim()

  const loopsOff = config ? !config.loopsConfigured : false
  // `uploading` blocks BOTH buttons. Sending mid-upload delivered the message
  // without the screenshot and then closed the dialog on a success toast.
  const blocked =
    !requiredFilled || ctaHalfFilled || imageMissingLabel || loopsOff || uploading || unconfirmed !== null
  const busy = previewMut.isPending || sendMut.isPending

  const handlePreview = async () => {
    const token = draftToken.current
    try {
      const res = await previewMut.mutateAsync({
        userId,
        templateId,
        variables: toPayload(templateId, vars),
      })
      // The draft moved on while this was in flight — showing it now would be
      // a preview of text the admin has already changed.
      if (draftToken.current !== token) return
      setPreviewHtml(res.bodyHtml)
      setPreviewSubject(res.subject)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not render a preview")
    }
  }

  const handleSend = async () => {
    try {
      await sendMut.mutateAsync({ userId, templateId, variables: toPayload(templateId, vars) })
      toast.success(`Message sent to ${userEmail}`)
      onOpenChange(false)
    } catch (err) {
      // A send whose outcome we never learned is NOT a failed send, and the
      // difference has to reach the button. Leaving Send armed on this draft
      // put a possible duplicate one click away, on the same screen as a
      // warning telling the admin not to do exactly that.
      if (err instanceof AdminMessageError && err.code === "send_unconfirmed") {
        setUnconfirmed(err.message)
        return
      }
      toast.error(err instanceof Error ? err.message : "Failed to send the message")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Message user
          </DialogTitle>
          <DialogDescription>
            Sending to <span className="font-medium text-foreground">{userEmail}</span>
          </DialogDescription>
        </DialogHeader>

        {/* The two things an admin must know before they type a word. */}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="space-y-1">
              <p>
                <strong>Service messages only.</strong> These send regardless of marketing
                consent, so they must be genuinely about this person&apos;s own account —
                never promotion.
              </p>
              <p>
                Replies go to the shared <strong>{REPLY_TO_ADDRESS}</strong> inbox, not into
                this app. Nobody is notified here when they answer.
              </p>
            </div>
          </div>
        </div>

        {loopsOff && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            Email is not configured on this deployment, so nothing can be sent.
          </p>
        )}

        {/* Delivery unknown. Send is disabled behind this — the message may
            already have arrived, and the one thing that must not be one click
            away is a duplicate. Editing the draft clears it, because a changed
            draft is a different message. */}
        {unconfirmed && (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          >
            <p className="font-medium">Delivery unknown</p>
            <p className="mt-1">{unconfirmed}</p>
            <p className="mt-1">
              It is in the history below as still sending. Check with {userEmail} before
              sending anything else.
            </p>
          </div>
        )}

        {/* Template */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium">Template</Label>
          <Select value={templateId} onValueChange={setTemplateId} disabled={busy || loadingTemplates}>
            <SelectTrigger aria-label="Message template">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="z-[9999]">
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {template && <p className="text-[11px] text-muted-foreground">{template.description}</p>}
        </div>

        {/* Template fields */}
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key} className="text-xs font-medium">
                {f.label} <span className="text-destructive">*</span>
              </Label>
              {f.multiline ? (
                <Textarea
                  id={f.key}
                  rows={3}
                  value={vars[f.key] ?? ""}
                  placeholder={f.placeholder}
                  disabled={busy}
                  onChange={(e) => setVar(f.key, e.target.value)}
                />
              ) : (
                <Input
                  id={f.key}
                  value={vars[f.key] ?? ""}
                  placeholder={f.placeholder}
                  disabled={busy}
                  onChange={(e) => setVar(f.key, e.target.value)}
                />
              )}
            </div>
          ))}

          {templateId === "general_followup" && (
            <p className="text-[11px] text-muted-foreground">
              Formatting: line breaks, and <code>[label](https://…)</code> for links.
              Anything else is sent as plain text.
            </p>
          )}
        </div>

        {/* Optional CTA + screenshot — only where the template can show them */}
        {templateId === "general_followup" && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ctaLabel" className="text-xs font-medium">
                  Button text (optional)
                </Label>
                <Input
                  id="ctaLabel"
                  value={vars.ctaLabel ?? ""}
                  placeholder="Open your workflow"
                  disabled={busy}
                  onChange={(e) => setVar("ctaLabel", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ctaUrl" className="text-xs font-medium">
                  Button link
                </Label>
                <Input
                  id="ctaUrl"
                  value={vars.ctaUrl ?? ""}
                  placeholder="https://app.nodaro.ai/..."
                  disabled={busy}
                  onChange={(e) => setVar("ctaUrl", e.target.value)}
                  aria-invalid={ctaHalfFilled}
                />
              </div>
            </div>
            {ctaHalfFilled && (
              <p className="text-[11px] text-destructive">
                A button needs both the text and the link.
              </p>
            )}

            {template?.supportsImage && (
              <ScreenshotField
                imageUrl={vars.imageUrl ?? ""}
                imageLabel={vars.imageLabel ?? ""}
                disabled={busy}
                onUploadingChange={setUploading}
                onChange={(next) => {
                  // Both calls in the handler body. A state updater must be
                  // pure — React may invoke it twice or replay it — so the
                  // preview reset cannot live inside the setVars callback.
                  setVars((prev) => ({ ...prev, ...next }))
                  discardPreview()
                }}
              />
            )}
          </div>
        )}

        {/* Preview */}
        {previewHtml !== null && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Preview</Label>
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-xs">
                <span className="text-muted-foreground">Subject: </span>
                <span className="font-medium">{previewSubject}</span>
                {template && !template.subjectIsAuthored && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    from template
                  </span>
                )}
              </div>
              <MessagePreview bodyHtml={previewHtml} className="w-full bg-white" />
            </div>
            <p className="text-[11px] text-muted-foreground">
              The message body as it will be sent. The email&apos;s header and footer are
              added by the template.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handlePreview} disabled={blocked || busy}>
            {previewMut.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Preview
          </Button>
          <Button onClick={handleSend} disabled={blocked || busy}>
            {sendMut.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            {sendMut.isPending ? "Sending..." : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
