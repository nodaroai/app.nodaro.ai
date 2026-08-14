// /tutorials/:slug — the guided view of a flow tutorial.
//
// Only templates registered in `tutorial-registry` have one; anything else is a
// 404 here and keeps using the ordinary template preview. The page owns data
// loading and the "start it for real" action; the look belongs to the body.

import { Suspense, useCallback, useEffect, useState } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase"
import { getTemplateBySlug, cloneTemplate, getModelCreditCost } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
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
  const navigate = useNavigate()
  const { user } = useAuth()
  const focus = useTutorialFocus()
  const [starting, setStarting] = useState(false)

  const definition = getTutorial(slug)

  const { data: template, isLoading, isError } = useQuery({
    queryKey: ["tutorial-template", slug],
    queryFn: () => getTemplateBySlug(slug as string),
    enabled: !!slug && !!definition,
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
    if (!slug || starting) return
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/tutorials/${slug}`)}`)
      return
    }
    setStarting(true)
    try {
      const { data: projectId, error } = await createClient().rpc("ensure_default_project")
      if (error || !projectId) throw new Error(error?.message ?? "No project available")
      const result = await cloneTemplate(slug, projectId as string, template?.name)
      navigate(`/projects/${result.projectId}/workflows/${result.workflowId}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open this tutorial")
      setStarting(false)
    }
  }, [slug, starting, user, navigate, template?.name])

  if (!definition) {
    return (
      <Centered>
        <div>
          <p>This tutorial does not have a guided view.</p>
          <p style={{ marginTop: 12 }}>
            <Link to="/projects?tab=tutorials" style={{ color: "var(--nd-accent-dim)" }}>
              Back to tutorials
            </Link>
          </p>
        </div>
      </Centered>
    )
  }
  if (isLoading) return <Centered>Loading tutorial…</Centered>
  if (isError || !template) {
    return (
      <Centered>
        <div>
          <p>This tutorial is not available yet.</p>
          <p style={{ marginTop: 12 }}>
            <Link to="/projects?tab=tutorials" style={{ color: "var(--nd-accent-dim)" }}>
              Back to tutorials
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
  const costChip = hasCredits() ? (startCostModel ? `${credits} CR to start` : `${credits} CR`) : null

  const chips = [
    `${steps.length} steps`,
    `~${minutes} min`,
    ...(chip ? [chip] : costChip && credits > 0 ? [costChip] : []),
  ]

  return (
    <TutorialShell
      title={definition.title ?? template.name}
      summary={definition.summary ?? template.description ?? ""}
      breadcrumb="Tutorials"
      steps={steps}
      chips={chips}
      focus={focus}
      nodes={nodes}
      edges={edges}
      note={note}
      onRun={startForReal}
      runLabel={starting ? "Opening…" : "Run tutorial"}
      runDisabled={starting}
    >
      <Suspense fallback={<div className="nd-state">Loading…</div>}>
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
