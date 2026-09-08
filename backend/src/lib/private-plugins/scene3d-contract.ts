import type { FastifyReply, FastifyRequest } from "fastify"

/** Optional, additive engine boundary. Public requests stay on the host API. */
export interface PluginScene3DEngine {
  capabilities(): Promise<PluginScene3DCapabilities>
  generate(request: FastifyRequest, reply: FastifyReply): Promise<unknown>
  edit(request: FastifyRequest, reply: FastifyReply): Promise<unknown>
}

export interface PluginScene3DCapabilities {
  version: string
  engines: Array<"blender-cloud" | "blender-local">
  sceneSchemaVersions: number[]
  maxRepairPasses: number
}

/** The scope is checked against the parent job before every journal access. */
export interface PluginStageKey {
  jobId: string
  userId: string
  attemptIndex: number
  stage: string
  inputHash: string
  engineVersion: string
}

export interface PluginStageLease {
  token: string
  fence: number
  expiresAt: number
}

export type PluginStageClaim =
  | { status: "claimed"; lease: PluginStageLease; checkpoint: Record<string, unknown> | null }
  | { status: "busy"; expiresAt: number }
  | { status: "completed"; output: Record<string, unknown> }

/** Private durable stage metadata, never placed in user-readable job output. */
export interface PluginStageToolkit {
  claim(key: PluginStageKey, leaseMs: number): Promise<PluginStageClaim>
  renew(key: PluginStageKey, lease: PluginStageLease, leaseMs: number): Promise<PluginStageLease | null>
  checkpoint(key: PluginStageKey, lease: PluginStageLease, checkpoint: Record<string, unknown>): Promise<boolean>
  complete(key: PluginStageKey, lease: PluginStageLease, output: Record<string, unknown>): Promise<boolean>
  release(key: PluginStageKey, lease: PluginStageLease): Promise<boolean>
}
