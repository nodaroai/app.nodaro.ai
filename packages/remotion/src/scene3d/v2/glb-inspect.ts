/**
 * Bounded GLB pre-inspection — runs BEFORE `GLTFLoader.parse` ever sees the
 * bytes.
 *
 * The point is allocation order. `GLTFLoader` will happily allocate whatever a
 * file's accessors describe, so "check the decoded triangle count" after
 * parsing is checking after the damage. Everything here walks the container and
 * the JSON chunk only — no typed arrays are built from the BIN chunk — and it
 * refuses the file if the numbers it DECLARES would exceed a v2 ceiling.
 *
 * It is also where the file's capability surface is pinned:
 *  - no external or `data:` URIs (a GLB URI must never make the render worker
 *    read a filesystem path or fetch an arbitrary host);
 *  - no images (clay is the only advertised v2 mode, and this removes the
 *    image-decoder surface entirely);
 *  - no cameras (the sidecar is the single camera owner);
 *  - no skins/morph targets (capability-gated, not granted);
 *  - no Draco/Meshopt (we never download decoder JS);
 *  - unique node names, because `GLTFLoader` binds animation tracks by NAME —
 *    four nodes called `Wheel` would silently all drive the first one.
 *
 * ## Semantic ownership
 *
 * A real Blender export tags the semantic ROOT *and every mesh it owns* with
 * the same `extras.nodaroEntityId` — that repetition is what hit-testing needs,
 * and the glTF exporter's own `.001` regrouping nodes carry it too. So the id
 * is NOT a unique key; the ROOT is identified by node name (`visual.rootNodeId`)
 * and the extras id CONFIRMS ownership.
 *
 * A node whose NEAREST tagged ancestor carries a DIFFERENT id is a nested
 * entity root, not a smuggled one: the exporter parents a child entity's root
 * to its parent entity's root, and that containment IS the child's transform
 * frame — the parent's baked, possibly animated, transform is inherited through
 * it. Such a node is a root of its own, `parentEntityId` records what contains
 * it, and its subtree stops belonging to the enclosing entity, so neither the
 * geometry nor the materials of a child leak into its parent's authorized set.
 * The loader then requires the PLAN to declare the same parent, which is what
 * keeps "nested" from meaning "anything may sit anywhere".
 *
 * The trust boundary that remains: two DISJOINT regions carrying the same id
 * would let unowned geometry and materials into an entity. That is rejected.
 */
import * as THREE from "three"
import { check, fail } from "./errors"
import { SCENE3D_GLB_EXTRAS_ENTITY_ID } from "@nodaro/shared"
import {
  SCENE3D_RENDERER_GLB_LIMITS,
  SCENE3D_V2_ALLOWED_GLTF_EXTENSIONS,
  SCENE3D_V2_LIMITS,
} from "./limits"

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType?: number
  count?: number
  type?: string
}
interface GltfBufferView {
  buffer?: number
  byteOffset?: number
  byteLength?: number
  byteStride?: number
}
interface GltfPrimitive {
  attributes?: Record<string, number>
  indices?: number
  material?: number
  mode?: number
  targets?: unknown[]
}
interface GltfMesh {
  name?: string
  primitives?: GltfPrimitive[]
}
interface GltfNode {
  name?: string
  mesh?: number
  camera?: number
  skin?: number
  children?: number[]
  extras?: Record<string, unknown>
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}
interface GltfAnimationChannelTarget {
  node?: number
  path?: string
}
interface GltfAnimation {
  name?: string
  channels?: Array<{ target?: GltfAnimationChannelTarget; sampler?: number }>
}
interface GltfJson {
  asset?: { version?: string }
  scene?: number
  scenes?: Array<{ nodes?: number[] }>
  nodes?: GltfNode[]
  meshes?: GltfMesh[]
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
  buffers?: Array<{ byteLength?: number; uri?: string }>
  materials?: Array<{ name?: string }>
  images?: unknown[]
  cameras?: unknown[]
  skins?: unknown[]
  animations?: GltfAnimation[]
  extensionsRequired?: string[]
  extensionsUsed?: string[]
}

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
}
const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

