// @vitest-environment node
// @test-watches frontend/src/**/*.{ts,tsx}
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/**
 * "Edit video" is offered in ONE way, so an install with the editor switched
 * off (`FREECUT_URL=off`) shows it nowhere and a new node cannot bring back a
 * button that opens nothing.
 *
 *   - On the canvas the action is `EditVideoButton` (components/nodes/
 *     edit-video-button.tsx), which draws nothing without an editor. A node
 *     hands it the open: `<EditVideoButton onEdit={() => openFreeCut(…)} />`,
 *     or `onEdit` on `VideoResultOverlay`, which renders that button.
 *   - On an output card the Edit is bound by `resolveCardActions`
 *     (`cardEditOffered`): a video card offers it only where the video editor
 *     is configured.
 *   - The store's `openFreeCut` refuses without an editor: the backstop.
 *
 * So, outside the files listed below, product code may not:
 *   - name `openFreeCut` except to select it from the store, bind it to a
 *     variable, or call it inside the `onEdit` of those two elements;
 *   - write the action's wording keys (the shared button is the only one);
 *   - read the video editor's URL, or the predicate over it, itself.
 *
 * "Edit" on an audio result is offered only on an output card (no node on the
 * canvas draws one), and opens the embedded audio editor (`AUDIOMASS_URL`), so
 * an install with it switched off (`AUDIOMASS_URL=off`) shows it nowhere:
 *   - The card's Edit is bound by `resolveCardActions` (`cardEditOffered`,
 *     over `audioEditorOffered`), the only caller of an output card's
 *     `onEdit(node, type, url)`.
 *   - The presentation view's Edit handler is the one place that mounts the
 *     audio editor, and refuses where `cardEditOffered` does: the backstop.
 *
 * So, outside the files listed below, product code may not mount the audio
 * editor (name its component or its module), call an output card's `onEdit`,
 * or read the audio editor's URL, origin or the predicates over them.
 */

const BUTTON = "components/nodes/edit-video-button.tsx"
const CARD_ACTIONS = "components/presentation/output-cards/shared.tsx"
const STORE = "hooks/use-workflow-store.ts"
const RUNTIME_CONFIG = "lib/runtime-config.ts"
const AUDIO_MODAL = "components/editor/audiomass-editor-modal.tsx"
const PRESENTATION = "components/presentation/presentation-view.tsx"

/** Elements whose `onEdit` is the action itself. */
const ACTION_ELEMENTS = new Set(["EditVideoButton", "VideoResultOverlay"])

/** Files that name `openFreeCut` otherwise, each with its reason. Every entry must still be used. */
const OPEN_FREECUT_FILES: Readonly<Record<string, string>> = {
  [STORE]: "defines it, and refuses without an editor (the backstop)",
  "nodes/kit.ts": "declares the unit kit's binding of it (a type, no call)",
  "components/nodes/use-unit-node-kit.ts": "binds it to a unit's node; the unit hands `kit.openFreeCut` to an `onEdit` checked below",
  [PRESENTATION]: "the output cards' Edit handler, which only resolveCardActions binds, and only where cardEditOffered",
}

/** The action's wording: only the shared button writes it. */
const WORDING_KEYS = new Set(["node.editInNodarcut", "common.editVideo"])

/** Who may read an editor's URL and the predicate over it, each with its reason. Every entry must still be used. */
const CONFIG_READERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [RUNTIME_CONFIG]: {
    runtimeFreecutUrl: "defines it",
    videoEditorOffered: "defines it",
    runtimeAudiomassUrl: "defines it",
    runtimeAudiomassOrigin: "defines it",
    audioEditorState: "defines it",
    audioEditorOffered: "defines it",
  },
  "components/editor/freecut-editor-modal.tsx": { runtimeFreecutUrl: "frames the editor at that URL (and says so when there is none)" },
  [AUDIO_MODAL]: {
    runtimeAudiomassUrl: "frames the editor at that URL (and explains when there is none)",
    runtimeAudiomassOrigin: "trusts the editor's messages from that origin only",
  },
  [BUTTON]: { videoEditorOffered: "the canvas action: draws nothing without an editor" },
  [CARD_ACTIONS]: {
    videoEditorOffered: "cardEditOffered, for every video output card's Edit",
    audioEditorOffered: "cardEditOffered, for every audio output card's Edit",
  },
  [STORE]: { videoEditorOffered: "openFreeCut's backstop" },
}
const CONFIG_NAMES = new Set([
  "runtimeFreecutUrl",
  "videoEditorOffered",
  "runtimeAudiomassUrl",
  "runtimeAudiomassOrigin",
  "audioEditorState",
  "audioEditorOffered",
])

