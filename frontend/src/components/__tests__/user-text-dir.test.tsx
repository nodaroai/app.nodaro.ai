import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { ReactElement } from "react"
import { render, screen } from "@testing-library/react"
import { editableTextDir, textDirOf } from "@/lib/user-text-dir"
import { ReadOnlyPromptBlock } from "@/components/presentation/readonly-prompt-block"
import { RichtextBlock } from "@/components/presentation/richtext-block"
import { TextCollapsibleOutput } from "@/components/presentation/output-cards/text-collapsible-output"
import { TextOutputCard } from "@/components/presentation/output-cards/text-output-card"
import { SortableCardWrapper } from "@/components/presentation/sortable-card-wrapper"
import { PresentationTextInput } from "@/components/presentation/input-cards/shared"
import { TextItemsPreview } from "@/components/nodes/text-items-preview"
import { TemplateMarketplaceCard } from "@/components/templates/template-marketplace-card"
import type { TemplateBrowseCard } from "@/lib/api"

/**
 * Text a user or author wrote renders with `dir="auto"` (see
 * `lib/user-text-dir.ts`): its own first strong character sets the reading
 * direction, so a Hebrew note in an English UI keeps its final punctuation on
 * the correct edge. UI chrome is untouched and keeps following `<html dir>`.
 *
 * Two lists below. Adding a surface that shows authored text? Add it to one.
 */

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false }),
}))

const HE = "שלום עולם, זה טקסט."
const HE_2 = "תיאור בעברית."

/** The nearest element carrying a `dir` attribute, from the text's own node up. */
function dirOf(text: string): string | null | undefined {
  return screen.getByText(text).closest("[dir]")?.getAttribute("dir")
}

const templateCard: TemplateBrowseCard = {
  id: "t1",
  slug: "s",
  name: HE,
  description: HE_2,
  nodeTypesUsed: [],
  providersUsed: [],
  nodeCount: 1,
  estimatedCredits: 1,
  complexity: "simple",
  category: "image-generation",
  outputTypes: ["image"],
  tags: [],
  previewMediaUrl: null,
  previewMediaType: null,
  creatorId: "c",
  creatorDisplayName: "c",
  cloneCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  favoriteCount: 0,
}

/** Rendered surfaces: the authored sample must sit under a dir="auto" element. */
const RENDERED: ReadonlyArray<{ name: string; ui: () => ReactElement; sample: string }> = [
  { name: "ReadOnlyPromptBlock (app read-only prompt)", ui: () => <ReadOnlyPromptBlock text={HE} refMap={new Map()} />, sample: HE },
  { name: "RichtextBlock (app rich text)", ui: () => <RichtextBlock content={`<p>${HE}</p>`} />, sample: HE },
  { name: "TextOutputCard (app text output)", ui: () => <TextOutputCard label="Out" status="completed" text={HE} />, sample: HE },
  { name: "TextCollapsibleOutput (app text list output)", ui: () => <TextCollapsibleOutput results={[HE]} status="completed" />, sample: HE },
  { name: "TextItemsPreview (canvas text preview)", ui: () => <TextItemsPreview items={[HE]} summary="1 item" />, sample: HE },
  { name: "SortableCardWrapper (app card description)", ui: () => <SortableCardWrapper id="n" isEditMode={false} cardDescription={HE}><div /></SortableCardWrapper>, sample: HE },
  { name: "PresentationTextInput label (app input card)", ui: () => <PresentationTextInput label={HE} value="" onChange={() => {}} mode="prompt" />, sample: HE },
  { name: "TemplateMarketplaceCard name", ui: () => <TemplateMarketplaceCard template={templateCard} isFavorited={false} onToggleFavorite={() => {}} onOpen={() => {}} now={Date.parse("2026-02-01T00:00:00Z")} />, sample: HE },
]

describe("authored text renders with dir=auto", () => {
  it.each(RENDERED)("$name", ({ ui, sample }) => {
    render(ui())
    expect(dirOf(sample)).toBe("auto")
  })

  it("an app text input carries dir=auto once it holds text, and inherits the UI direction while empty", () => {
    const { rerender } = render(<PresentationTextInput label="L" value="" placeholder="P" onChange={() => {}} mode="prompt" />)
    expect(screen.getByPlaceholderText("P").getAttribute("dir")).toBeNull()
    rerender(<PresentationTextInput label="L" value={HE} placeholder="P" onChange={() => {}} mode="prompt" />)
    expect(screen.getByPlaceholderText("P").getAttribute("dir")).toBe("auto")
  })

  it("the read-only prompt's empty state is chrome and carries no dir", () => {
    const { container } = render(<ReadOnlyPromptBlock text="" refMap={new Map()} />)
    expect(container.querySelector("[dir]")).toBeNull()
  })

  it("editableTextDir leaves an empty field to the UI direction", () => {
    expect(editableTextDir(undefined)).toBeUndefined()
    expect(editableTextDir("   ")).toBeUndefined()
    expect(editableTextDir(HE)).toBe("auto")
  })

  it("textDirOf picks the direction of the first letter, like dir=auto, and leaves letterless text to the UI", () => {
    expect(textDirOf(HE)).toBe("rtl")
    expect(textDirOf("Hello, world.")).toBe("ltr")
    expect(textDirOf("12, (\u00ab") ).toBeUndefined()
    expect(textDirOf("  42. שלום Kettlefin")).toBe("rtl")
    expect(textDirOf("42. Kettlefin שלום")).toBe("ltr")
    expect(textDirOf("مرحبا")).toBe("rtl")
    expect(textDirOf("こんにちは")).toBe("ltr")
    expect(textDirOf("")).toBeUndefined()
    expect(textDirOf(undefined)).toBeUndefined()
    // `skip` drops spans that are not prose before the first letter is found.
    expect(textDirOf("{Person} שלום")).toBe("ltr")
    expect(textDirOf("{Person} שלום", [/\{[^}]+\}/g])).toBe("rtl")
    expect(textDirOf("{image:1}", [/\{[^}]+\}/g])).toBeUndefined()
  })
})

