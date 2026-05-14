import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"

// Types mirroring frontend definitions
interface SubWorkflowPort {
  id: string
  name: string
  mediaType: "text" | "image" | "video" | "audio" | "any"
}

interface SubWorkflowRouteSnapshot {
  routeId: string
  inputLabel: string
  inputPorts: SubWorkflowPort[]
  outputPorts: SubWorkflowPort[]
  visibleOutputPortId: string
}

interface WorkflowNode {
  id: string
  type: string
  data: Record<string, unknown>
}

// Zod schemas
const callableQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
})

const interfaceParamsSchema = z.object({
  id: z.string().uuid(),
})

/**
 * Discover valid routes from parsed workflow nodes/edges.
 * A valid route = input + output with same routeId.
 * Path connectivity is verified at execution time, not at discovery,
 * so partially-wired workflows still appear in the picker.
 */
function discoverRoutes(
  nodes: WorkflowNode[],
): SubWorkflowRouteSnapshot[] {
  const inputNodes = nodes.filter((n) => n.type === "sub-workflow-input")
  const outputNodes = nodes.filter((n) => n.type === "sub-workflow-output")

  const routes: SubWorkflowRouteSnapshot[] = []

  for (const inputNode of inputNodes) {
    const routeId = inputNode.data.routeId as string | undefined
    if (!routeId) continue

    const matchingOutput = outputNodes.find(
      (n) => (n.data.routeId as string) === routeId,
    )
    if (!matchingOutput) continue

    routes.push({
      routeId,
      inputLabel: (inputNode.data.label as string) || "Unnamed",
      inputPorts: (inputNode.data.ports as SubWorkflowPort[]) || [],
      outputPorts: (matchingOutput.data.ports as SubWorkflowPort[]) || [],
      visibleOutputPortId:
        (matchingOutput.data.visibleOutputPortId as string) || "",
    })
  }

  return routes
}

export async function subWorkflowRoutes(app: FastifyInstance) {
  // GET /v1/workflows/callable?projectId= — returns workflows with valid routes
  app.get("/v1/workflows/callable", async (req, reply) => {
    if (!req.userId) {
      return reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = callableQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "bad_request", message: parsed.error.message } })
    }

    const { projectId } = parsed.data

    let dbQuery = supabase
      .from("workflows")
      .select("id, name, project_id, nodes, projects(name)")
      .eq("user_id", req.userId)
      .is("parent_workflow_id", null)
      .limit(200)

    if (projectId) {
      dbQuery = dbQuery.eq("project_id", projectId)
    }

    const { data: workflows, error } = await dbQuery

    if (error) {
      return reply
        .status(500)
        .send({ error: { code: "internal_error", message: error.message } })
    }

    const callableWorkflows: Array<{
      id: string
      name: string
      projectId: string
      projectName: string
      routes: SubWorkflowRouteSnapshot[]
    }> = []

    for (const wf of workflows ?? []) {
      const nodes = (wf.nodes as WorkflowNode[]) ?? []
      const routes = discoverRoutes(nodes)
      if (routes.length > 0) {
        const project = wf.projects as unknown as { name: string } | null
        callableWorkflows.push({
          id: wf.id,
          name: wf.name || "Unnamed Workflow",
          projectId: wf.project_id,
          projectName: project?.name || "Unknown Project",
          routes,
        })
      }
    }

    return { data: callableWorkflows }
  })

  // GET /v1/workflows/:id/interface — returns route interface of a specific workflow
  app.get("/v1/workflows/:id/interface", async (req, reply) => {
    if (!req.userId) {
      return reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const parsed = interfaceParamsSchema.safeParse(req.params)
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { code: "bad_request", message: parsed.error.message } })
    }

    const { data: wf, error } = await supabase
      .from("workflows")
      .select("id, nodes")
      .eq("id", parsed.data.id)
      .eq("user_id", req.userId)
      .single()

    if (error || !wf) {
      return reply
        .status(404)
        .send({ error: { code: "not_found", message: "Workflow not found" } })
    }

    const nodes = (wf.nodes as WorkflowNode[]) ?? []
    const routes = discoverRoutes(nodes)

    return { data: { routes } }
  })
}
