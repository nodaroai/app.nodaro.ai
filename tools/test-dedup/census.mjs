// tools/test-dedup/census.mjs
// The static half of `equivalence.mjs merge` (plan §2, "A file merge"): what a
// merged file must carry over from the files it replaces, read from each test
// file's TypeScript AST. Comments and layout never matter (nodes are printed
// without them). Compared by staticsDiff (verdicts.mjs).
//   env         the `@vitest-environment` pragma ("" = the project default)
//   mocks       every vi.mock / vi.doMock / vi.unmock / vi.hoisted call, factory included
//   hooks       every beforeAll / beforeEach / afterEach / afterAll call
//   assertions  every expect(…)… / assert…(…) chain, as printed: a dropped,
//               duplicated or edited assertion changes this multiset, which
//               test names, pass counts and line coverage never see
//   bodies      every it/test body (bodies.mjs extractTests)
//   watches     @test-watches globs and an @test-always reason
//   lines       the file's line count
// `typescript` is passed in by the caller (loaded lazily).
// @reads-none parses only the source text it is given
import { parseAnnotations } from "../test-select/annotations.mjs"
import { extractTests } from "./bodies.mjs"

const MOCKS = new Set(["vi.mock", "vi.doMock", "vi.unmock", "vi.doUnmock", "vi.hoisted"])
const HOOKS = new Set(["beforeAll", "beforeEach", "afterEach", "afterAll"])

export function testFileStatics(ts, file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const printer = ts.createPrinter({ removeComments: true })
  const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, sf)
  const nameOf = (e) => (ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? `${nameOf(e.expression)}.${e.name.text}` : "?")
  // The identifier a call chain starts from: expect(x).not.toBe(y) → expect.
  const rootOf = (e) => {
    while (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isNonNullExpression(e)) e = e.expression
    return ts.isIdentifier(e) ? e.text : ""
  }
  const continuesChain = (node) => {
    const p = node.parent
    return (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p) || ts.isCallExpression(p) || ts.isNonNullExpression(p)) && p.expression === node
  }
  const mocks = []
  const hooks = []
  const assertions = []
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = nameOf(node.expression)
      if (MOCKS.has(name)) mocks.push(print(node))
      if (HOOKS.has(name)) hooks.push(print(node))
      if (["expect", "assert"].includes(rootOf(node)) && !continuesChain(node)) assertions.push(print(node))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  const { watches, always } = parseAnnotations(source)
  return {
    file,
    env: /@vitest-environment[ \t]+(\S+)/.exec(source)?.[1] ?? "",
    mocks: mocks.sort(),
    hooks: hooks.sort(),
    assertions: assertions.sort(),
    bodies: extractTests(ts, file, source).map((t) => t.body).sort(),
    watches: [...watches, ...(always ? ["@test-always"] : [])].sort(),
    lines: source.split("\n").length,
  }
}
