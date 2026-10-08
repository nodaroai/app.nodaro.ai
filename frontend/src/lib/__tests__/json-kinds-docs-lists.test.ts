import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { RENDER_NODE_TYPES, declaredJsonOutput, declaredJsonOutputRows } from "@nodaro/shared"
import { NODE_DEF_MAP } from "@/types/nodes"

/**
 * The prose that tells agents and users which outputs the EDL input refuses
 * (decided 2026-10-08: a Transcript is not an EDL) names the Transcript outputs
 * one by one. Text to Dialogue's `json` was declared a Transcript and the lists
 * kept naming only the old producers, so an agent reading them wired it into an
 * `edl` input and had the edge dropped with a warning it was never told about.
 *
 * This derives the Transcript outputs from the declarations (the json-kinds
 * table and the render-node registry) and requires every list that enumerates
 * them to name each one, so the next Transcript producer cannot be added
 * without the lists following.
 */
const REPO = join(__dirname, "../../../..")

/** Every output pip declared a Transcript, as the sentence names it: "Label's `pip`". */
const transcriptOutputs: string[] = [
  ...declaredJsonOutputRows().filter(([, , kind]) => kind === "transcript").map(([type, pip]) => [type, pip] as const),
  ...Object.keys(RENDER_NODE_TYPES)
    .filter((type) => declaredJsonOutput(type, "json") === "transcript")
    .map((type) => [type, "json"] as const),
].map(([type, pip]) => `${NODE_DEF_MAP.get(type)?.label ?? type}'s \`${pip}\``)

const FILES = [
  "backend/skills/workflow-editor.md",
  "docs/mcp/tools.md",
  "docs/nodes/processing-video/apply-edl.md",
  "docs/nodes/processing-video/add-captions.md",
]

/** The paragraphs/table rows that enumerate Transcript outputs refused at an `edl` input. */
function listingParagraphs(file: string): string[] {
  return readFileSync(join(REPO, file), "utf8")
    .split(/\n\s*\n|\n(?=\|)/)
    .map((p) => p.replace(/\s+/g, " "))
    .filter((p) => /transcript output (\(|—)/i.test(p))
}

describe("the lists of Transcript outputs refused at an EDL input name every Transcript output", () => {
  it("derives the outputs it is meant to guard", () => {
    expect(transcriptOutputs).toEqual(
      expect.arrayContaining(["Transcribe's `json`", "Text to Dialogue's `json`", "Camera Switch's `transcript`", "Apply EDL's `json`"]),
    )
  })

  it.each(FILES)("%s", (file) => {
    const paragraphs = listingParagraphs(file)
    expect(paragraphs.length, `${file} no longer has a list of Transcript outputs refused at an edl input`).toBeGreaterThan(0)
    for (const p of paragraphs) {
      for (const name of transcriptOutputs) {
        expect(p, `${file}: the list of Transcript outputs is missing ${name}`).toContain(name)
      }
    }
  })
})
