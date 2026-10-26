/**
 * The CLI surface (@nodaro/cli, packages/cli): every leaf command path
 * (`characters list`, `workflows collaborators add`) and the SDK methods its
 * action calls.
 *
 * The command TREE is read at run time, exactly as the CLI builds it: the
 * factories `packages/cli/src/index.ts` registers are called on a fresh
 * program (index.ts itself is never imported — it parses argv on import).
 * Which SDK methods a command calls is read from the AST: for each
 * `.action(fn)`, the nearest `.command("leaf …")` on its receiver chain names
 * the command (through wrappers like `withAccountFlags(cmd.command(…))`), and
 * calls like `client.characters.list(…)` inside `fn` — plus inside the
 * same-file helpers it calls, one hop — are its SDK calls. A group file may
 * register some of its commands from a sibling module it imports
 * (`registerUseCaseCommands(cmd)` in commands/edit-use-case.ts): that module's
 * actions are read too, and one whose receiver is the function's parameter
 * (no `new Command("…")` in sight) belongs to the group that imports it.
 */
// @reads packages/cli/src/**
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { lineOf, parseText } from "../../../src/lib/__tests__/source-ast.js"
import { unwrap } from "./render-path.js"

export const CLI_DIR = "packages/cli/src"

export interface CliCommand {
  /** `characters list`. */
  path: string
  /** `packages/cli/src/commands/characters.ts:19`, when the action was found. */
  ref?: string
  /** SDK method keys the action calls (`characters.list`). Empty: a local-only command. */
  sdk: string[]
}

export interface CliInventory {
  commands: CliCommand[]
  /** Top-level command groups. */
  groups: string[]
}

interface RuntimeCommand {
  name(): string
  commands: readonly RuntimeCommand[]
}

/** The factories index.ts registers: `program.addCommand(xCommand())` and `registerX(program)`. */
function registeredFactories(indexSf: ts.SourceFile): Array<{ fn: string; from: string; kind: "add" | "register" }> {
  const imports = new Map<string, string>()
  for (const st of indexSf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings) continue
    const from = (st.moduleSpecifier as ts.StringLiteral).text
    if (!ts.isNamedImports(st.importClause.namedBindings)) continue
    for (const el of st.importClause.namedBindings.elements) imports.set(el.name.text, from)
  }
  const out: Array<{ fn: string; from: string; kind: "add" | "register" }> = []
  for (const st of indexSf.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) continue
    const call = st.expression
    const callee = unwrap(call.expression)
    if (ts.isPropertyAccessExpression(callee) && callee.name.text === "addCommand") {
      const arg = call.arguments[0]
      if (arg && ts.isCallExpression(arg) && ts.isIdentifier(arg.expression) && imports.has(arg.expression.text)) {
        out.push({ fn: arg.expression.text, from: imports.get(arg.expression.text)!, kind: "add" })
      }
    } else if (ts.isIdentifier(callee) && imports.has(callee.text)) {
      out.push({ fn: callee.text, from: imports.get(callee.text)!, kind: "register" })
    }
  }
  return out
}

async function runtimeTree(repoRoot: string): Promise<{ leaves: string[][]; groups: string[]; files: Map<string, string> }> {
  const src = join(repoRoot, CLI_DIR)
  const indexSf = parseText("index.ts", readFileSync(join(src, "index.ts"), "utf8"))
  const factories = registeredFactories(indexSf)
  // commander as the CLI resolves it, not whatever copy the backend would.
  const commander = createRequire(join(src, "index.ts")).resolve("commander")
  const { Command } = (await import(pathToFileURL(commander).href)) as { Command: new () => RuntimeCommand & { addCommand(c: unknown): void } }
  const program = new Command()
  const files = new Map<string, string>() // group → command file
  for (const f of factories) {
    const file = join(src, f.from.replace(/\.js$/, ".ts"))
    const mod = (await import(pathToFileURL(file).href)) as Record<string, (...a: unknown[]) => unknown>
    const before = new Set(program.commands.map((c) => c.name()))
    if (f.kind === "add") program.addCommand(mod[f.fn]!())
    else mod[f.fn]!(program)
    // Repo-relative with forward slashes on every platform: siblingModules splits on "/".
    for (const c of program.commands) if (!before.has(c.name())) files.set(c.name(), file.slice(repoRoot.length + 1).replace(/\\/g, "/"))
  }
  const leaves: string[][] = []
  const visit = (c: RuntimeCommand, prefix: string[]): void => {
    for (const sub of c.commands) {
      const p = [...prefix, sub.name()]
      if (sub.commands.length) visit(sub, p)
      else leaves.push(p)
    }
  }
  visit(program, [])
  return { leaves, groups: program.commands.map((c) => c.name()), files }
}