/** One entity root found in the file, with the subtree it owns. */
export interface GlbEntityRoot {
  /** `node.extras.nodaroEntityId` — the ownership marker, not a unique key. */
  readonly entityId: string
  readonly nodeIndex: number
  /** Raw glTF node name. This is what `visual.rootNodeId` addresses. */
  readonly nodeName: string
  /** `nodeIndex` plus every descendant. */
  readonly subtreeNodeIndices: readonly number[]
  /** Names of every node in the subtree (unique within the file). */
  readonly subtreeNodeNames: readonly string[]
  /** Material names reachable from the subtree — the color-binding surface. */
  readonly materialNames: readonly string[]
  readonly meshNodeCount: number
  readonly triangleCount: number
  /** Does the entity root carry a non-identity static local transform? */
  readonly hasStaticLocalTransform: boolean
  /**
   * The entity whose root CONTAINS this one, or `null` for a scene-level root.
   * The plan must declare exactly this parent — see `bindEntitiesToAssets`.
   */
  readonly parentEntityId: string | null
}

export interface GlbInspection {
  readonly byteLength: number
  readonly nodeCount: number
  readonly meshNodeCount: number
  readonly triangleCount: number
  readonly maxDepth: number
  readonly animationNames: readonly string[]
  readonly animationChannelCount: number
  /**
   * Keyed by RAW node name, because that is what `visual.rootNodeId` names.
   * Keying by entity id would be wrong: a root and the meshes it owns all
   * carry the same id.
   */
  readonly entityRootsByNodeName: ReadonlyMap<string, GlbEntityRoot>
  /** Node names in the file, unique by construction (validated). */
  readonly nodeNames: readonly string[]
  /** Raw names of every node an animation channel targets. */
  readonly animatedNodeNames: ReadonlySet<string>
}

function readContainer(bytes: ArrayBuffer, subject: string): { json: string } {
  check(
    bytes.byteLength >= 20,
    "SCENE_ASSET_INVALID",
    `file is ${bytes.byteLength} bytes — too small to be a GLB`,
    subject,
  )
  check(
    bytes.byteLength <= SCENE3D_RENDERER_GLB_LIMITS.maxGlbBytes,
    "SCENE_RESOURCE_LIMIT",
    `GLB is ${bytes.byteLength} bytes, over the ${SCENE3D_RENDERER_GLB_LIMITS.maxGlbBytes} limit`,
    subject,
  )
  const view = new DataView(bytes)
  check(
    view.getUint32(0, true) === GLB_MAGIC,
    "SCENE_ASSET_INVALID",
    "not a GLB (magic bytes are not `glTF`)",
    subject,
  )
  const version = view.getUint32(4, true)
  check(version === 2, "SCENE_ASSET_INVALID", `GLB container version ${version} is not 2`, subject)
  const declaredLength = view.getUint32(8, true)
  check(
    declaredLength === bytes.byteLength,
    "SCENE_ASSET_INVALID",
    `GLB header declares ${declaredLength} bytes but the file is ${bytes.byteLength}`,
    subject,
  )

  let offset = 12
  let jsonText: string | null = null
  let sawBin = false
  while (offset + 8 <= bytes.byteLength) {
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const dataStart = offset + 8
    check(
      chunkLength >= 0 && dataStart + chunkLength <= bytes.byteLength,
      "SCENE_ASSET_INVALID",
      `chunk at ${offset} declares ${chunkLength} bytes and runs past the end of the file`,
      subject,
    )
    if (chunkType === CHUNK_JSON) {
      check(jsonText === null, "SCENE_ASSET_INVALID", "more than one JSON chunk", subject)
      check(
        chunkLength <= SCENE3D_RENDERER_GLB_LIMITS.maxJsonChunkBytes,
        "SCENE_RESOURCE_LIMIT",
        `JSON chunk is ${chunkLength} bytes, over the ${SCENE3D_RENDERER_GLB_LIMITS.maxJsonChunkBytes} limit`,
        subject,
      )
      try {
        jsonText = new TextDecoder("utf-8", { fatal: true }).decode(
          new Uint8Array(bytes, dataStart, chunkLength),
        )
      } catch {
        fail("SCENE_ASSET_INVALID", "GLB JSON chunk is not valid UTF-8", subject)
      }
    } else if (chunkType === CHUNK_BIN) {
      check(!sawBin, "SCENE_ASSET_INVALID", "more than one BIN chunk", subject)
      sawBin = true
    }
    // Unknown chunk types are skipped per the glTF spec.
    offset = dataStart + chunkLength
    // Chunks are 4-byte aligned; a length that is not is a malformed file.
    check(
      chunkLength % 4 === 0,
      "SCENE_ASSET_INVALID",
      "GLB chunk length is not 4-byte aligned",
      subject,
    )
  }
  check(jsonText !== null, "SCENE_ASSET_INVALID", "GLB has no JSON chunk", subject)
  return { json: jsonText as string }
}

