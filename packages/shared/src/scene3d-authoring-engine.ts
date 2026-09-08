/**
 * WHICH authoring lane a Generate/Edit 3D Scene run goes down.
 *
 * There are two, and they are not interchangeable. Basic is the v1 LLM
 * authoring path the platform has always had; Advanced is the installed
 * private engine (`blender-cloud` / `blender-local`) that authors and edits
 * schema-v2 scenes. The wire difference is one field — an `engine` on the body
 * makes `POST /v1/3d-scene/{generate,edit}` hand the request to the private
 * engine instead of the Basic guard.
 *
 * Deciding that is NOT a per-surface choice. The canvas executor and the
 * headless orchestrator run the same nodes, and a node that means "Advanced"
 * in the browser and "Basic" in a scheduled run is a scene authored by a
 * different engine depending on who pressed Run. So the decision lives here,
 * once, and both callers spread the SAME `fields` onto their request body.
 *
 * Three refusals, each of which used to be a silent wrong answer:
 *
 *  - a **v2 plan on the Basic lane** is refused, never downgraded. Basic parses
 *    `scene3DPlanV1Schema`, so a v2 scene reaches it as a wall of Zod issues
 *    (the "Pro composition → Edit 3D Scene 400s" report) — and if it ever did
 *    parse, it would author from a scene it cannot represent.
 *  - an **explicitly requested engine this install does not have** is refused
 *    rather than quietly becoming Basic. Falling back would charge the user for
 *    a different pipeline than the one they picked.
 *  - an **unknown engine name** is refused before anything is spent.
 */
import {
  SCENE3D_SCHEMA_VERSION,
} from "./scene3d.js"
import {
  SCENE3D_SCHEMA_VERSION_V2,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
  SCENE3D_V2_ENGINES,
  type Scene3DKnownEngine,
} from "./scene3d-v2.js"
import { isKnownScene3DEngine, scene3DPlanSchemaVersion } from "./scene3d-v2-plan.js"

/** The value that names the Basic lane explicitly. Absent means the same. */
export const SCENE3D_BASIC_ENGINE = "basic"

/** Everything a caller may put in `engine` on a Generate/Edit request. */
export const SCENE3D_AUTHORING_ENGINES = [SCENE3D_BASIC_ENGINE, ...SCENE3D_V2_ENGINES] as const
export type Scene3DAuthoringEngine = (typeof SCENE3D_AUTHORING_ENGINES)[number]

/**
 * The engine an Advanced run picks when nothing else names one.
 *
 * Hosted cloud, because that is the contract's default lane; `blender-local`
 * is never inferred — it needs a paired desktop and its own deployment flag,
 * so it is only ever used when it was explicitly asked for or when the scene
 * under edit was authored by it and this install still offers it.
 */
export const SCENE3D_DEFAULT_ADVANCED_ENGINE: Scene3DKnownEngine = "blender-cloud"

export function isScene3DAuthoringEngine(value: unknown): value is Scene3DAuthoringEngine {
  return typeof value === "string" && (SCENE3D_AUTHORING_ENGINES as readonly string[]).includes(value)
}

export interface Scene3DEngineChoiceInput {
  /** The node's/caller's explicit selection. `undefined` = "not chosen". */
  requested?: string | null
  /**
   * The plan the run edits, for an edit. Omit for generate.
   *
   * The raw plan rather than a version number on purpose: the caller already
   * holds it, and reading the version here is the ONE place the "v2 never goes
   * to Basic" rule can be enforced for every surface at once.
   */
  plan?: unknown
  /**
   * Advanced engines this install can actually serve, from
   * `GET /v1/3d-scene/capabilities`.
   *
   * `undefined` means NOT KNOWN (the headless orchestrator never asks, and the
   * browser has not had the answer back yet) — which is different from "none".
   * Unknown proceeds and lets the route refuse honestly with
   * `SCENE_CAPABILITY_UNAVAILABLE`; a known-empty list refuses here, before a
   * request that cannot succeed is sent.
   */
  availableEngines?: readonly string[] | undefined
}

/** The extra body fields an Advanced request carries. Empty on Basic, so the
 *  Basic request stays byte-identical to what it has always been. */
export interface Scene3DEngineRequestFields {
  engine?: Scene3DKnownEngine
  /**
   * Which scene schema versions the CALLER can read back.
   *
   * Contract §5: an advanced authoring request declares this so the engine
   * never answers with a revision the caller cannot render. Both of our
   * surfaces read v1 and v2, so both send the same list.
   */
  acceptedSceneSchemaVersions?: number[]
}

export type Scene3DEngineChoiceRefusalCode =
  /** The name is not an engine this contract knows. */
  | "unknown_engine"
  /** Explicitly asked for an engine this install does not serve. */
  | "engine_unavailable"
  /** A v2 scene was pointed at the Basic lane. */
  | "schema_requires_advanced"
  /** The scene claims a version nothing here can author against. */
  | "unsupported_schema_version"
  /** v2 scene, and no Advanced engine installed at all. */
  | "advanced_unavailable"