/** The first word of a `.command("leaf <arg>")` spec. */
function specName(e: ts.Expression | undefined): string | undefined {
  if (!e) return undefined
  const x = unwrap(e)
  return ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text.trim().split(/\s+/)[0] : undefined
}

type Locals = Map<string, ts.Expression>

/** The command name an expression evaluates to: `new Command("x")`, `y.command("x")`, or a local bound to one. */
function commandName(e: ts.Expression, scopes: Locals[], depth = 0): string | undefined {
  if (depth > 6) return undefined
  const x = unwrap(e)
  if (ts.isNewExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "Command") return specName(x.arguments?.[0])
  if (ts.isIdentifier(x)) {
    for (const s of scopes) {
      const init = s.get(x.text)
      if (init) return commandName(init, scopes, depth + 1)
    }
    return undefined
  }
  if (ts.isCallExpression(x)) {
    const callee = unwrap(x.expression)
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === "command") return specName(x.arguments[0])
      // `.description(…)`, `.option(…)` … return the same command.
      return commandName(callee.expression, scopes, depth + 1)
    }
  }
  return undefined
}

/** Walk down an `.action()` receiver chain to its `.command("leaf")` call: the leaf and the command it was added to. */
function actionTarget(receiver: ts.Expression, scopes: Locals[]): { leaf: string; parent?: string } | undefined {
  let cur = unwrap(receiver)
  for (let i = 0; i < 40; i++) {
    if (!ts.isCallExpression(cur)) return undefined
    const callee = unwrap(cur.expression)
    if (ts.isPropertyAccessExpression(callee)) {
      if (callee.name.text === "command") {
        const leaf = specName(cur.arguments[0])
        return leaf ? { leaf, parent: commandName(callee.expression, scopes) } : undefined
      }
      cur = unwrap(callee.expression)
      continue
    }
    // A wrapper such as withAccountFlags(cmd.command("update <id>")).
    if (cur.arguments[0]) {
      cur = unwrap(cur.arguments[0])
      continue
    }
    return undefined
  }
  return undefined
}

function isClientRoot(e: ts.Expression, scopes: Locals[]): boolean {
  const x = unwrap(e)
  if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "buildClient") return true
  if (!ts.isIdentifier(x)) return false
  if (/client/i.test(x.text)) return true
  for (const s of scopes) {
    const init = s.get(x.text)
    if (init) return isClientRoot(init, scopes)
  }
  return false
}

/** SDK method keys called under `node` (`client.a.b(…)`, `client.a.b.c(…)`). */
function sdkCalls(node: ts.Node, scopes: Locals[], sdkKeys: ReadonlySet<string>): string[] {
  const out = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const parts: string[] = []
      let cur = unwrap(n.expression)
      while (ts.isPropertyAccessExpression(cur)) {
        parts.unshift(cur.name.text)
        cur = unwrap(cur.expression)
      }
      if (parts.length >= 2 && isClientRoot(cur, scopes)) {
        const key = parts.join(".")
        if (sdkKeys.has(key)) out.add(key)
      }
    }
    n.forEachChild(visit)
  }
  visit(node)
  return [...out]
}

function localsOf(fn: ts.Node): Locals {
  const out: Locals = new Map()
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) out.set(n.name.text, n.initializer)
    if (n !== fn && ts.isFunctionLike(n)) return
    n.forEachChild(visit)
  }
  fn.forEachChild(visit)
  return out
}

