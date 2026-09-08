import { describe, expect, it } from "vitest"
import { inspectGlb } from "../glb-inspect"
import { SCENE3D_V2_LIMITS } from "../limits"
import { makeGlb, type MakeGlbOptions } from "./glb-fixtures"

function inspect(options: MakeGlbOptions, budget?: { meshNodes: number; triangles: number }) {
  return inspectGlb(makeGlb(options), "asset-1", budget)
}

const SIMPLE: MakeGlbOptions = {
  nodes: [
    {
      name: "Car",
      entityRootId: "car",
      children: [
        { name: "Body", mesh: true, materialName: "bodyPaint" },
        { name: "WheelFL", mesh: true, materialName: "rubber" },
        { name: "WheelFR", mesh: true, materialName: "rubber" },
      ],
    },
  ],
}

describe("GLB pre-inspection: happy path", () => {
  it("counts mesh nodes, triangles and depth", () => {
    const result = inspect(SIMPLE)
    expect(result.meshNodeCount).toBe(3)
    expect(result.triangleCount).toBe(3) // one triangle per mesh
    expect(result.maxDepth).toBe(2)
    expect(result.nodeCount).toBe(4)
  })

  it("maps the ROOT NODE NAME to a subtree with its material names", () => {
    const root = inspect(SIMPLE).entityRootsByNodeName.get("Car")
    expect(root).toBeDefined()
    expect(root?.entityId).toBe("car")
    expect([...(root?.subtreeNodeNames ?? [])].sort()).toEqual(["Body", "Car", "WheelFL", "WheelFR"])
    expect([...(root?.materialNames ?? [])].sort()).toEqual(["bodyPaint", "rubber"])
    expect(root?.meshNodeCount).toBe(3)
  })

  it("reports whether the entity root carries a static local transform", () => {
    expect(inspect(SIMPLE).entityRootsByNodeName.get("Car")?.hasStaticLocalTransform).toBe(false)
    const moved = inspect({
      nodes: [{ ...SIMPLE.nodes[0], translation: [3, 0, 0] }],
    })
    expect(moved.entityRootsByNodeName.get("Car")?.hasStaticLocalTransform).toBe(true)
  })

  it("lists animation clips and the channels that target the entity root", () => {
    const result = inspect({
      nodes: [
        {
          name: "Car",
          entityRootId: "car",
          mesh: true,
          animateTranslation: { clip: "drive", times: [0, 1], values: [[0, 0, 0], [5, 0, 0]] },
        },
      ],
    })
    expect(result.animationNames).toEqual(["drive"])
    expect([...result.animatedNodeNames]).toEqual(["Car"])
  })
})

describe("GLB pre-inspection: container", () => {
  it("rejects a file whose magic bytes are not glTF", () => {
    const bytes = makeGlb(SIMPLE)
    new DataView(bytes).setUint32(0, 0x12345678, true)
    expect(() => inspectGlb(bytes, "asset-1")).toThrow(/magic bytes/)
  })

  it("rejects container version 1", () => {
    const bytes = makeGlb(SIMPLE)
    new DataView(bytes).setUint32(4, 1, true)
    expect(() => inspectGlb(bytes, "asset-1")).toThrow(/container version 1 is not 2/)
  })

  it("rejects a header that lies about the total length", () => {
    const bytes = makeGlb(SIMPLE)
    new DataView(bytes).setUint32(8, 999999, true)
    expect(() => inspectGlb(bytes, "asset-1")).toThrow(/header declares/)
  })

  it("rejects a chunk that claims to run past the end of the file", () => {
    const bytes = makeGlb(SIMPLE)
    // Chunk length is at offset 12; the header total stays honest so the
    // per-chunk bound is what has to catch this.
    new DataView(bytes).setUint32(12, bytes.byteLength, true)
    expect(() => inspectGlb(bytes, "asset-1")).toThrow(/runs past the end of the file/)
  })

  it("rejects a truncated file", () => {
    const full = makeGlb(SIMPLE)
    expect(() => inspectGlb(full.slice(0, 16), "asset-1")).toThrow(/too small|header declares/)
  })
})

