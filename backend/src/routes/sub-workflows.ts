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

interface WorkflowEdge {
  id: string
  source: string
  target: string
}

/**
 * Discover valid routes from parsed workflow nodes/edges.
 * A valid route = input + output with same routeId, and a directed path between them.
 */
function discoverRoutes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
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

    // BFS to verify directed path
    if (!hasPath(inputNode.id, matchingOutput.id, edges)) continue

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

function hasPath(sourceId: string, targetId: string, edges: WorkflowEdge[]): boolean {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? []
    list.push(edge.target)
    adjacency.set(edge.source, list)
  }

  const visited = new Set<string>()
  const queue = [sourceId]
  visited.add(sourceId)

  while (queue.length > 0) {
    const current = queue.shift()!
    if (current === targetId) return true

    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push(neighbor)
      }
    }
  }

  return false
}

export async function subWorkflowRoutes(app: FastifyInstance) {
  // GET /v1/workflows/callable?projectId= — returns workflows with valid routes
  app.get("/v1/workflows/callable", async (req, reply) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string | undefined
    if (!userId) {
      return reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const query = req.query as Record<string, string | undefined>
    const projectId = query.projectId

    let dbQuery = supabase
      .from("workflows")
      .select("id, name, project_id, nodes, edges, projects(name)")
      .eq("user_id", userId)

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
      const edges = (wf.edges as WorkflowEdge[]) ?? []
      const routes = discoverRoutes(nodes, edges)
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
    const userId = (req as unknown as Record<string, unknown>).userId as string | undefined
    if (!userId) {
      return reply
        .status(401)
        .send({ error: { code: "unauthorized", message: "Authentication required" } })
    }

    const params = req.params as { id: string }

    const { data: wf, error } = await supabase
      .from("workflows")
      .select("id, nodes, edges")
      .eq("id", params.id)
      .eq("user_id", userId)
      .single()

    if (error || !wf) {
      return reply
        .status(404)
        .send({ error: { code: "not_found", message: "Workflow not found" } })
    }

    const nodes = (wf.nodes as WorkflowNode[]) ?? []
    const edges = (wf.edges as WorkflowEdge[]) ?? []
    const routes = discoverRoutes(nodes, edges)

    return { data: { routes } }
  })
}