interface AstAction {
  file: string
  line: number
  parent?: string
  leaf: string
  sdk: string[]
}

/**
 * Every `.action(fn)` of a command file with the command it belongs to and the
 * SDK methods it calls. `defaultParent`: the command an action belongs to when
 * its receiver names none (a sibling module's registration function, handed
 * the group's command as a parameter).
 */
export function astActions(file: string, text: string, rel: string, sdkKeys: ReadonlySet<string>, defaultParent?: string): AstAction[] {
  const sf = parseText(file, text)
  const helpers = new Map<string, ts.Node>()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) helpers.set(st.name.text, st)
  }
  const out: AstAction[] = []
  const visit = (n: ts.Node, scopes: Locals[]): void => {
    const inner = ts.isFunctionLike(n) ? [localsOf(n), ...scopes] : scopes
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression)
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "action" && n.arguments[0]) {
        const target = actionTarget(callee.expression, inner)
        if (target) {
          const fn = n.arguments[0]
          const fnScopes = [localsOf(fn), ...inner]
          const sdk = new Set(sdkCalls(fn, fnScopes, sdkKeys))
          // Same-file helpers the action calls, one hop (pickAppInteractively(client)).
          const visitCalls = (m: ts.Node): void => {
            if (ts.isCallExpression(m) && ts.isIdentifier(m.expression) && helpers.has(m.expression.text)) {
              const h = helpers.get(m.expression.text)!
              for (const k of sdkCalls(h, [localsOf(h)], sdkKeys)) sdk.add(k)
            }
            m.forEachChild(visitCalls)
          }
          visitCalls(fn)
          out.push({ file: rel, line: lineOf(sf, n.arguments[0]), parent: target.parent ?? defaultParent, leaf: target.leaf, sdk: [...sdk] })
        }
      }
    }
    n.forEachChild((c) => visit(c, inner))
  }
  visit(sf, [])
  return out
}

/** The sibling command modules a group file imports (`./edit-use-case.js` → its repo-relative `.ts` path). */
function siblingModules(repoRoot: string, rel: string): string[] {
  const sf = parseText(rel, readFileSync(join(repoRoot, rel), "utf8"))
  const dir = rel.slice(0, rel.lastIndexOf("/"))
  const out: string[] = []
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.importClause?.isTypeOnly) continue
    const from = (st.moduleSpecifier as ts.StringLiteral).text
    if (from.startsWith("./")) out.push(`${dir}/${from.slice(2).replace(/\.js$/, ".ts")}`)
  }
  return out
}

export async function extractCli(repoRoot: string, sdkKeys: ReadonlySet<string>): Promise<CliInventory> {
  const { leaves, groups, files } = await runtimeTree(repoRoot)
  const actions: AstAction[] = []
  const groupFiles = new Set(files.values())
  for (const rel of groupFiles) {
    const file = join(repoRoot, rel)
    actions.push(...astActions(file, readFileSync(file, "utf8"), rel, sdkKeys))
  }
  // A group file's sibling modules: their actions belong to the group when their receiver names none.
  const siblingsOf = new Map<string, Set<string>>()
  for (const [group, rel] of files) {
    const siblings = siblingModules(repoRoot, rel).filter((s) => !groupFiles.has(s))
    siblingsOf.set(rel, new Set(siblings))
    for (const s of siblings) actions.push(...astActions(join(repoRoot, s), readFileSync(join(repoRoot, s), "utf8"), s, sdkKeys, group))
  }
  const commands: CliCommand[] = leaves.map((p) => {
    const leaf = p[p.length - 1]!
    const parent = p[p.length - 2]
    const groupFile = files.get(p[0]!)
    const candidates = actions.filter((a) => a.leaf === leaf && a.parent === parent)
    const pick = candidates.find((a) => a.file === groupFile)
      ?? candidates.find((a) => groupFile !== undefined && siblingsOf.get(groupFile)?.has(a.file))
      ?? (candidates.length === 1 ? candidates[0] : undefined)
    return { path: p.join(" "), ref: pick ? `${pick.file}:${pick.line}` : undefined, sdk: pick?.sdk ?? [] }
  })
  return { commands, groups }
}