describe("GLB pre-inspection: forbidden capabilities", () => {
  it("rejects an external buffer URI", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          ;(json.buffers as Array<Record<string, unknown>>)[0].uri = "https://evil.example/data.bin"
        },
      }),
    ).toThrow(/external and data: URIs are not allowed/)
  })

  it("rejects a data: buffer URI too", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          ;(json.buffers as Array<Record<string, unknown>>)[0].uri = "data:application/octet-stream;base64,AAAA"
        },
      }),
    ).toThrow(/external and data: URIs are not allowed/)
  })

  it("rejects images (clay-only mode has no image decoder surface)", () => {
    expect(() =>
      inspect({ ...SIMPLE, mutate: (json) => void (json.images = [{ bufferView: 0 }]) }),
    ).toThrow(/textured assets are not supported/)
  })

  it("rejects a GLB camera — the sidecar is the only camera owner", () => {
    expect(() =>
      inspect({ ...SIMPLE, mutate: (json) => void (json.cameras = [{ type: "perspective" }]) }),
    ).toThrow(/only camera owner/)
  })

  it("rejects skins and morph targets (capability-gated)", () => {
    expect(() =>
      inspect({ ...SIMPLE, mutate: (json) => void (json.skins = [{ joints: [0] }]) }),
    ).toThrow(/skinned meshes are capability-gated/)
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          const meshes = json.meshes as Array<{ primitives: Array<Record<string, unknown>> }>
          meshes[0].primitives[0].targets = [{ POSITION: 0 }]
        },
      }),
    ).toThrow(/morph targets are capability-gated/)
  })

  it("rejects Draco — no decoder JS is ever downloaded", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => void (json.extensionsRequired = ["KHR_draco_mesh_compression"]),
      }),
    ).toThrow(/KHR_draco_mesh_compression.*not supported/)
  })

  it("allows the explicitly allowlisted extensions", () => {
    expect(() =>
      inspect({ ...SIMPLE, mutate: (json) => void (json.extensionsRequired = ["KHR_materials_unlit"]) }),
    ).not.toThrow()
  })

  it("rejects a glTF version that is not 2.0", () => {
    expect(() =>
      inspect({ ...SIMPLE, mutate: (json) => void (json.asset = { version: "1.0" }) }),
    ).toThrow(/is not 2.0/)
  })
})

describe("GLB pre-inspection: binding integrity", () => {
  it("rejects duplicate node names — animation binding resolves by NAME", () => {
    // Four wheels called `Wheel` would all be driven by whichever the loader
    // finds first. This is the single most silent way for a rig to be wrong.
    expect(() =>
      inspect({
        nodes: [
          {
            name: "Car",
            entityRootId: "car",
            children: [
              { name: "Wheel", mesh: true },
              { name: "Wheel", mesh: true },
            ],
          },
        ],
      }),
    ).toThrow(/duplicate node name "Wheel"/)
  })

  it("rejects an unnamed node", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          delete (json.nodes as Array<Record<string, unknown>>)[1].name
        },
      }),
    ).toThrow(/has no name/)
  })

  it("rejects the SAME entity id on two disjoint roots", () => {
    // The trust boundary: a second, unowned subtree would otherwise contribute
    // geometry and materials to an entity that never claimed it.
    expect(() =>
      inspect({
        nodes: [
          { name: "A", entityRootId: "dup", mesh: true },
          { name: "B", entityRootId: "dup", mesh: true },
        ],
      }),
    ).toThrow(/used by two disjoint roots/)
  })

  it("rejects a DIFFERENT entity id nested inside a root", () => {
    expect(() =>
      inspect({
        nodes: [
          {
            name: "Car",
            entityRootId: "car",
            children: [{ name: "Wheel", entityRootId: "wheel", mesh: true }],
          },
        ],
      }),
    ).toThrow(/claims a different entity/)
  })

  it("ACCEPTS the same entity id on the meshes a root owns", () => {
    // This is what a real Blender export emits: the semantic root and every
    // mesh under it carry the id, because hit-testing needs it on the mesh.
    const result = inspect({
      nodes: [
        {
          name: "box",
          entityRootId: "box",
          children: [{ name: "box/body", entityRootId: "box", mesh: true }],
        },
      ],
    })
    expect([...result.entityRootsByNodeName.keys()]).toEqual(["box"])
    const root = result.entityRootsByNodeName.get("box")
    expect(root?.entityId).toBe("box")
    expect([...(root?.subtreeNodeNames ?? [])].sort()).toEqual(["box", "box/body"])
    expect(root?.meshNodeCount).toBe(1)
  })

  it("ACCEPTS the exporter's synthetic `.001` regrouping node with the same id", () => {
    // glTF export renames a colliding node to `floor.001` and keeps the tag.
    const result = inspect({
      nodes: [
        {
          name: "floor",
          entityRootId: "floor",
          children: [
            {
              name: "floor.001",
              entityRootId: "floor",
              children: [{ name: "floor/floor", entityRootId: "floor", mesh: true }],
            },
          ],
        },
      ],
    })
    expect([...result.entityRootsByNodeName.keys()]).toEqual(["floor"])
    expect(result.entityRootsByNodeName.get("floor")?.subtreeNodeNames).toHaveLength(3)
  })

  it("treats a re-tagged node under an UNTAGGED gap as the same root", () => {
    // Only the parent carrying the id is not enough: `box → hinge → door(box)`
    // must stay ONE root, or it reads as disjoint reuse and gets rejected.
    const result = inspect({
      nodes: [
        {
          name: "box",
          entityRootId: "box",
          children: [
            { name: "hinge", children: [{ name: "door", entityRootId: "box", mesh: true }] },
          ],
        },
      ],
    })
    expect([...result.entityRootsByNodeName.keys()]).toEqual(["box"])
  })

  it("rejects a node name that sanitizes to nothing", () => {
    // `. : / [ ]` are stripped from a track path, so such a name would leave
    // the track with no node at all — and bind to the entity wrapper.
    expect(() =>
      inspect({ nodes: [{ name: "Root", entityRootId: "r", children: [{ name: "///", mesh: true }] }] }),
    ).toThrow(/empty once sanitized/)
  })

  it("rejects a node with two parents", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          const nodes = json.nodes as Array<Record<string, unknown>>
          nodes[1].children = [2]
        },
      }),
    ).toThrow(/more than one parent/)
  })

  it("rejects a child index that does not exist", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          const nodes = json.nodes as Array<{ children?: number[] }>
          nodes[0].children = [99]
        },
      }),
    ).toThrow(/which does not exist/)
  })

  it("rejects an entity root that is unreachable from the scene", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          ;(json.scenes as Array<{ nodes: number[] }>)[0].nodes = []
        },
      }),
    ).toThrow(/not reachable from the exported scene/)
  })
})

