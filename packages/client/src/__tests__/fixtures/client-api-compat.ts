/**
 * A consumer of the BUILT package, compiled by client-core.test.ts: what code
 * written against `NodaroClient` before it gained `NodaroClientCore` as its base
 * class does, plus what the core lets an app do. It must compile with no
 * errors (each `@ts-expect-error` must also be an error).
 */
import {
  createClient,
  NodaroClient,
  NodaroClientCore,
  StaticTokenAuth,
  JobsResource,
  NodesResource,
  Scene3DResource,
  SessionsResource,
  type ClientOptions,
} from "@nodaro/sdk"
import * as sdk from "@nodaro/sdk"
import { NodaroClientCore as CoreFromEntry, CallbackAuth as CoreCallbackAuth } from "@nodaro/sdk/core"
import { CallbackAuth as ClientCallbackAuth, createClient as createFromEntry } from "@nodaro/sdk/client"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const assert = <T extends true>(): T => true as T

const options: ClientOptions = { baseUrl: "https://api.example.com", auth: new StaticTokenAuth("t") }

// createClient and the class keep their types.
const client: NodaroClient = createClient(options)
assert<Equal<ReturnType<typeof createClient>, NodaroClient>>()
assert<Equal<ReturnType<typeof createFromEntry>, NodaroClient>>()
assert<Equal<ReturnType<NodaroClient["withWorkspace"]>, NodaroClient>>()

/**
 * The public members of NodaroClient — exactly the ones it had before the
 * core existed: the config and transport, the identity calls, every resource
 * and withWorkspace. A member added or removed fails here.
 */
type PublicMembers =
  | "baseUrl" | "auth" | "timeoutMs" | "clientLabel" | "fetch" | "workspaceId"
  | "requestBytes" | "request" | "requestText" | "me" | "connectedApps" | "revokeConnectedApp"
  | "withWorkspace"
  | "workflows" | "projects" | "sessions" | "trash" | "jobs" | "videoPro" | "executions" | "nodes" | "scene3d"
  | "developerApps" | "oauth" | "webhooks" | "apps" | "characters" | "locations" | "objects" | "creatures"
  | "pipelines" | "reduce" | "promptHelper" | "voices" | "llm" | "media" | "audio" | "credits" | "billing"
  | "uploads" | "library" | "gallery" | "presets" | "savedPosts" | "collections" | "palettes" | "moodboards"
  | "competitors" | "pickerCatalogs" | "catalogs" | "models" | "shots" | "recast" | "castSwap" | "trends" | "studio" | "copilot"
  | "community" | "templates" | "tutorials" | "organizations" | "workspaces" | "edit"
assert<Equal<keyof NodaroClient, PublicMembers>>()

// Every resource property is still its resource class.
assert<Equal<NodaroClient["sessions"], SessionsResource>>()
assert<Equal<NodaroClient["jobs"], JobsResource>>()
assert<Equal<NodaroClient["nodes"], NodesResource>>()
assert<Equal<NodaroClient["scene3d"], Scene3DResource>>()

// Every resource class exported by the package can still be built from a NodaroClient.
type ResourceClasses = { [K in keyof typeof sdk as K extends `${string}Resource` ? K : never]: (typeof sdk)[K] }
type TakesNodaroClient<C> = C extends new (client: infer P, ...rest: never[]) => unknown ? (NodaroClient extends P ? true : false) : true
assert<Equal<{ [K in keyof ResourceClasses]: TakesNodaroClient<ResourceClasses[K]> }[keyof ResourceClasses], true>>()
new SessionsResource(client)
new Scene3DResource(client)

// A NodaroClient is a NodaroClientCore; a subclass of NodaroClient still works.
const core: NodaroClientCore = client
class LabelledClient extends NodaroClient {
  constructor(opts: ClientOptions) {
    super({ ...opts, clientLabel: "my-app/1" })
  }
}
const labelled: NodaroClient = new LabelledClient(options).withWorkspace("ws")

// The core: a client with only the resources an app uses.
class SlimClient extends CoreFromEntry {
  readonly jobs = new JobsResource(this)
  readonly nodes = new NodesResource(this)
  readonly scene3d = new Scene3DResource(this)
}
const slim = new SlimClient({ baseUrl: "", auth: new CoreCallbackAuth(async () => null) })
const slimCore: NodaroClientCore = slim

// A resource that calls another through the client needs it on the same client.
class MissingJobs extends NodaroClientCore {
  // @ts-expect-error — NodesResource polls through `jobs`
  readonly nodes = new NodesResource(this)
}

// The auth strategies are the same bindings from either entry.
assert<Equal<typeof CoreCallbackAuth, typeof ClientCallbackAuth>>()

export { core, labelled, slim, slimCore, MissingJobs }
