/**
 * Reads every surface once and hands the model (model.ts) its inputs.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SURFACE_EXEMPTIONS } from "../../check-surfaces.exemptions.js"
import { NODE_TYPE_TO_TOOL } from "../gen-skills/node-type-to-tool.js"
import { extractCli } from "./cli.js"
import { apiDocMentions, cliDocMentions, mcpDocEntries, nodeDocs, parseSdkReference, SDK_REFERENCE } from "./docs.js"
import { extractMcp } from "./mcp.js"
import type { ModelInputs } from "./model.js"
import { openApiOperations, staticRoutes } from "./routes.js"
import { runtimeRoutes } from "./runtime-routes.js"
import { extractSdk } from "./sdk.js"

export async function collectInputs(
  repoRoot: string,
  opts: { runtime: "cloud" | "community" | null; sha: string },
): Promise<ModelInputs> {
  const sdk = extractSdk(repoRoot)
  const [cli, mcp] = await Promise.all([extractCli(repoRoot, new Set(sdk.methods.keys())), extractMcp(repoRoot)])
  const { routes: staticSet, classify } = await staticRoutes(repoRoot)
  const routes = opts.runtime ? await runtimeRoutes(repoRoot, opts.runtime, classify, staticSet) : staticSet
  const openapi = await openApiOperations(repoRoot)
  const { NODE_REGISTRY } = await import("../../../src/lib/node-registry.js")
  const { PARAMETER_NODE_TYPES } = await import("@nodaro/shared")
  return {
    edition: opts.runtime ?? "static",
    sha: opts.sha,
    routes,
    classify,
    openapi,
    sdk,
    sdkDocs: parseSdkReference(readFileSync(join(repoRoot, SDK_REFERENCE), "utf8")),
    cli,
    cliDocs: cliDocMentions(repoRoot, cli.commands.map((c) => c.path)),
    mcp,
    mcpDocs: mcpDocEntries(repoRoot),
    apiDocs: apiDocMentions(repoRoot),
    nodes: NODE_REGISTRY.map((n) => ({ type: n.type, category: n.category })),
    nodeTools: NODE_TYPE_TO_TOOL,
    parameterTypes: PARAMETER_NODE_TYPES,
    nodeDocs: await nodeDocs(repoRoot),
    exemptions: SURFACE_EXEMPTIONS,
  }
}