function trianglesOfPrimitive(
  primitive: GltfPrimitive,
  accessors: GltfAccessor[],
  subject: string,
): number {
  const mode = primitive.mode ?? 4
  // 0 POINTS, 1..3 LINES — no triangles, but still legal geometry.
  if (mode < 4) return 0
  const countOf = (index: number | undefined): number => {
    if (index === undefined) return 0
    const accessor = accessors[index]
    check(!!accessor, "SCENE_ASSET_INVALID", `primitive references accessor ${index}`, subject)
    const count = accessor.count
    check(
      typeof count === "number" && Number.isInteger(count) && count >= 0,
      "SCENE_ASSET_INVALID",
      `accessor ${index} has an invalid count`,
      subject,
    )
    return count
  }
  const vertices = primitive.indices !== undefined
    ? countOf(primitive.indices)
    : countOf(primitive.attributes?.POSITION)
  if (mode === 4) return Math.floor(vertices / 3) // TRIANGLES
  return Math.max(0, vertices - 2) // TRIANGLE_STRIP / TRIANGLE_FAN
}

function assertAccessorsInBounds(json: GltfJson, subject: string): void {
  const accessors = json.accessors ?? []
  const bufferViews = json.bufferViews ?? []
  const buffers = json.buffers ?? []
  check(
    accessors.length <= SCENE3D_RENDERER_GLB_LIMITS.maxAccessors,
    "SCENE_RESOURCE_LIMIT",
    `${accessors.length} accessors exceeds the limit of ${SCENE3D_RENDERER_GLB_LIMITS.maxAccessors}`,
    subject,
  )
  check(
    bufferViews.length <= SCENE3D_RENDERER_GLB_LIMITS.maxAccessors,
    "SCENE_RESOURCE_LIMIT",
    `${bufferViews.length} bufferViews exceeds the limit of ${SCENE3D_RENDERER_GLB_LIMITS.maxAccessors}`,
    subject,
  )

  for (let i = 0; i < bufferViews.length; i++) {
    const bv = bufferViews[i]
    const bufferIndex = bv.buffer ?? 0
    const buffer = buffers[bufferIndex]
    check(!!buffer, "SCENE_ASSET_INVALID", `bufferView ${i} references buffer ${bufferIndex}`, subject)
    const byteLength = bv.byteLength ?? 0
    const byteOffset = bv.byteOffset ?? 0
    check(
      byteLength >= 0 && byteOffset >= 0 && byteOffset + byteLength <= (buffer.byteLength ?? 0),
      "SCENE_ASSET_INVALID",
      `bufferView ${i} runs past the end of its buffer`,
      subject,
    )
  }

  for (let i = 0; i < accessors.length; i++) {
    const a = accessors[i]
    if (a.bufferView === undefined) continue // sparse/zero-filled accessor
    const bv = bufferViews[a.bufferView]
    check(!!bv, "SCENE_ASSET_INVALID", `accessor ${i} references bufferView ${a.bufferView}`, subject)
    const componentBytes = COMPONENT_BYTES[a.componentType ?? 0]
    const components = TYPE_COMPONENTS[a.type ?? ""]
    check(
      !!componentBytes && !!components,
      "SCENE_ASSET_INVALID",
      `accessor ${i} has an unknown componentType/type`,
      subject,
    )
    const elementBytes = componentBytes * components
    const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elementBytes
    const count = a.count ?? 0
    const extent = count === 0 ? 0 : (count - 1) * stride + elementBytes
    check(
      (a.byteOffset ?? 0) + extent <= (bv.byteLength ?? 0),
      "SCENE_ASSET_INVALID",
      `accessor ${i} reads ${extent} bytes past the end of bufferView ${a.bufferView}`,
      subject,
    )
  }
}

