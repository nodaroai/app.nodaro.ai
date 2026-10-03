// /tutorials/:slug — the guided view of a flow tutorial.
//
// Only templates registered in `tutorial-registry` have one; anything else is a
// 404 here and keeps using the ordinary template preview. The page owns data
// loading and the "start it for real" action; the look belongs to the body.

import { Suspense, useCallback, useEffect, useState } from "react"
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useT, tx } from "@/lib/i18n"
import { createClient } from "@/lib/supabase"
import { getTemplateBySlug, cloneTemplate, getModelCreditCost } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { formatCreditUnits } from "@/lib/credit-units"
import { useAuth } from "@/hooks/use-auth"
import { TutorialShell } from "@/components/tutorials/tutorial-shell"
import { getTutorial } from "@/components/tutorials/tutorial-registry"
import { useTutorialFocus } from "@/components/tutorials/use-tutorial-focus"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import "@/components/tutorials/tutorial-theme.css"

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="nd-tutorial">
      <div className="nd-state">{children}</div>
    </div>
  )
}

export default function TutorialPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const focus = useTutorialFocus()
  const t = useT()
  const [starting, setStarting] = useState(false)

  const definition = getTutorial(slug)

  // The guided view is keyed on the registry slug, but the template it reads
  // may live under another one: every freshly published template carries the
  // random suffix `generateSlug()` appends, until its slug migration lands on
  // main. `?template=<published-slug>` lets an author preview the guided view
  // against that real row in the meantime. It reads only what the template
  // endpoint already lets this user read (a listed row, or their own), so it
  // widens nothing — and the shell's Run clones the same row.
  const templateSlug = searchParams.get("template") || slug

  const { data: template, isLoading, isError } = useQuery({
    queryKey: ["tutorial-template", templateSlug],
    queryFn: () => getTemplateBySlug(templateSlug as string),
    enabled: !!templateSlug && !!definition,
    staleTime: 5 * 60_000,
  })

  // Plain effect rather than a query: this is one number, read once, and a
  // failure here must never keep the tutorial from rendering — the page is
  // still perfectly readable without a price on it.
  const startCostModel = definition?.startCostModel
  const [startCost, setStartCost] = useState<number | null>(null)
  useEffect(() => {
    if (!startCostModel || !hasCredits()) return
    let cancelled = false
    getModelCreditCost(startCostModel)
      .then((res) => {
        if (!cancelled) setStartCost(res.data.creditCost)
      })
      .catch(() => {
        if (!cancelled) setStartCost(null)
      })
    return () => {
      cancelled = true
    }
  }, [startCostModel])

  /**
   * A template is not runnable in place — a visitor does not own it. So both
   * run affordances do the one thing that actually works: clone it into the
   * user's default project and drop them in the editor, where the real Run
   * button and its credit guard live.
   */
  const startForReal = useCallback(async () => {
    if (!slug || !templateSlug || starting) return
    if (!user) {
      const search = searchParams.toString()
      navigate(`/login?next=${encodeURIComponent(`/tutorials/${slug}${search ? `?${search}` : ""}`)}`)
      return
    }
    setStarting(true)
    try {
      const { data: projectId, error } = await createClient().rpc("ensure_default_project")
      if (error || !projectId) throw new Error(error?.message ?? tx("misc.noProjectAvailable"))
      const result = await cloneTemplate(templateSlug, projectId as string, template?.name)
      navigate(`/projects/${result.projectId}/workflows/${result.workflowId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("misc.tutorialOpenFailed"))
      setStarting(false)
    }
  }, [slug, templateSlug, searchParams, starting, user, navigate, template?.name])

  if (!definition) {
    return (
      <Centered>
        <div>
          <p>{t("misc.tutorialNoGuidedView")}</p>
          <p style={{ marginTop: 12 }}>
            <Link to="/projects?tab=explore" style={{ color: "var(--nd-accent-dim)" }}>
              {t("misc.backToTutorials")}
            </Link>
          </p>
        </div>
      </Centered>
    )
  }
  if (isLoading) return <Centered>{t("misc.loadingTutorial")}</Centered>
  if (isError || !template) {
    return (
      <Centered>
        <div>
          <p>{t("misc.tutorialNotAvailable")}</p>
          <p style={{ marginTop: 12 }}>
            <Link to="/projects?tab=explore" style={{ color: "var(--nd-accent-dim)" }}>
              {t("misc.backToTutorials")}
            </Link>
          </p>
        </div>
      </Centered>
    )
  }

  const nodes = (template.snapshotNodes ?? []) as WorkflowNode[]
  const edges = (template.snapshotEdges ?? []) as WorkflowEdge[]
  const { Body, steps, minutes, note, chip } = definition

  // One cost, quoted in one place. The rail chip and the body's Run button both
  // read it, so they cannot drift apart.
  const credits = startCostModel
    ? (startCost ?? 0)
    : (template.estimatedCredits ?? 0)
  const costChip = hasCredits() ? (startCostModel ? t("misc.creditsToStart", { credits: formatCreditUnits(credits) }) : formatCreditUnits(credits)) : null

  const chips = [
    t("misc.nSteps", { n: steps.length }),
    `~${minutes} min`,
    ...(chip ? [chip] : costChip && credits > 0 ? [costChip] : []),
  ]

  return (
    <TutorialShell
      title={definition.title ?? template.name}
      summary={definition.summary ?? template.description ?? ""}
      breadcrumb={t("nav.tutorials")}
      steps={steps}
      chips={chips}
      focus={focus}
      nodes={nodes}
      edges={edges}
      note={note}
      onRun={startForReal}
      runLabel={starting ? t("misc.opening") : t("misc.runTutorial")}
      runDisabled={starting}
    >
      <Suspense fallback={<div className="nd-state">{t("common.loading")}</div>}>
        <Body
          nodes={nodes}
          edges={edges}
          focus={focus}
          estimatedCredits={hasCredits() ? credits : 0}
          onRunNode={startForReal}
        />
      </Suspense>
    </TutorialShell>
  )
}