/** Who may name the audio editor's component or module, each with its reason. Every entry must still be used. */
const AUDIO_EDITOR_FILES: Readonly<Record<string, string>> = {
  [AUDIO_MODAL]: "defines it",
  [PRESENTATION]: "the output cards' Edit handler, which only resolveCardActions binds, and only where cardEditOffered",
}
const AUDIO_EDITOR_NAME = "AudiomassEditorModal"
const AUDIO_EDITOR_MODULE = /(^|\/)audiomass-editor-modal(\.tsx?)?$/

const SRC = path.resolve(__dirname, "..", "..", "..")
const SKIP_DIRS = new Set(["__tests__", "test", "node_modules"])

function productFiles(rel = "", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(SRC, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) productFiles(r, out)
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(r)
  }
  return out
}

interface Finding {
  readonly file: string
  readonly line: number
  readonly kind: "action-call" | "stray-open" | "wording" | "config" | "audio-editor" | "card-edit-call"
  readonly name: string
}

/** The JSX element whose `onEdit` attribute `node` sits inside, if any. */
function onEditOwner(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isJsxAttribute(at)) {
      if (at.name.getText() !== "onEdit") return null
      const owner = at.parent.parent
      return ts.isJsxSelfClosingElement(owner) || ts.isJsxOpeningElement(owner) ? owner.tagName.getText() : null
    }
  }
  return null
}

/**
 * `const openFreeCut = useWorkflowStore((s) => s.openFreeCut)`: the selector
 * reads it into a variable of its own name, whose calls are then checked. Read
 * into any other name, its calls would escape the check.
 */
function isStoreSelector(node: ts.PropertyAccessExpression): boolean {
  const fn = node.parent
  if (!fn || !ts.isArrowFunction(fn) || fn.body !== node) return false
  const call = fn.parent
  if (!call || !ts.isCallExpression(call) || call.expression.getText() !== "useWorkflowStore") return false
  const decl = call.parent
  return !!decl && ts.isVariableDeclaration(decl) && decl.initializer === call && ts.isIdentifier(decl.name) && decl.name.text === "openFreeCut"
}

function scan(rel: string): Finding[] {
  const text = fs.readFileSync(path.join(SRC, rel), "utf8")
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Finding[] = []
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === "openFreeCut") {
      const parent = node.parent
      const callee = ts.isPropertyAccessExpression(parent) && parent.name === node ? parent : node
      const call = callee.parent
      if (ts.isCallExpression(call) && call.expression === callee) {
        const owner = onEditOwner(call)
        out.push({ file: rel, line: at(node), kind: owner && ACTION_ELEMENTS.has(owner) ? "action-call" : "stray-open", name: owner ?? "openFreeCut()" })
      } else if (ts.isVariableDeclaration(parent) && parent.name === node) {
        // `const openFreeCut = useWorkflowStore(…)`: its uses are checked where they are.
      } else if (ts.isPropertyAccessExpression(callee) && isStoreSelector(callee)) {
        // The store selector: reading the action, not offering it.
      } else {
        out.push({ file: rel, line: at(node), kind: "stray-open", name: "openFreeCut" })
      }
    }
    if (ts.isStringLiteralLike(node) && WORDING_KEYS.has(node.text)) out.push({ file: rel, line: at(node), kind: "wording", name: node.text })
    if (ts.isIdentifier(node) && CONFIG_NAMES.has(node.text)) out.push({ file: rel, line: at(node), kind: "config", name: node.text })
    if (ts.isIdentifier(node) && node.text === AUDIO_EDITOR_NAME) out.push({ file: rel, line: at(node), kind: "audio-editor", name: node.text })
    if (ts.isStringLiteralLike(node) && AUDIO_EDITOR_MODULE.test(node.text)) out.push({ file: rel, line: at(node), kind: "audio-editor", name: node.text })
    // An output card's `onEdit(node, type, url)`: a member call with that card's three arguments.
    if (ts.isCallExpression(node) && node.arguments.length === 3) {
      const callee = ts.isNonNullExpression(node.expression) ? node.expression.expression : node.expression
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "onEdit") out.push({ file: rel, line: at(node), kind: "card-edit-call", name: callee.getText() })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