describe("GLB pre-inspection: resource bounds", () => {
  it("rejects an accessor that reads past its bufferView", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          ;(json.accessors as Array<Record<string, unknown>>)[0].count = 100_000
        },
      }),
    ).toThrow(/past the end of bufferView/)
  })

  it("rejects a bufferView that runs past its buffer", () => {
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          ;(json.bufferViews as Array<Record<string, unknown>>)[0].byteLength = 10_000
        },
      }),
    ).toThrow(/past the end of its buffer/)
  })

  it("rejects a declared triangle count over the ceiling BEFORE parsing", () => {
    // The count comes from the accessor, so an over-budget file is refused
    // without a single typed array being built from the BIN chunk.
    expect(() =>
      inspect({
        ...SIMPLE,
        mutate: (json) => {
          const accessors = json.accessors as Array<Record<string, unknown>>
          accessors[0].count = 3 * (SCENE3D_V2_LIMITS.maxTriangles + 10)
          const bufferViews = json.bufferViews as Array<Record<string, number>>
          bufferViews[0].byteLength = 12 * 3 * (SCENE3D_V2_LIMITS.maxTriangles + 10)
          ;(json.buffers as Array<Record<string, number>>)[0].byteLength = 1e12
        },
      }),
    ).toThrow(/triangles across resolved assets/)
  })

  it("enforces the mesh-node budget ACROSS assets, not per file", () => {
    // Neither file is individually over budget; together they are.
    const budget = { meshNodes: SCENE3D_V2_LIMITS.maxMeshNodes - 2, triangles: 0 }
    expect(() => inspect(SIMPLE, budget)).toThrow(/mesh nodes across resolved assets/)
  })

  it("accumulates the budget across successive inspections", () => {
    const budget = { meshNodes: 0, triangles: 0 }
    inspect(SIMPLE, budget)
    inspect(SIMPLE, budget)
    expect(budget.meshNodes).toBe(6)
    expect(budget.triangles).toBe(6)
  })

  it("rejects a hierarchy deeper than the limit", () => {
    let deepest: MakeGlbOptions["nodes"][number] = { name: "leaf", mesh: true }
    for (let i = 0; i < SCENE3D_V2_LIMITS.maxHierarchyDepth + 2; i++) {
      deepest = { name: `n${i}`, children: [deepest] }
    }
    expect(() => inspect({ nodes: [deepest] })).toThrow(/deeper than 16/)
  })
})
