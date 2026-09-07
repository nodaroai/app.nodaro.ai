/**
 * Real GLB bytes, assembled here.
 *
 * The alternative — checking in a binary fixture — would test whatever Blender
 * emitted on one machine one day. Building the container in the test means the
 * hostile cases (a lying header length, a duplicate node name, an accessor that
 * reads past its bufferView) are expressible as ONE changed field, and the
 * happy path is parsed by the same `GLTFLoader` the renderer uses in
 * production.
 */
import { sha256HexSync } from "../sha256"
import type { Scene3DAssetRef } from "../plan-shape"

export interface GlbNodeSpec {
  name: string
  entityRootId?: string
  mesh?: boolean
  children?: GlbNodeSpec[]
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  materialName?: string
  /** Bake a translation track for this node into the named clip. */
  animateTranslation?: { clip: string; times: number[]; values: Array<[number, number, number]> }
}

export interface MakeGlbOptions {
  nodes: GlbNodeSpec[]
  /** Escape hatch for hostile fixtures: mutate the glTF JSON before packing. */
  mutate?: (json: Record<string, unknown>) => void
  /** Escape hatch: rewrite the packed bytes (e.g. corrupt the header). */
  mutateBytes?: (bytes: Uint8Array) => void
}

interface FlatNode {
  spec: GlbNodeSpec
  index: number
  childIndices: number[]
}

const TRIANGLE = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])

function pad4(length: number): number {
  return (length + 3) & ~3
}

export function makeGlb(options: MakeGlbOptions): ArrayBuffer {
  const flat: FlatNode[] = []
  const rootIndices: number[] = []

  const visit = (spec: GlbNodeSpec, parent: FlatNode | null): number => {
    const index = flat.length
    const entry: FlatNode = { spec, index, childIndices: [] }
    flat.push(entry)
    if (parent) parent.childIndices.push(index)
    else rootIndices.push(index)
    for (const child of spec.children ?? []) visit(child, entry)
    return index
  }
  for (const spec of options.nodes) visit(spec, null)

  // ── binary chunk ────────────────────────────────────────────────────────
  const chunks: Array<{ data: ArrayBufferView; offset: number }> = []
  let binLength = 0
  const push = (data: ArrayBufferView): number => {
    const offset = binLength
    chunks.push({ data, offset })
    binLength = pad4(offset + data.byteLength)
    return offset
  }

  const positionOffset = push(TRIANGLE)
  const bufferViews: Array<Record<string, number>> = [
    { buffer: 0, byteOffset: positionOffset, byteLength: TRIANGLE.byteLength },
  ]
  const accessors: Array<Record<string, unknown>> = [
    { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
  ]

  // ── meshes / materials ──────────────────────────────────────────────────
  const materials: Array<Record<string, unknown>> = []
  const materialIndexByName = new Map<string, number>()
  const meshes: Array<Record<string, unknown>> = []
  const meshIndexByNode = new Map<number, number>()

  for (const entry of flat) {
    if (!entry.spec.mesh) continue
    let materialIndex: number | undefined
    const materialName = entry.spec.materialName
    if (materialName) {
      const existing = materialIndexByName.get(materialName)
      if (existing !== undefined) materialIndex = existing
      else {
        materialIndex = materials.length
        materials.push({
          name: materialName,
          pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] },
        })
        materialIndexByName.set(materialName, materialIndex)
      }
    }
    meshIndexByNode.set(entry.index, meshes.length)
    meshes.push({
      name: `${entry.spec.name}_mesh`,
      primitives: [
        {
          attributes: { POSITION: 0 },
          mode: 4,
          ...(materialIndex !== undefined ? { material: materialIndex } : {}),
        },
      ],
    })
  }

  // ── animations ──────────────────────────────────────────────────────────
  const animationsByClip = new Map<
    string,
    { channels: Array<Record<string, unknown>>; samplers: Array<Record<string, unknown>> }
  >()
  for (const entry of flat) {
    const track = entry.spec.animateTranslation
    if (!track) continue
    const clip = animationsByClip.get(track.clip) ?? { channels: [], samplers: [] }
    animationsByClip.set(track.clip, clip)

    const times = new Float32Array(track.times)
    const values = new Float32Array(track.values.flat())
    const timesOffset = push(times)
    const valuesOffset = push(values)

    const timesView = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset: timesOffset, byteLength: times.byteLength })
    const valuesView = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset: valuesOffset, byteLength: values.byteLength })

    const inputAccessor = accessors.length
    accessors.push({
      bufferView: timesView,
      byteOffset: 0,
      componentType: 5126,
      count: track.times.length,
      type: "SCALAR",
      min: [Math.min(...track.times)],
      max: [Math.max(...track.times)],
    })
    const outputAccessor = accessors.length
    accessors.push({
      bufferView: valuesView,
      byteOffset: 0,
      componentType: 5126,
      count: track.values.length,
      type: "VEC3",
    })

    const samplerIndex = clip.samplers.length
    clip.samplers.push({ input: inputAccessor, output: outputAccessor, interpolation: "LINEAR" })
    clip.channels.push({ sampler: samplerIndex, target: { node: entry.index, path: "translation" } })
  }

  // ── json chunk ──────────────────────────────────────────────────────────
  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "nodaro-test-fixture" },
    scene: 0,
    scenes: [{ nodes: rootIndices }],
    nodes: flat.map((entry) => {
      const node: Record<string, unknown> = { name: entry.spec.name }
      if (entry.childIndices.length > 0) node.children = entry.childIndices
      const meshIndex = meshIndexByNode.get(entry.index)
      if (meshIndex !== undefined) node.mesh = meshIndex
      if (entry.spec.translation) node.translation = entry.spec.translation
      if (entry.spec.rotation) node.rotation = entry.spec.rotation
      if (entry.spec.scale) node.scale = entry.spec.scale
      if (entry.spec.entityRootId) node.extras = { nodaroEntityId: entry.spec.entityRootId }
      return node
    }),
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: Math.max(binLength, 4) }],
  }
  if (materials.length > 0) json.materials = materials
  if (animationsByClip.size > 0) {
    json.animations = [...animationsByClip.entries()].map(([name, clip]) => ({
      name,
      channels: clip.channels,
      samplers: clip.samplers,
    }))
  }
  options.mutate?.(json)

  return packGlb(json, chunks, Math.max(binLength, 4), options.mutateBytes)
}