function assertNoForbiddenFeatures(json: GltfJson, subject: string): void {
  for (const buffer of json.buffers ?? []) {
    check(
      buffer.uri === undefined,
      "SCENE_ASSET_INVALID",
      "GLB buffers must be embedded in the BIN chunk; external and data: URIs are not allowed",
      subject,
    )
  }
  check(
    (json.images?.length ?? 0) === 0,
    "SCENE_EXPORT_UNSUPPORTED",
    "textured assets are not supported in this v2 mode (clay only); the asset declares images",
    subject,
  )
  check(
    (json.cameras?.length ?? 0) === 0,
    "SCENE_ASSET_INVALID",
    "the camera sidecar is the only camera owner; this GLB declares cameras",
    subject,
  )
  check(
    (json.skins?.length ?? 0) === 0,
    "SCENE_EXPORT_UNSUPPORTED",
    "skinned meshes are capability-gated and not enabled in this build",
    subject,
  )
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      check(
        (primitive.targets?.length ?? 0) === 0,
        "SCENE_EXPORT_UNSUPPORTED",
        "morph targets are capability-gated and not enabled in this build",
        subject,
      )
    }
  }
  for (const required of json.extensionsRequired ?? []) {
    check(
      SCENE3D_V2_ALLOWED_GLTF_EXTENSIONS.includes(required),
      "SCENE_EXPORT_UNSUPPORTED",
      `required glTF extension "${required}" is not supported (no external decoder code is ever downloaded)`,
      subject,
    )
  }
}

const IDENTITY_EPS = 1e-6

function hasStaticTransform(node: GltfNode): boolean {
  if (node.matrix) {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    return node.matrix.some((v, i) => Math.abs(v - identity[i]) > IDENTITY_EPS)
  }
  if (node.translation?.some((v) => Math.abs(v) > IDENTITY_EPS)) return true
  if (node.rotation && (Math.abs(node.rotation[3] - 1) > IDENTITY_EPS ||
    node.rotation.slice(0, 3).some((v) => Math.abs(v) > IDENTITY_EPS))) return true
  if (node.scale?.some((v) => Math.abs(v - 1) > IDENTITY_EPS)) return true
  return false
}

/**
 * Walk the container and JSON chunk of a GLB and return everything the scene
 * builder needs, having proven the file is inside every v2 ceiling.
 *
 * `budget` carries the running AGGREGATE counts, because the limits are
 * "across resolved assets" — three files of 900 mesh nodes each must fail even
 * though none of them individually does.
 */