export type Scene3DEngineChoice =
  | { ok: true; lane: "basic"; engine: undefined; fields: Scene3DEngineRequestFields }
  | { ok: true; lane: "advanced"; engine: Scene3DKnownEngine; fields: Scene3DEngineRequestFields }
  | { ok: false; code: Scene3DEngineChoiceRefusalCode; message: string }

function advancedFields(engine: Scene3DKnownEngine): Scene3DEngineRequestFields {
  return { engine, acceptedSceneSchemaVersions: [...SCENE3D_SUPPORTED_SCHEMA_VERSIONS] }
}

/** `undefined` (unknown) is permissive; a known list is authoritative. */
function serves(available: readonly string[] | undefined, engine: string): boolean {
  return available === undefined || available.includes(engine)
}

/** The engine recorded on a v2 plan's provenance, when it is one we know. */
function planAuthoringEngine(plan: unknown): Scene3DKnownEngine | undefined {
  const provenance = (plan as { provenance?: { engine?: unknown } } | null | undefined)?.provenance
  const engine = provenance?.engine
  return typeof engine === "string" && isKnownScene3DEngine(engine) ? engine : undefined
}

/**
 * Resolve the lane, or refuse with a sentence the user can act on.
 *
 * Pure and synchronous: every caller already holds the three inputs, and the
 * answer must be identical on the canvas and in the orchestrator.
 */
export function resolveScene3DAuthoringEngine(input: Scene3DEngineChoiceInput): Scene3DEngineChoice {
  const requested = typeof input.requested === "string" && input.requested.trim() !== ""
    ? input.requested.trim()
    : undefined
  if (requested !== undefined && !isScene3DAuthoringEngine(requested)) {
    return {
      ok: false,
      code: "unknown_engine",
      message: `"${requested}" is not a 3D authoring engine — choose Basic, or an advanced engine this install offers.`,
    }
  }

  // `plan` absent = generate. `null` version = not a Scene3D plan at all, which
  // is the caller's own error to report (they need the plan for other reasons
  // too); this resolver only speaks to versions it can read.
  const version = input.plan === undefined ? undefined : scene3DPlanSchemaVersion(input.plan)
  if (version !== undefined && version !== null && !(SCENE3D_SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(version)) {
    return {
      ok: false,
      code: "unsupported_schema_version",
      message: `This scene uses schema version ${version}, which this version of Nodaro cannot edit.`,
    }
  }
  const isV2 = version === SCENE3D_SCHEMA_VERSION_V2

  if (isV2) {
    if (requested === SCENE3D_BASIC_ENGINE) {
      return {
        ok: false,
        code: "schema_requires_advanced",
        message:
          "This scene was authored by an advanced engine (schema v2) and cannot be edited on the Basic engine — switch this node's engine to the advanced one.",
      }
    }
    // An EXPLICIT choice is never silently swapped for another engine — it is
    // refused, exactly like an explicit unavailable engine on a v1 scene.
    if (requested !== undefined) {
      return serves(input.availableEngines, requested)
        ? { ok: true, lane: "advanced", engine: requested, fields: advancedFields(requested) }
        : unavailable(requested)
    }
    // Nothing was picked. Preference order: the engine that AUTHORED the scene
    // (an edit stays on its own engine unless told otherwise), then the hosted
    // default.
    const preferred: Scene3DKnownEngine[] = []
    const authored = planAuthoringEngine(input.plan)
    if (authored) preferred.push(authored)
    if (!preferred.includes(SCENE3D_DEFAULT_ADVANCED_ENGINE)) preferred.push(SCENE3D_DEFAULT_ADVANCED_ENGINE)
    const engine = preferred.find((candidate) => serves(input.availableEngines, candidate))
    if (!engine) {
      return {
        ok: false,
        code: "advanced_unavailable",
        message:
          "This scene needs an advanced 3D engine to edit, and this install does not have one available.",
      }
    }
    return { ok: true, lane: "advanced", engine, fields: advancedFields(engine) }
  }

  // v1, or a generate with no plan at all.
  if (requested === undefined || requested === SCENE3D_BASIC_ENGINE) {
    return { ok: true, lane: "basic", engine: undefined, fields: {} }
  }
  const engine = requested as Scene3DKnownEngine
  if (!serves(input.availableEngines, engine)) return unavailable(engine)
  return { ok: true, lane: "advanced", engine, fields: advancedFields(engine) }
}

function unavailable(engine: string): Scene3DEngineChoice {
  return {
    ok: false,
    code: "engine_unavailable",
    message: `The "${engine}" 3D authoring engine is not available on this install.`,
  }
}

/** v1's version constant, re-exported for callers narrowing a plan by hand. */
export const SCENE3D_BASIC_SCHEMA_VERSION = SCENE3D_SCHEMA_VERSION
