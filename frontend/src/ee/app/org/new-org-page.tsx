import { useCallback, useMemo, useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/query-keys"
import { hydrateWorkspaces } from "@/lib/workspace-context"
import { OrgApiError, createOrganization, type OrganizationView } from "@/ee/lib/orgs-api"

/**
 * `/org/new` — creating an organization.
 *
 * The kind is the one irreversible choice on this page, so it is made with
 * two cards that say what each kind actually DOES rather than a dropdown of
 * two words. The differences shown are the settings that differ, in plain
 * terms: who can see whose work, and whether members can start projects.
 *
 * A school additionally asks for an attestation, because enrolling students
 * is a commitment about people who are not in the room.
 *
 * The slug follows the name until someone edits it, and then stops — the
 * usual rule, and the one people expect: a field that keeps overwriting what
 * you typed is worse than one that occasionally needs a second look.
 */

type Kind = "school" | "team"

const KINDS: Array<{
  value: Kind
  title: string
  blurb: string
  points: string[]
}> = [
  {
    value: "school",
    title: "School",
    blurb: "Classes of students, with teachers who can see and steer their work.",
    points: [
      "Work starts private; students share it deliberately",
      "Teachers can open and edit a student's work",
      "Students work inside a class rather than starting projects",
      "Per-student spending limits are available",
    ],
  },
  {
    value: "team",
    title: "Team",
    blurb: "Colleagues working in the open, on shared briefs.",
    points: [
      "Work is visible to the team by default",
      "Members can edit each other's shared work",
      "Anyone can start a project",
      "No per-member limits unless you turn them on",
    ],
  },
]

export default function NewOrgPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [kind, setKind] = useState<Kind>("team")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [created, setCreated] = useState<OrganizationView | null>(null)

  const derivedSlug = useMemo(() => slugify(name), [name])
  const effectiveSlug = slugTouched ? slug : derivedSlug

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault()
      if (busy || name.trim().length === 0) return
      setBusy(true)
      setProblem(null)
      try {
        const org = await createOrganization({
          name: name.trim(),
          kind,
          // Only send a slug the person actually chose: a derived one is the
          // server's job, and sending it turns a free collision into a 409.
          ...(slugTouched && slug ? { slug } : {}),
          ...(kind === "school" ? { acceptTerms } : {}),
        })
        await hydrateWorkspaces()
        await queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })
        // A pending organization has nothing to show yet, so the page says so
        // rather than navigating into an empty console.
        if (org.status === "pending") setCreated(org)
        else navigate(`/org/${org.slug}`, { replace: true })
      } catch (err: unknown) {
        setProblem(failureMessage(err instanceof OrgApiError ? err.code : "internal_error", err))
      } finally {
        setBusy(false)
      }
    },
    [busy, name, kind, slug, slugTouched, acceptTerms, navigate, queryClient],
  )

  if (created) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">{created.name} is waiting for approval</h1>
          <p className="text-sm text-muted-foreground">
            New organizations are reviewed before they open. You will be able to add people and create{" "}
            {created.kind === "school" ? "classes" : "teams"} as soon as it is approved — nothing else is needed from
            you.
          </p>
          <Button asChild variant="outline">
            <Link to="/">Back to your work</Link>
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <Card className="p-8">
        <form onSubmit={submit} className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Create an organization</h1>
            <p className="text-sm text-muted-foreground">
              Somewhere for a group to work together. You can change the name and the settings later; the kind is
              fixed once it exists.
            </p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">What kind of group is this?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {KINDS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === option.value}
                  onClick={() => setKind(option.value)}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors",
                    kind === option.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                  )}
                >
                  <span className="block font-medium">{option.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{option.blurb}</span>
                  <ul className="mt-3 space-y-1">
                    {option.points.map((point) => (
                      <li key={point} className="text-xs text-muted-foreground">
                        · {point}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "school" ? "Sunrise School" : "Acme Design"}
              maxLength={120}
              autoFocus
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="org-slug">Address</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">/org/</span>
              <Input
                id="org-slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value.toLowerCase())
                }}
                placeholder="sunrise-school"
                maxLength={50}
                disabled={busy}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {slugTouched
                ? "Lower-case letters, digits and hyphens."
                : "Taken from the name. Edit it if you would rather choose."}
            </p>
          </div>

          {kind === "school" && (
            <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
              <Checkbox
                checked={acceptTerms}
                onCheckedChange={(v) => setAcceptTerms(v === true)}
                disabled={busy}
                aria-label="Accept the organization terms"
              />
              <span className="text-muted-foreground">
                I have the authority to enrol students in this school and accept the organization terms on its behalf.
              </span>
            </label>
          )}

          {problem && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{problem}</p>}

          <Button
            type="submit"
            disabled={busy || name.trim().length === 0 || (kind === "school" && !acceptTerms)}
            className="w-full"
          >
            {busy ? "Creating…" : "Create organization"}
          </Button>
        </form>
      </Card>
    </div>
  )
}

/**
 * The same shape the server derives, so the field previews what will
 * actually happen. It is a PREVIEW, not a decision: an untouched slug is not
 * sent, and the server picks a free one.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "")
}

function failureMessage(code: string, err: unknown): string {
  switch (code) {
    case "name_taken":
      return "That address is already taken. Choose another."
    case "terms_required":
      return "A school needs the attestation above before it can be created."
    case "rate_limit_exceeded":
      return "You have created several organizations recently. Try again later."
    case "validation_error":
      return err instanceof OrgApiError && err.message ? err.message : "Check the name and address and try again."
    default:
      return "Something went wrong creating the organization. Try again in a moment."
  }
}