function packGlb(
  json: unknown,
  chunks: Array<{ data: ArrayBufferView; offset: number }>,
  binLength: number,
  mutateBytes?: (bytes: Uint8Array) => void,
): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPadded = pad4(jsonBytes.length)
  const binPadded = pad4(binLength)

  const total = 12 + 8 + jsonPadded + 8 + binPadded
  const buffer = new ArrayBuffer(total)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  view.setUint32(0, 0x46546c67, true) // 'glTF'
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)

  view.setUint32(12, jsonPadded, true)
  view.setUint32(16, 0x4e4f534a, true) // 'JSON'
  bytes.set(jsonBytes, 20)
  // glTF requires trailing SPACE padding for the JSON chunk.
  for (let i = 20 + jsonBytes.length; i < 20 + jsonPadded; i++) bytes[i] = 0x20

  const binChunkStart = 20 + jsonPadded
  view.setUint32(binChunkStart, binPadded, true)
  view.setUint32(binChunkStart + 4, 0x004e4942, true) // 'BIN\0'
  for (const chunk of chunks) {
    bytes.set(
      new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength),
      binChunkStart + 8 + chunk.offset,
    )
  }

  mutateBytes?.(bytes)
  return buffer
}

/** Manifest asset ref for arbitrary bytes — real length, real digest. */
export function assetRefFor(
  assetId: string,
  kind: Scene3DAssetRef["kind"],
  role: Scene3DAssetRef["role"],
  bytes: ArrayBuffer,
): Scene3DAssetRef {
  return { assetId, kind, role, byteLength: bytes.byteLength, sha256: sha256HexSync(bytes) }
}

export function jsonAssetBytes(value: unknown): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  // A fresh, exactly-sized ArrayBuffer — a subarray view would make byteLength
  // checks pass against the wrong buffer.
  const out = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(out).set(encoded)
  return out
}
