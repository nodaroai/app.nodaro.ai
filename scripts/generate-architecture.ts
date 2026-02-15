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

function buildProjectStructure(hideSrcDirs: ReadonlySet<string> = new Set()): string {
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
              .filter((e) => !(entry.name === "backend" && hideSrcDirs.has(e.name)))
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
// Interactive Architecture Graph (HTML + D3.js)
// ---------------------------------------------------------------------------

function resolveImportPath(importingFile: string, specifier: string): string | null {
  let basePath: string

  if (specifier.startsWith("@/")) {
    basePath = path.posix.join("frontend/src", specifier.slice(2))
  } else if (specifier.startsWith(".")) {
    const dir = path.posix.dirname(importingFile)
    basePath = path.posix.join(dir, specifier)
  } else {
    return null
  }

  // Strip .js extension (ESM TypeScript convention in backend)
  if (basePath.endsWith(".js")) {
    basePath = basePath.slice(0, -3)
  }

  const candidates = [
    basePath,
    basePath + ".ts",
    basePath + ".tsx",
    path.posix.join(basePath, "index.ts"),
    path.posix.join(basePath, "index.tsx"),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(ROOT, candidate))) {
      return candidate
    }
  }

  return null
}

function getDirectoryGroup(filePath: string): string {
  if (filePath.includes("/routes/")) return "routes"
  if (filePath.includes("/providers/")) return "providers"
  if (filePath.includes("/components/")) return "components"
  if (filePath.includes("/hooks/")) return "hooks"
  if (filePath.includes("/billing/")) return "billing"
  if (filePath.includes("/lib/")) return "lib"
  if (filePath.includes("/middleware/")) return "middleware"
  return "other"
}

interface FullGraphData {
  readonly nodes: { id: string; name: string; group: string }[]
  readonly edges: { source: string; target: string }[]
}

function buildFullImportGraph(): FullGraphData {
  const allFiles = [
    ...globRecursive("frontend/src", ".ts"),
    ...globRecursive("frontend/src", ".tsx"),
    ...globRecursive("backend/src", ".ts"),
  ]

  const fileSet = new Set(allFiles)
  const nodesMap = new Map<string, { id: string; name: string; group: string }>()
  const edges: { source: string; target: string }[] = []
  const edgeSet = new Set<string>()

  const importRe = /(?:import|from)\s+["']([^"']+)["']/g

  for (const file of allFiles) {
    const content = readFile(file)
    let match: RegExpExecArray | null

    while ((match = importRe.exec(content)) !== null) {
      const specifier = match[1]
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue

      const resolved = resolveImportPath(file, specifier)
      if (!resolved || !fileSet.has(resolved)) continue

      const edgeKey = `${file}|${resolved}`
      if (edgeSet.has(edgeKey)) continue
      edgeSet.add(edgeKey)

      edges.push({ source: file, target: resolved })

      if (!nodesMap.has(file)) {
        nodesMap.set(file, { id: file, name: path.basename(file), group: getDirectoryGroup(file) })
      }
      if (!nodesMap.has(resolved)) {
        nodesMap.set(resolved, { id: resolved, name: path.basename(resolved), group: getDirectoryGroup(resolved) })
      }
    }
  }

  return { nodes: Array.from(nodesMap.values()), edges }
}

const GRAPH_EXCLUDE_KEYWORDS = ["billing", "admin", "paddle", "gallery-reports"]

function filterGraphForPublic(data: FullGraphData): FullGraphData {
  const excludedIds = new Set(
    data.nodes
      .filter((n) => GRAPH_EXCLUDE_KEYWORDS.some((kw) => n.id.includes(kw)))
      .map((n) => n.id),
  )
  return {
    nodes: data.nodes.filter((n) => !excludedIds.has(n.id)),
    edges: data.edges.filter((e) => !excludedIds.has(e.source) && !excludedIds.has(e.target)),
  }
}

interface GraphHTMLOptions {
  readonly showBilling?: boolean
}