export function inspectGlb(
  bytes: ArrayBuffer,
  subject: string,
  budget: { meshNodes: number; triangles: number } = { meshNodes: 0, triangles: 0 },
): GlbInspection {
  const { json: jsonText } = readContainer(bytes, subject)

  let json: GltfJson
  try {
    json = JSON.parse(jsonText) as GltfJson
  } catch (error) {
    return fail(
      "SCENE_ASSET_INVALID",
      `GLB JSON chunk is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      subject,
    )
  }
  check(
    json.asset?.version === "2.0",
    "SCENE_ASSET_INVALID",
    `glTF asset version "${String(json.asset?.version)}" is not 2.0`,
    subject,
  )

  assertNoForbiddenFeatures(json, subject)
  assertAccessorsInBounds(json, subject)

  const nodes = json.nodes ?? []
  check(
    nodes.length <= SCENE3D_RENDERER_GLB_LIMITS.maxNodes,
    "SCENE_RESOURCE_LIMIT",
    `${nodes.length} nodes exceeds the per-asset limit of ${SCENE3D_RENDERER_GLB_LIMITS.maxNodes}`,
    subject,
  )

  // Unique, non-empty names. GLTFLoader resolves an animation track's target by
  // NAME, so a duplicate makes the binding ambiguous and silently wrong.
  const nodeNames: string[] = []
  const seenNames = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    const name = nodes[i].name
    check(
      typeof name === "string" && name.length > 0,
      "SCENE_ASSET_INVALID",
      `node ${i} has no name; animation binding resolves nodes by name`,
      subject,
    )
    check(
      !seenNames.has(name),
      "SCENE_ASSET_INVALID",
      `duplicate node name "${name}" — animation tracks would bind ambiguously`,
      subject,
    )
    // A track path is `<sanitized name>.<property>`. Three strips `. : / [ ]`,
    // so a name made only of those sanitizes to "" and its track would parse
    // with no node name at all — which binds to whatever the binding root is.
    check(
      THREE.PropertyBinding.sanitizeNodeName(name) !== "",
      "SCENE_ASSET_INVALID",
      `node name "${name}" is empty once sanitized; its animation track could not address it`,
      subject,
    )
    seenNames.add(name)
    nodeNames.push(name)
  }

  // Triangle/mesh-node counts and depth in ONE traversal from the scene roots,
  // which is also the cycle check: a node reached twice is a malformed graph.
  const meshTriangles = new Map<number, number>()
  const meshes = json.meshes ?? []
  for (let i = 0; i < meshes.length; i++) {
    let total = 0
    for (const primitive of meshes[i].primitives ?? []) {
      total += trianglesOfPrimitive(primitive, json.accessors ?? [], subject)
    }
    meshTriangles.set(i, total)
  }

  const parentOf = new Int32Array(nodes.length).fill(-1)
  for (let i = 0; i < nodes.length; i++) {
    for (const child of nodes[i].children ?? []) {
      check(
        child >= 0 && child < nodes.length,
        "SCENE_ASSET_INVALID",
        `node ${i} references child ${child}, which does not exist`,
        subject,
      )
      check(
        parentOf[child] === -1,
        "SCENE_ASSET_INVALID",
        `node ${child} has more than one parent`,
        subject,
      )
      parentOf[child] = i
    }
  }

  const sceneIndex = json.scene ?? 0
  const rootIndices = json.scenes?.[sceneIndex]?.nodes ?? nodes.map((_, i) => i).filter((i) => parentOf[i] === -1)

  let meshNodeCount = 0
  let triangleCount = 0
  let maxDepth = 0
  const visited = new Uint8Array(nodes.length)
  const depthOf = new Int32Array(nodes.length).fill(-1)

  const stack: Array<{ index: number; depth: number }> = rootIndices.map((index) => ({ index, depth: 1 }))
  while (stack.length > 0) {
    const { index, depth } = stack.pop() as { index: number; depth: number }
    check(
      index >= 0 && index < nodes.length,
      "SCENE_ASSET_INVALID",
      `scene references node ${index}, which does not exist`,
      subject,
    )
    check(!visited[index], "SCENE_ASSET_INVALID", `node graph has a cycle at node ${index}`, subject)
    visited[index] = 1
    depthOf[index] = depth
    if (depth > maxDepth) maxDepth = depth
    check(
      depth <= SCENE3D_V2_LIMITS.maxHierarchyDepth,
      "SCENE_RESOURCE_LIMIT",
      `node hierarchy is deeper than ${SCENE3D_V2_LIMITS.maxHierarchyDepth}`,
      subject,
    )
    const node = nodes[index]
    if (node.mesh !== undefined) {
      meshNodeCount++
      triangleCount += meshTriangles.get(node.mesh) ?? 0
    }
    for (const child of node.children ?? []) stack.push({ index: child, depth: depth + 1 })
  }

  check(
    budget.meshNodes + meshNodeCount <= SCENE3D_V2_LIMITS.maxMeshNodes,
    "SCENE_RESOURCE_LIMIT",
    `mesh nodes across resolved assets would reach ${budget.meshNodes + meshNodeCount}, over the limit of ${SCENE3D_V2_LIMITS.maxMeshNodes}`,
    subject,
  )
  check(
    budget.triangles + triangleCount <= SCENE3D_V2_LIMITS.maxTriangles,
    "SCENE_RESOURCE_LIMIT",
    `triangles across resolved assets would reach ${budget.triangles + triangleCount}, over the limit of ${SCENE3D_V2_LIMITS.maxTriangles}`,
    subject,
  )

  // Which nodes an animation channel targets. An entity whose subtree is
  // animated but which declares no `animation` binding would sit frozen while
  // its siblings move, so the loader warns — see `SCENE_ANIMATION_UNBOUND`.
  const animationNames: string[] = []
  const animatedPathsByNode = new Map<number, string[]>()
  let animationChannelCount = 0
  for (let i = 0; i < (json.animations ?? []).length; i++) {
    const animation = (json.animations as GltfAnimation[])[i]
    animationNames.push(animation.name ?? `clip_${i}`)
    for (const channel of animation.channels ?? []) {
      animationChannelCount++
      const nodeIndex = channel.target?.node
      const path = channel.target?.path
      if (nodeIndex === undefined || path === undefined) continue
      check(
        nodeIndex >= 0 && nodeIndex < nodes.length,
        "SCENE_ASSET_INVALID",
        `animation channel targets node ${nodeIndex}, which does not exist`,
        subject,
      )
      const list = animatedPathsByNode.get(nodeIndex) ?? []
      list.push(path)
      animatedPathsByNode.set(nodeIndex, list)
    }
  }
  check(
    animationChannelCount <= SCENE3D_RENDERER_GLB_LIMITS.maxAnimationTracks,
    "SCENE_RESOURCE_LIMIT",
    `${animationChannelCount} animation channels exceeds the limit of ${SCENE3D_RENDERER_GLB_LIMITS.maxAnimationTracks}`,
    subject,
  )

  // Semantic roots.
  //
  // The id is an OWNERSHIP marker, not a unique key: a real export tags the
  // root and every mesh it owns with the same id, and the glTF exporter's own
  // `.001` regrouping nodes inherit it. A node is therefore a ROOT iff its
  // NEAREST TAGGED ancestor carries a different id (a nested root) or there is
  // none (a scene-level root). Reading the nearest TAGGED ancestor rather than
  // the immediate parent is what keeps `box → hinge(untagged) → door(box)` one
  // entity; reading it rather than "any ancestor with this id" is what makes a
  // child entity parented into `box` its own root instead of box's geometry.
  const entityIdOf = (index: number): string | undefined => {
    const raw = nodes[index].extras?.[SCENE3D_GLB_EXTRAS_ENTITY_ID]
    if (raw === undefined) return undefined
    check(
      typeof raw === "string" && raw.length > 0,
      "SCENE_ASSET_BINDING",
      `node "${nodeNames[index]}" has a non-string extras.${SCENE3D_GLB_EXTRAS_ENTITY_ID}`,
      subject,
    )
    return raw as string
  }

  const entityRootsByNodeName = new Map<string, GlbEntityRoot>()
  const rootNameByEntityId = new Map<string, string>()
  const materials = json.materials ?? []

  /** The id of the nearest TAGGED ancestor, or undefined at the top. */
  const enclosingEntityOf = (index: number): string | undefined => {
    for (let cursor = parentOf[index]; cursor !== -1; cursor = parentOf[cursor]) {
      const id = entityIdOf(cursor)
      if (id !== undefined) return id
    }
    return undefined
  }

  for (let i = 0; i < nodes.length; i++) {
    const entityId = entityIdOf(i)
    if (entityId === undefined) continue

    const enclosing = enclosingEntityOf(i)
    if (enclosing === entityId) continue // an owned mesh / regrouping node, not a root

    check(
      visited[i] === 1,
      "SCENE_ASSET_BINDING",
      `entity root "${entityId}" is not reachable from the exported scene`,
      subject,
    )
    // Two DISJOINT regions with the same id would let a second, unowned
    // subtree contribute geometry and materials to one entity.
    const claimed = rootNameByEntityId.get(entityId)
    check(
      claimed === undefined,
      "SCENE_ASSET_BINDING",
      `extras.${SCENE3D_GLB_EXTRAS_ENTITY_ID} "${entityId}" is used by two disjoint roots ("${String(claimed)}" and "${nodeNames[i]}")`,
      subject,
    )
    rootNameByEntityId.set(entityId, nodeNames[i])

    const subtree: number[] = []
    const subtreeNames: string[] = []
    const materialNames = new Set<string>()
    let subMeshNodes = 0
    let subTriangles = 0
    const walk: number[] = [i]
    while (walk.length > 0) {
      const index = walk.pop() as number
      subtree.push(index)
      subtreeNames.push(nodeNames[index])
      const node = nodes[index]
      if (node.mesh !== undefined) {
        subMeshNodes++
        subTriangles += meshTriangles.get(node.mesh) ?? 0
        for (const primitive of meshes[node.mesh]?.primitives ?? []) {
          const name = primitive.material !== undefined ? materials[primitive.material]?.name : undefined
          if (name) materialNames.add(name)
        }
      }
      // A child tagged with a DIFFERENT id is a nested entity root: it owns
      // itself, so this entity's geometry, materials and node names stop here.
      for (const child of node.children ?? []) {
        const childId = entityIdOf(child)
        if (childId !== undefined && childId !== entityId) continue
        walk.push(child)
      }
    }

    entityRootsByNodeName.set(nodeNames[i], {
      entityId,
      nodeIndex: i,
      nodeName: nodeNames[i],
      subtreeNodeIndices: subtree,
      subtreeNodeNames: subtreeNames,
      materialNames: [...materialNames],
      meshNodeCount: subMeshNodes,
      triangleCount: subTriangles,
      hasStaticLocalTransform: hasStaticTransform(nodes[i]),
      parentEntityId: enclosing ?? null,
    })
  }

  budget.meshNodes += meshNodeCount
  budget.triangles += triangleCount

  return {
    byteLength: bytes.byteLength,
    nodeCount: nodes.length,
    meshNodeCount,
    triangleCount,
    maxDepth,
    animationNames,
    animationChannelCount,
    entityRootsByNodeName,
    nodeNames,
    animatedNodeNames: new Set(
      [...animatedPathsByNode.keys()].map((index) => nodeNames[index]),
    ),
  }
}