// The dictionaries hold the wording keys as their own keys; nothing there draws a button.
const FILES = productFiles().filter((f) => !f.startsWith("lib/i18n/"))
const FINDINGS = FILES.flatMap(scan)
const show = (f: Finding) => `${f.file}:${f.line} ${f.name}`

describe("Edit video and Edit on audio are offered only through their shared pieces", () => {
  it("the scan sees the product (sanity: the shared pieces and the nodes offering the action are there)", () => {
    for (const file of [BUTTON, CARD_ACTIONS, STORE, RUNTIME_CONFIG, "components/nodes/video-result-overlay.tsx"]) expect(FILES).toContain(file)
    // 28 results on the shared overlay (two of them node units) + 13 nodes laying out their own buttons.
    // Floored a little below to tolerate churn; the rules below are the real guard.
    expect(FINDINGS.filter((f) => f.kind === "action-call").length).toBeGreaterThanOrEqual(38)
    expect(FINDINGS.some((f) => f.kind === "action-call" && f.name === "EditVideoButton")).toBe(true)
    expect(FINDINGS.some((f) => f.kind === "action-call" && f.file.startsWith("nodes/"))).toBe(true)
  })

  it("no file opens the editor but from the action's own onEdit (or a file listed with its reason)", () => {
    const stray = FINDINGS.filter((f) => f.kind === "stray-open" && !OPEN_FREECUT_FILES[f.file])
    expect(stray.map(show)).toEqual([])
  })

  it("only the shared button writes the action's wording", () => {
    expect(FINDINGS.filter((f) => f.kind === "wording" && f.file !== BUTTON).map(show)).toEqual([])
  })

  it("no file reads an editor's URL or the predicate over it, but the readers listed with their reason", () => {
    expect(FINDINGS.filter((f) => f.kind === "config" && !CONFIG_READERS[f.file]?.[f.name]).map(show)).toEqual([])
  })

  it("no file mounts the audio editor but the presentation view's Edit handler (or a file listed with its reason)", () => {
    expect(FINDINGS.some((f) => f.kind === "audio-editor" && f.file === PRESENTATION)).toBe(true)
    expect(FINDINGS.filter((f) => f.kind === "audio-editor" && !AUDIO_EDITOR_FILES[f.file]).map(show)).toEqual([])
  })

  it("only resolveCardActions calls an output card's onEdit", () => {
    expect(FINDINGS.some((f) => f.kind === "card-edit-call" && f.file === CARD_ACTIONS)).toBe(true)
    expect(FINDINGS.filter((f) => f.kind === "card-edit-call" && f.file !== CARD_ACTIONS).map(show)).toEqual([])
  })

  it("the lists only shrink: each entry is still used", () => {
    const unused = [
      ...Object.keys(OPEN_FREECUT_FILES).filter((file) => !FINDINGS.some((f) => f.file === file && (f.kind === "stray-open" || f.kind === "action-call"))),
      ...Object.keys(AUDIO_EDITOR_FILES).filter((file) => !FINDINGS.some((f) => f.file === file && f.kind === "audio-editor")),
      ...Object.entries(CONFIG_READERS).flatMap(([file, names]) =>
        Object.keys(names)
          .filter((name) => !FINDINGS.some((f) => f.file === file && f.kind === "config" && f.name === name))
          .map((name) => `${file} ${name}`),
      ),
    ]
    expect(unused).toEqual([])
  })
})
