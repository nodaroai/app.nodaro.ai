// @test-watches frontend/public/face-mesh-art/**
/**
 * The face mesh illustrations of Admin → Nodaro Motion: every set of layers
 * that draws lines has its own picture (drawn by the platform's face mesh code,
 * backend/scripts/render-face-mesh-thumbnails.mts), every picture listed is
 * shipped, and each choice and switch shows its own — without changing any
 * option's or switch's name.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { VIDEO_FACE_MESH_LAYERS, videoFaceMeshLayersDrawLines, type VideoFaceMeshLayers } from "@nodaro/shared/media"

import type { AdminTrendFaceMasking } from "@/lib/api"
import { FACE_MESH_THUMBNAIL_FILES } from "../face-mesh-thumbnail-files"
import { faceMeshLayersThumbnail, faceMeshLayerSwitchThumbnail, faceMeshThumbnailKey } from "../face-mesh-thumbnails"
import { FaceMeshLayerSwitches } from "../components/FaceMeshLayerSwitches"
import { FaceMeshLinesChoice } from "../components/FaceMeshLinesChoice"

const PUBLIC = path.resolve(__dirname, "../../../../../../../public")
const DIR = path.join(PUBLIC, "face-mesh-art")

/** Every set of the six layers, as on/off. */
const ALL_SETS: VideoFaceMeshLayers[] = Array.from({ length: 1 << VIDEO_FACE_MESH_LAYERS.length }, (_, mask) =>
  Object.fromEntries(VIDEO_FACE_MESH_LAYERS.filter((_, i) => mask & (1 << i)).map((l) => [l, true])),
)

describe("the pictures", () => {
  it("one per set that draws lines, the depth face for the rest, and the irises close up — nothing else", () => {
    const drawing = ALL_SETS.filter((s) => videoFaceMeshLayersDrawLines(s))
    expect(drawing).toHaveLength(62)
    for (const s of ALL_SETS) expect(FACE_MESH_THUMBNAIL_FILES[faceMeshThumbnailKey(s)], JSON.stringify(s)).toBeDefined()
    expect(new Set(Object.keys(FACE_MESH_THUMBNAIL_FILES))).toEqual(new Set([...drawing.map(faceMeshThumbnailKey), "depth", "irises-closeup"]))
    expect(faceMeshThumbnailKey({ bold: true })).toBe("depth")
    expect(faceMeshThumbnailKey({ lips: true, wireframe: true, bold: true })).toBe("wireframe+lips+bold")
  })

  it("every picture listed is shipped, small, and every shipped one is listed", () => {
    const shipped = readdirSync(DIR).filter((f) => !f.startsWith("."))
    const listed = Object.values(FACE_MESH_THUMBNAIL_FILES)
    expect(new Set(listed.map((p) => p.replace(/^\/face-mesh-art\//, "")))).toEqual(new Set(shipped))
    for (const p of listed) {
      expect(p).toMatch(/^\/face-mesh-art\/[a-z-]+\.[0-9a-f]{8}\.webp$/)
      expect(statSync(path.join(PUBLIC, p)).size).toBeLessThan(12 * 1024)
    }
  })

  it("says what is drawn", () => {
    expect(faceMeshLayersThumbnail({ wireframe: true, eyes: true, lips: true }).alt).toBe("A depth face with the wireframe, eye outlines and lip outline drawn")
    expect(faceMeshLayersThumbnail({ contours: true, bold: true }).alt).toBe("A depth face with the contours drawn in bold lines")
    expect(faceMeshLayersThumbnail({ bold: true })).toEqual({ src: FACE_MESH_THUMBNAIL_FILES.depth, alt: "A depth face with no face mesh lines" })
    expect(faceMeshLayerSwitchThumbnail("irises").src).toBe(FACE_MESH_THUMBNAIL_FILES["irises-closeup"])
    expect(faceMeshLayerSwitchThumbnail("bold")).toEqual(faceMeshLayersThumbnail({ wireframe: true, eyes: true, lips: true, bold: true }))
    expect(faceMeshLayerSwitchThumbnail("eyes")).toEqual(faceMeshLayersThumbnail({ eyes: true }))
  })
})

function Switches({ initial }: { initial: VideoFaceMeshLayers }) {
  const [value, setValue] = useState(initial)
  return <FaceMeshLayerSwitches legend="Layers" value={value} onChange={setValue} />
}

describe("the layer switches", () => {
  it("each switch shows its layer, and the set is shown as it is drawn as the switches change", async () => {
    const user = userEvent.setup()
    render(<Switches initial={{ eyes: true, lips: true }} />)
    const preview = within(screen.getByTestId("face-mesh-layers-preview")).getByRole("img")
    expect(preview).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES["eyes+lips"])
    expect(preview).toHaveAccessibleName("A depth face with the eye outlines and lip outline drawn")
    await user.click(screen.getByRole("switch", { name: "Irises" }))
    expect(preview).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES["eyes+lips+irises"])
    await user.click(screen.getByRole("switch", { name: "Bold lines" }))
    expect(preview).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES["eyes+lips+irises+bold"])
    // One picture per switch, besides the set's; the switches keep their names.
    expect(screen.getAllByTestId("face-mesh-thumbnail")).toHaveLength(7)
    expect(screen.getByRole("img", { name: "The irises alone, drawn on a depth face, the eyes close up" })).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES["irises-closeup"])
    expect(screen.getByRole("img", { name: "A depth face with the wireframe, eye outlines and lip outline drawn in bold lines" })).toBeInTheDocument()
  })

  it("a set that draws nothing shows the depth face alone", () => {
    render(<Switches initial={{ bold: true }} />)
    expect(within(screen.getByTestId("face-mesh-layers-preview")).getByRole("img")).toHaveAttribute("src", FACE_MESH_THUMBNAIL_FILES.depth)
  })
})

function Lines({ initial }: { initial: AdminTrendFaceMasking }) {
  const [value, setValue] = useState<AdminTrendFaceMasking | undefined>(initial)
  return (
    <FaceMeshLinesChoice
      value={value}
      set={(patch) => setValue((v) => ({ ...v!, ...patch }))}
      faceMeshPartsMissingIn={{ features: [], mouth: [] }}
      faceMeshLayersMissing={{ engine: [], platform: [] }}
    />
  )
}

describe("the face mesh lines choice", () => {
  it("each choice shows its lines beside its name (the names unchanged); the closed box shows the name alone", async () => {
    const user = userEvent.setup()
    render(<Lines initial={{ mode: "always", source: "full-depth", faceMesh: true, faceMeshParts: "mouth" }} />)
    await user.click(screen.getByRole("combobox", { name: "Face mesh lines" }))
    const srcOf = (name: string) => within(screen.getByRole("option", { name })).getByTestId("face-mesh-thumbnail").getAttribute("src")
    expect(srcOf("Full (default)")).toBe(FACE_MESH_THUMBNAIL_FILES["wireframe+eyes+lips"])
    expect(srcOf("Eyes and mouth")).toBe(FACE_MESH_THUMBNAIL_FILES["eyes+lips"])
    expect(srcOf("Mouth only")).toBe(FACE_MESH_THUMBNAIL_FILES.lips)
    // "Choose the layers" shows the set it would start from: what is drawn now.
    expect(srcOf("Choose the layers")).toBe(FACE_MESH_THUMBNAIL_FILES.lips)
    await user.click(screen.getByRole("option", { name: "Eyes and mouth" }))
    expect(screen.getByRole("combobox", { name: "Face mesh lines" })).toHaveTextContent(/^Eyes and mouth$/)
  })
})
