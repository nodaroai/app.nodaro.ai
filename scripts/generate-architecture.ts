/**
 * generate-architecture.ts
 *
 * Scans the SceneNode.ai project and generates ARCHITECTURE.md
 * Run with: npx tsx scripts/generate-architecture.ts
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(relPath: string): string {
  const abs = path.join(ROOT, relPath)
  if (!fs.existsSync(abs)) return ""
  return fs.readFileSync(abs, "utf-8")
}

function listDir(relPath: string): string[] {
  const abs = path.join(ROOT, relPath)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs)
}

function walkDir(
  relPath: string,
  depth: number,
  skip: ReadonlySet<string>,
  prefix = "",
): string[] {
  const abs = path.join(ROOT, relPath)
  if (!fs.existsSync(abs)) return []
  const entries = fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => !skip.has(e.name))
    .sort((a, b) => {
      // dirs first, then files
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

  const lines: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const isLast = i === entries.length - 1
    const connector = isLast ? "`-- " : "|-- "
    const childPrefix = isLast ? "    " : "|   "
    const suffix = entry.isDirectory() ? "/" : ""
    lines.push(`${prefix}${connector}${entry.name}${suffix}`)
    if (entry.isDirectory() && depth > 1) {
      const childRel = path.posix.join(relPath, entry.name)
      lines.push(...walkDir(childRel, depth - 1, skip, `${prefix}${childPrefix}`))
    }
  }
  return lines
}

function globFiles(dir: string, ext: string): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.posix.join(dir, f))
}

function globRecursive(dir: string, ext: string): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const results: string[] = []
  function walk(d: string) {
    const entries = fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
    for (const e of entries) {
      const rel = path.posix.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === "dist" || e.name === ".git") continue
        walk(rel)
      } else if (e.name.endsWith(ext)) {
        results.push(rel)
      }
    }
  }
  walk(dir)
  return results
}

function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim()
  } catch {
    return "unknown"
  }
}

// ---------------------------------------------------------------------------
// Section 1: Project Structure
// ---------------------------------------------------------------------------

function buildProjectStructure(): string {
  const skip = new Set([
    "node_modules",
    ".next",
    "dist",
    ".git",
    ".turbo",
    ".vercel",
    "pnpm-lock.yaml",
    ".env",
    ".env.local",
  ])

  const lines: string[] = []
  const topEntries = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => !skip.has(e.name) && !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

  for (let i = 0; i < topEntries.length; i++) {
    const entry = topEntries[i]
    const isLast = i === topEntries.length - 1
    const connector = isLast ? "`-- " : "|-- "
    const childPrefix = isLast ? "    " : "|   "
    const suffix = entry.isDirectory() ? "/" : ""
    lines.push(`${connector}${entry.name}${suffix}`)

    if (entry.isDirectory()) {
      // 2 levels deep for frontend/src and backend/src, 1 level for others
      const deepDirs = ["frontend", "backend"]
      if (deepDirs.includes(entry.name)) {
        const srcPath = path.posix.join(entry.name, "src")
        const srcAbs = path.join(ROOT, srcPath)
        // Show top-level of the directory first
        const topLevel = fs
          .readdirSync(path.join(ROOT, entry.name), { withFileTypes: true })
          .filter((e) => !skip.has(e.name))
          .sort((a, b) => {
            if (a.isDirectory() && !b.isDirectory()) return -1
            if (!a.isDirectory() && b.isDirectory()) return 1
            return a.name.localeCompare(b.name)
          })

        for (let j = 0; j < topLevel.length; j++) {
          const child = topLevel[j]
          const isLastChild = j === topLevel.length - 1
          const conn2 = isLastChild ? "`-- " : "|-- "
          const pref2 = isLastChild ? "    " : "|   "
          const suf2 = child.isDirectory() ? "/" : ""
          lines.push(`${childPrefix}${conn2}${child.name}${suf2}`)

          if (child.name === "src" && child.isDirectory() && fs.existsSync(srcAbs)) {
            // 1 more level inside src/
            const srcChildren = fs
              .readdirSync(srcAbs, { withFileTypes: true })
              .filter((e) => !skip.has(e.name))
              .sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1
                if (!a.isDirectory() && b.isDirectory()) return 1
                return a.name.localeCompare(b.name)
              })

            for (let k = 0; k < srcChildren.length; k++) {
              const sc = srcChildren[k]
              const isLastSc = k === srcChildren.length - 1
              const conn3 = isLastSc ? "`-- " : "|-- "
              const suf3 = sc.isDirectory() ? "/" : ""
              lines.push(`${childPrefix}${pref2}${conn3}${sc.name}${suf3}`)
            }
          }
        }
      } else {
        lines.push(...walkDir(entry.name, 1, skip, childPrefix))
      }
    }
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// Section 2: API Routes
// ---------------------------------------------------------------------------

interface RouteEntry {
  readonly method: string
  readonly path: string
  readonly file: string
}

function extractRoutes(): readonly RouteEntry[] {
  const routeFiles = globFiles("backend/src/routes", ".ts")
  const routes: RouteEntry[] = []

  // Match: app.get("/...", ...), app.post("/...", ...), etc.
  // Also handles multiline with { preHandler: ... }
  const methodRegex = /app\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/g

  for (const file of routeFiles) {
    const content = readFile(file)
    let match: RegExpExecArray | null
    while ((match = methodRegex.exec(content)) !== null) {
      routes.push({
        method: match[1].toUpperCase(),
        path: match[2],
        file,
      })
    }
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  return routes
}

// ---------------------------------------------------------------------------
// Section 3: Database Tables
// ---------------------------------------------------------------------------

interface TableInfo {
  readonly name: string
  readonly columns: readonly string[]
  readonly file: string
}

function extractTables(): readonly TableInfo[] {
  const sqlFiles = [
    ...globFiles("supabase/migrations", ".sql"),
    ...globFiles("backend/src/scripts", ".sql"),
    ...globFiles("backend/migrations", ".sql"),
  ]

  const tables: TableInfo[] = []
  const createTableRegex = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\);/gi

  for (const file of sqlFiles) {
    const content = readFile(file)
    let match: RegExpExecArray | null
    while ((match = createTableRegex.exec(content)) !== null) {
      const tableName = match[1]
      const body = match[2]
      // Extract column names (first word of each line that isn't a constraint keyword)
      const columns = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const firstWord = line.split(/\s+/)[0].replace(",", "")
          return firstWord
        })
        .filter(
          (col) =>
            col.length > 0 &&
            !["PRIMARY", "UNIQUE", "CHECK", "CONSTRAINT", "FOREIGN", "REFERENCES", "--", ")", "("].includes(
              col.toUpperCase(),
            ) &&
            !col.startsWith("--"),
        )

      tables.push({ name: tableName, columns, file })
    }
  }

  // Deduplicate by table name (keep first occurrence)
  const seen = new Set<string>()
  return tables.filter((t) => {
    if (seen.has(t.name)) return false
    seen.add(t.name)
    return true
  })
}

// ---------------------------------------------------------------------------
// Section 4: Node Types
// ---------------------------------------------------------------------------

interface NodeTypeDef {
  readonly type: string
  readonly label: string
  readonly category: string
  readonly creditCost: number
  readonly componentFile: string
}

function extractNodeTypes(): readonly NodeTypeDef[] {
  const content = readFile("frontend/src/types/nodes.ts")
  const nodeComponents = listDir("frontend/src/components/nodes")
    .filter((f) => f.endsWith("-node.tsx"))
    .map((f) => f.replace("-node.tsx", ""))

  const defs: NodeTypeDef[] = []

  // Match each definition block between { type: "..." ... }
  const blockRegex =
    /\{\s*type:\s*"([^"]+)",\s*label:\s*"([^"]+)",\s*category:\s*"([^"]+)",\s*creditCost:\s*(\d+)/g
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(content)) !== null) {
    const type = match[1]
    const label = match[2]
    const category = match[3]
    const creditCost = parseInt(match[4], 10)

    // Find matching component file
    const kebab = type // type is already kebab-case
    const hasComponent = nodeComponents.includes(kebab)
    const componentFile = hasComponent
      ? `frontend/src/components/nodes/${kebab}-node.tsx`
      : ""

    defs.push({ type, label, category, creditCost, componentFile })
  }

  return defs
}

// ---------------------------------------------------------------------------
// Section 5: AI Providers
// ---------------------------------------------------------------------------

interface ProviderInfo {
  readonly folder: string
  readonly files: readonly string[]
  readonly exports: readonly string[]
}

function extractProviders(): readonly ProviderInfo[] {
  const providerBase = "backend/src/providers"
  const topFiles = listDir(providerBase).filter((f) => f.endsWith(".ts"))
  const subDirs = listDir(providerBase).filter((f) => {
    const abs = path.join(ROOT, providerBase, f)
    return fs.statSync(abs).isDirectory()
  })

  const providers: ProviderInfo[] = []

  // Top-level provider files
  if (topFiles.length > 0) {
    const exports: string[] = []
    for (const file of topFiles) {
      const content = readFile(path.posix.join(providerBase, file))
      const exportRegex = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g
      let m: RegExpExecArray | null
      while ((m = exportRegex.exec(content)) !== null) {
        exports.push(m[1])
      }
    }
    providers.push({
      folder: providerBase,
      files: topFiles,
      exports,
    })
  }

  // Sub-directories
  for (const dir of subDirs) {
    const dirPath = path.posix.join(providerBase, dir)
    const files = listDir(dirPath).filter((f) => f.endsWith(".ts"))
    const exports: string[] = []
    for (const file of files) {
      const content = readFile(path.posix.join(dirPath, file))
      const exportRegex = /export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g
      let m: RegExpExecArray | null
      while ((m = exportRegex.exec(content)) !== null) {
        exports.push(m[1])
      }
    }
    providers.push({ folder: dirPath, files, exports })
  }

  return providers
}

// ---------------------------------------------------------------------------
// Section 6: Import Graph (Key Files)
// ---------------------------------------------------------------------------

interface ImportEntry {
  readonly file: string
  readonly imports: readonly string[]
}

function extractImports(relPath: string): readonly string[] {
  const content = readFile(relPath)
  const importRegex = /(?:import|from)\s+["']([^"']+)["']/g
  const imports: string[] = []
  let match: RegExpExecArray | null
  while ((match = importRegex.exec(content)) !== null) {
    const specifier = match[1]
    // Only project-local imports (relative or alias)
    if (specifier.startsWith(".") || specifier.startsWith("@/") || specifier.startsWith("../")) {
      imports.push(specifier)
    }
  }
  // Deduplicate
  return [...new Set(imports)]
}

function buildImportGraph(): readonly ImportEntry[] {
  const keyFiles = [
    "frontend/src/components/editor/workflow-editor.tsx",
    "frontend/src/hooks/use-workflow-store.ts",
    "backend/src/app.ts",
    "backend/src/worker.ts",
  ]

  return keyFiles
    .filter((f) => fs.existsSync(path.join(ROOT, f)))
    .map((file) => ({
      file,
      imports: extractImports(file),
    }))
}

// ---------------------------------------------------------------------------
// Section 7: Edition Gating
// ---------------------------------------------------------------------------

interface EditionUsage {
  readonly fn: string
  readonly file: string
  readonly line: number
}

function extractEditionGating(): readonly EditionUsage[] {
  const fns = ["hasCredits", "hasAdmin", "isCommunity", "isBusiness", "isCloud"]
  const fnPattern = new RegExp(`\\b(${fns.join("|")})\\(\\)`, "g")

  const tsFiles = [
    ...globRecursive("frontend/src", ".ts"),
    ...globRecursive("frontend/src", ".tsx"),
    ...globRecursive("backend/src", ".ts"),
  ]

  const usages: EditionUsage[] = []

  for (const file of tsFiles) {
    // Skip definition files (where the functions are declared)
    if (file.includes("edition.ts") || file.includes("config.ts")) continue

    const content = readFile(file)
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      let match: RegExpExecArray | null
      while ((match = fnPattern.exec(lines[i])) !== null) {
        usages.push({ fn: match[1], file, line: i + 1 })
      }
    }
  }

  usages.sort((a, b) => a.fn.localeCompare(b.fn) || a.file.localeCompare(b.file))
  return usages
}

// ---------------------------------------------------------------------------
// Assemble Output
// ---------------------------------------------------------------------------

function generate(): string {
  const gitHash = getGitHash()
  const timestamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")

  const out: string[] = []

  out.push("# SceneNode.ai -- Architecture Reference")
  out.push("")
  out.push(`> Auto-generated on ${timestamp} at commit \`${gitHash}\``)
  out.push("> Run `npx tsx scripts/generate-architecture.ts` to regenerate.")
  out.push("")
  out.push("---")
  out.push("")

  // Section 1
  out.push("## 1. Project Structure")
  out.push("")
  out.push("```")
  out.push(buildProjectStructure())
  out.push("```")
  out.push("")

  // Section 2
  out.push("## 2. API Routes")
  out.push("")
  const routes = extractRoutes()
  out.push(`${routes.length} routes across ${new Set(routes.map((r) => r.file)).size} files.`)
  out.push("")
  out.push("| Method | Path | File |")
  out.push("|--------|------|------|")
  for (const r of routes) {
    out.push(`| ${r.method} | \`${r.path}\` | \`${r.file}\` |`)
  }
  out.push("")

  // Section 3
  out.push("## 3. Database Tables")
  out.push("")
  const tables = extractTables()
  out.push(`${tables.length} tables found across migration files.`)
  out.push("")
  for (const t of tables) {
    out.push(`### \`${t.name}\``)
    out.push("")
    out.push(`Source: \`${t.file}\``)
    out.push("")
    out.push("Columns: " + t.columns.map((c) => `\`${c}\``).join(", "))
    out.push("")
  }

  // Section 4
  out.push("## 4. Node Types")
  out.push("")
  const nodeTypes = extractNodeTypes()
  out.push(`${nodeTypes.length} node types defined in \`frontend/src/types/nodes.ts\`.`)
  out.push("")
  out.push("| Type | Label | Category | Credits | Component |")
  out.push("|------|-------|----------|---------|-----------|")
  for (const n of nodeTypes) {
    const comp = n.componentFile ? `\`${n.componentFile}\`` : "(none)"
    out.push(`| \`${n.type}\` | ${n.label} | ${n.category} | ${n.creditCost} | ${comp} |`)
  }
  out.push("")

  // Section 5
  out.push("## 5. AI Providers")
  out.push("")
  const providers = extractProviders()
  for (const p of providers) {
    out.push(`### \`${p.folder}/\``)
    out.push("")
    out.push("Files: " + p.files.map((f) => `\`${f}\``).join(", "))
    out.push("")
    if (p.exports.length > 0) {
      out.push("Exports: " + p.exports.map((e) => `\`${e}\``).join(", "))
    } else {
      out.push("Exports: (re-exports only)")
    }
    out.push("")
  }

  // Section 6
  out.push("## 6. Import Graph (Key Files)")
  out.push("")
  const importGraph = buildImportGraph()
  for (const entry of importGraph) {
    out.push(`### \`${entry.file}\``)
    out.push("")
    if (entry.imports.length === 0) {
      out.push("No project-local imports.")
    } else {
      for (const imp of entry.imports) {
        out.push(`- \`${imp}\``)
      }
    }
    out.push("")
  }

  // Section 7
  out.push("## 7. Edition Gating")
  out.push("")
  const gating = extractEditionGating()
  out.push(`${gating.length} edition-gated call sites found (excluding definition files).`)
  out.push("")
  if (gating.length > 0) {
    out.push("| Function | File | Line |")
    out.push("|----------|------|------|")
    for (const g of gating) {
      out.push(`| \`${g.fn}()\` | \`${g.file}\` | ${g.line} |`)
    }
    out.push("")
  }

  return out.join("\n")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const output = generate()
const outPath = path.join(ROOT, "ARCHITECTURE.md")
fs.writeFileSync(outPath, output, "utf-8")

const lineCount = output.split("\n").length
console.log(`Wrote ARCHITECTURE.md (${lineCount} lines, ${Math.round(output.length / 1024)}KB)`)