function generateGraphHTML(graphData: FullGraphData, options: GraphHTMLOptions = {}): string {
  const { showBilling = true } = options
  const dataJson = JSON.stringify(graphData)

  const billingLegendItem = showBilling
    ? '\n  <div class="legend-item"><div class="legend-dot" style="background:#f87171"></div> billing</div>'
    : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SceneNode.ai - Architecture Graph</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"><\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a1a1a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
  h1 { position: fixed; top: 12px; left: 20px; z-index: 10; font-size: 18px; font-weight: 600; opacity: 0.85; }
  h1 span { color: #ff0073; }
  svg { width: 100vw; height: 100vh; display: block; }
  .tooltip {
    position: fixed; background: #333; color: #eee; padding: 5px 10px; border-radius: 4px;
    font-size: 11px; font-family: monospace; pointer-events: none; z-index: 100;
    white-space: nowrap; border: 1px solid #555;
  }
  .legend {
    position: fixed; bottom: 16px; right: 16px; z-index: 10;
    background: rgba(30,30,30,0.92); border: 1px solid #333; border-radius: 8px;
    padding: 12px 16px; font-size: 11px;
  }
  .legend-title { font-weight: 600; margin-bottom: 6px; font-size: 12px; opacity: 0.7; }
  .legend-item { display: flex; align-items: center; gap: 8px; margin: 3px 0; }
  .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .stats { position: fixed; top: 12px; right: 20px; z-index: 10; font-size: 12px; opacity: 0.45; }
</style>
</head>
<body>
<h1>SceneNode.ai &mdash; <span>Architecture Graph</span></h1>
<div class="stats" id="stats"></div>
<div class="legend">
  <div class="legend-title">Directory Groups</div>
  <div class="legend-item"><div class="legend-dot" style="background:#4a9eff"></div> routes</div>
  <div class="legend-item"><div class="legend-dot" style="background:#4ade80"></div> providers</div>
  <div class="legend-item"><div class="legend-dot" style="background:#a78bfa"></div> components</div>
  <div class="legend-item"><div class="legend-dot" style="background:#fb923c"></div> hooks</div>${billingLegendItem}
  <div class="legend-item"><div class="legend-dot" style="background:#22d3ee"></div> lib</div>
  <div class="legend-item"><div class="legend-dot" style="background:#facc15"></div> middleware</div>
  <div class="legend-item"><div class="legend-dot" style="background:#94a3b8"></div> other</div>
</div>
<svg></svg>
<script>
const data = ${dataJson};

document.getElementById("stats").textContent = data.nodes.length + " files \\u00b7 " + data.edges.length + " imports";

const colors = {
  routes: "#4a9eff", providers: "#4ade80", components: "#a78bfa", hooks: "#fb923c",
  billing: "#f87171", lib: "#22d3ee", middleware: "#facc15", other: "#94a3b8"
};

const width = window.innerWidth;
const height = window.innerHeight;
const svg = d3.select("svg").attr("width", width).attr("height", height);
const g = svg.append("g");

svg.call(d3.zoom().scaleExtent([0.05, 10]).on("zoom", (e) => g.attr("transform", e.transform)));

// Incoming edge count drives node radius
const incoming = {};
data.edges.forEach(e => { incoming[e.target] = (incoming[e.target] || 0) + 1; });
const maxIn = Math.max(1, ...Object.values(incoming));
data.nodes.forEach(n => { n.radius = 4 + 14 * Math.sqrt((incoming[n.id] || 0) / maxIn); });

const simulation = d3.forceSimulation(data.nodes)
  .force("link", d3.forceLink(data.edges).id(d => d.id).distance(60).strength(0.3))
  .force("charge", d3.forceManyBody().strength(-80))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("collide", d3.forceCollide(d => d.radius + 3));

const link = g.append("g").selectAll("line").data(data.edges).join("line")
  .attr("stroke", "#555").attr("stroke-opacity", 0.25).attr("stroke-width", 0.8);

const node = g.append("g").selectAll("circle").data(data.nodes).join("circle")
  .attr("r", d => d.radius)
  .attr("fill", d => colors[d.group] || colors.other)
  .attr("stroke", "#fff").attr("stroke-width", 0.5).attr("cursor", "pointer")
  .call(d3.drag()
    .on("start", (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on("end", (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
  );

const label = g.append("g").selectAll("text").data(data.nodes).join("text")
  .text(d => d.name).attr("font-size", 8).attr("fill", "#ccc")
  .attr("pointer-events", "none").attr("dx", d => d.radius + 3).attr("dy", 3);

// Tooltip
const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("display", "none");
node.on("mouseover", (e, d) => {
  tooltip.style("display", "block").text(d.id)
    .style("left", (e.clientX + 14) + "px").style("top", (e.clientY - 8) + "px");
}).on("mousemove", (e) => {
  tooltip.style("left", (e.clientX + 14) + "px").style("top", (e.clientY - 8) + "px");
}).on("mouseout", () => tooltip.style("display", "none"));

// Click to highlight node + direct connections
let selected = null;
function resetHighlight() {
  node.attr("opacity", 1);
  link.attr("stroke-opacity", 0.25).attr("stroke", "#555");
  label.attr("opacity", 1);
}

node.on("click", (e, d) => {
  e.stopPropagation();
  if (selected === d.id) { selected = null; resetHighlight(); return; }
  selected = d.id;
  const connected = new Set([d.id]);
  data.edges.forEach(edge => {
    const s = typeof edge.source === "object" ? edge.source.id : edge.source;
    const t = typeof edge.target === "object" ? edge.target.id : edge.target;
    if (s === d.id) connected.add(t);
    if (t === d.id) connected.add(s);
  });
  node.attr("opacity", n => connected.has(n.id) ? 1 : 0.08);
  link.attr("stroke-opacity", edge => {
    const s = typeof edge.source === "object" ? edge.source.id : edge.source;
    const t = typeof edge.target === "object" ? edge.target.id : edge.target;
    return (s === d.id || t === d.id) ? 0.9 : 0.02;
  }).attr("stroke", edge => {
    const s = typeof edge.source === "object" ? edge.source.id : edge.source;
    const t = typeof edge.target === "object" ? edge.target.id : edge.target;
    return (s === d.id || t === d.id) ? "#ff0073" : "#555";
  });
  label.attr("opacity", n => connected.has(n.id) ? 1 : 0.04);
});

svg.on("click", () => { selected = null; resetHighlight(); });

simulation.on("tick", () => {
  link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
  node.attr("cx", d => d.x).attr("cy", d => d.y);
  label.attr("x", d => d.x).attr("y", d => d.y);
});
<\/script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Assemble Output
// ---------------------------------------------------------------------------

function generate(edition: "full" | "public" = "full"): string {
  const isPublic = edition === "public"
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
  out.push(buildProjectStructure(isPublic ? new Set(["billing"]) : new Set()))
  out.push("```")
  out.push("")

  // Section 2
  out.push("## 2. API Routes")
  out.push("")
  const allRoutes = extractRoutes()
  const routes = isPublic
    ? allRoutes.filter((r) =>
        !r.path.startsWith("/v1/admin") &&
        !r.path.startsWith("/v1/billing") &&
        !r.path.toLowerCase().includes("paddle"),
      )
    : allRoutes
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
  const allTables = extractTables()
  const EXCLUDED_TABLES_PUBLIC = new Set([
    "subscriptions", "transactions", "paddle_customers",
    "credit_purchases", "app_settings", "gallery_reports",
  ])
  const tables = isPublic
    ? allTables.filter((t) => !EXCLUDED_TABLES_PUBLIC.has(t.name))
    : allTables
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
  const IMPORT_FILTER_KEYWORDS = ["billing", "admin", "paddle", "gallery-reports"]
  for (const entry of importGraph) {
    out.push(`### \`${entry.file}\``)
    out.push("")
    const filteredImports = isPublic && entry.file === "backend/src/app.ts"
      ? entry.imports.filter((imp) => !IMPORT_FILTER_KEYWORDS.some((kw) => imp.includes(kw)))
      : entry.imports
    if (filteredImports.length === 0) {
      out.push("No project-local imports.")
    } else {
      for (const imp of filteredImports) {
        out.push(`- \`${imp}\``)
      }
    }
    out.push("")
  }

  // Section 7 (full edition only)
  if (!isPublic) {
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
  }

  return out.join("\n")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Full internal version
const output = generate("full")
const outPath = path.join(ROOT, "ARCHITECTURE.md")
fs.writeFileSync(outPath, output, "utf-8")
const lineCount = output.split("\n").length
console.log(`Wrote ARCHITECTURE.md (${lineCount} lines, ${Math.round(output.length / 1024)}KB)`)

// Public community edition (filtered)
const publicOutput = generate("public")
const publicPath = path.join(ROOT, "ARCHITECTURE.public.md")
fs.writeFileSync(publicPath, publicOutput, "utf-8")
const publicLineCount = publicOutput.split("\n").length
console.log(`Wrote ARCHITECTURE.public.md (${publicLineCount} lines, ${Math.round(publicOutput.length / 1024)}KB)`)

// Interactive architecture graph (full)
const graphData = buildFullImportGraph()
const graphHTML = generateGraphHTML(graphData)
const graphPath = path.join(ROOT, "architecture-graph.html")
fs.writeFileSync(graphPath, graphHTML, "utf-8")
console.log(`Wrote architecture-graph.html (${graphData.nodes.length} nodes, ${graphData.edges.length} edges, ${Math.round(graphHTML.length / 1024)}KB)`)

// Interactive architecture graph (public, filtered)
const publicGraphData = filterGraphForPublic(graphData)
const publicGraphHTML = generateGraphHTML(publicGraphData, { showBilling: false })
const publicGraphPath = path.join(ROOT, "architecture-graph.public.html")
fs.writeFileSync(publicGraphPath, publicGraphHTML, "utf-8")
console.log(`Wrote architecture-graph.public.html (${publicGraphData.nodes.length} nodes, ${publicGraphData.edges.length} edges, ${Math.round(publicGraphHTML.length / 1024)}KB)`)