/**
 * Surfaces too heavy to mount here (modals, pages, nodes inside the canvas).
 * Each anchor is the authored-text expression (or an attribute of the input
 * that holds it); the element that OPENS nearest before the anchor must carry
 * `dir="auto"` / `dir={editableTextDir(...)}` in its own opening tag — so the
 * guard checks placement, not merely that the string appears in the file.
 */
const SOURCE: ReadonlyArray<{ file: string; anchor: string }> = [
  { file: "components/nodes/combine-text-node.tsx", anchor: "{text}</p>" },
  { file: "components/nodes/image-to-text-node.tsx", anchor: "{text}</p>" },
  { file: "components/nodes/image-to-text-node.tsx", anchor: "{activeText}" },
  { file: "components/editor/config-panels/prompt-field-final-view.tsx", anchor: "{/* Flat-path fallback" },
  { file: "components/editor/config-panels/tag-textarea.tsx", anchor: "{renderFormattedText}\n" },
  { file: "components/templates/template-detail-modal.tsx", anchor: "{summary.description}</p>" },
  { file: "components/templates/template-detail-modal.tsx", anchor: "<Markdown remarkPlugins" },
  { file: "components/templates/template-detail-modal.tsx", anchor: "{summary.name}</span>" },
  { file: "components/templates/template-detail-modal.tsx", anchor: "{card.name}" },
  { file: "components/templates/template-preview-modal.tsx", anchor: "{template.description}" },
  { file: "components/templates/template-preview-modal.tsx", anchor: "{template.name}" },
  { file: "components/templates/template-canvas-preview.tsx", anchor: "{summary.description}" },
  { file: "components/templates/template-canvas-preview.tsx", anchor: "{summary.name}" },
  { file: "components/templates/my-templates-grid.tsx", anchor: "{template.description}</p>" },
  { file: "components/templates/my-templates-grid.tsx", anchor: "{template.name}" },
  { file: "components/apps/app-marketplace-card.tsx", anchor: "{app.description}" },
  { file: "app/(dashboard)/apps/page.tsx", anchor: "{app.description}</p>" },
  { file: "components/presentation/input-card.tsx", anchor: "{label}</span></p>" },
  { file: "components/presentation/input-cards/text-input-card.tsx", anchor: "{label}</span>" },
  { file: "components/presentation/input-cards/list-input-card.tsx", anchor: "{label}</span>" },
  { file: "components/presentation/input-cards/list-input-card.tsx", anchor: "value={item}" },
  { file: "components/presentation/sortable-card-wrapper.tsx", anchor: 'value={cardTitle ?? ""}' },
  { file: "components/presentation/sortable-card-wrapper.tsx", anchor: 'value={cardDescription ?? ""}' },
]

const SRC = join(__dirname, "..", "..")

/** The opening tag of the element that encloses `index` (or holds it as an attribute). */
function openingTagAround(text: string, index: number): string {
  const before = text.slice(0, index)
  const start = Math.max(...[...before.matchAll(/<[A-Za-z]/g)].map((m) => m.index ?? -1))
  if (start < 0) return ""
  // Through the anchor for an attribute anchor; the opening tag ends at the
  // first `>` that is not part of `=>` after the attributes.
  const rest = text.slice(start)
  const close = rest.search(/[^=]>/)
  return rest.slice(0, close < 0 ? rest.length : close + 2)
}

describe("authored text renders with dir=auto (source placement)", () => {
  it.each(SOURCE)("$file — $anchor", ({ file, anchor }) => {
    const text = readFileSync(join(SRC, file), "utf8")
    let found = 0
    for (let i = text.indexOf(anchor); i >= 0; i = text.indexOf(anchor, i + 1)) {
      found += 1
      expect(openingTagAround(text, i)).toMatch(/\sdir=(?:"auto"|\{editableTextDir\()/)
    }
    expect(found).toBeGreaterThan(0)
  })
})
