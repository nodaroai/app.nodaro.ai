"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Search, Folder, GitBranch, X, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase"

interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
}

interface Workflow {
  id: string
  name: string
  project_id: string
  project_name?: string
  created_at: string
}

interface SearchModalProps {
  readonly open: boolean
  readonly onClose: () => void
}

export function SearchModal({ open, onClose }: SearchModalProps) {
  const [query, setQuery] = useState("")
  const [projects, setProjects] = useState<Project[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch projects and workflows
  const fetchResults = useCallback(async (searchQuery: string) => {
    setLoading(true)
    try {
      const supabase = createClient()

      // Fetch projects
      let projectsQuery = supabase
        .from("projects")
        .select("id, name, description, created_at")
        .order("updated_at", { ascending: false })
        .limit(10)

      if (searchQuery) {
        projectsQuery = projectsQuery.ilike("name", `%${searchQuery}%`)
      }

      const { data: projectsData } = await projectsQuery
      setProjects(projectsData || [])

      // Fetch workflows with project names
      let workflowsQuery = supabase
        .from("workflows")
        .select("id, name, project_id, created_at, projects(name)")
        .order("updated_at", { ascending: false })
        .limit(10)

      if (searchQuery) {
        workflowsQuery = workflowsQuery.ilike("name", `%${searchQuery}%`)
      }

      const { data: workflowsData } = await workflowsQuery
      setWorkflows(
        (workflowsData || []).map((w: any) => ({
          ...w,
          project_name: w.projects?.name,
        }))
      )
    } catch (error) {
      console.error("Error fetching search results:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch and debounced search
  useEffect(() => {
    if (!open) return

    const timer = setTimeout(() => {
      fetchResults(query)
    }, query ? 300 : 0)

    return () => clearTimeout(timer)
  }, [open, query, fetchResults])

  // Focus input when modal opens
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
      setQuery("")
      setSelectedIndex(0)
    }
  }, [open])

  // Handle click outside
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open, onClose])

  // Calculate all results for keyboard navigation
  const allResults = [
    ...projects.map((p) => ({ type: "project" as const, item: p })),
    ...workflows.map((w) => ({ type: "workflow" as const, item: w })),
  ]

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1))
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
        return
      }

      if (e.key === "Enter" && allResults[selectedIndex]) {
        e.preventDefault()
        const result = allResults[selectedIndex]
        if (result.type === "project") {
          window.open(`/projects/${result.item.id}`, "_blank")
        } else {
          window.open(
            `/projects/${result.item.project_id}/workflows/${result.item.id}`,
            "_blank"
          )
        }
        onClose()
      }
    },
    [allResults, selectedIndex, onClose]
  )

  const handleResultClick = (type: "project" | "workflow", item: Project | Workflow) => {
    if (type === "project") {
      window.open(`/projects/${item.id}`, "_blank")
    } else {
      const workflow = item as Workflow
      window.open(
        `/projects/${workflow.project_id}/workflows/${workflow.id}`,
        "_blank"
      )
    }
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Modal */}
      <div
        ref={containerRef}
        className={cn(
          "relative w-full max-w-xl",
          "bg-white dark:bg-[#1E1E1E]",
          "border border-[#E2E8F0] dark:border-[#2D2D2D]",
          "rounded-xl shadow-2xl",
          "overflow-hidden",
          "animate-in fade-in-0 zoom-in-95 duration-150"
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E2E8F0] dark:border-[#2D2D2D]">
          <Search className="w-5 h-5 text-[#94A3B8]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            placeholder="Search projects and workflows..."
            className={cn(
              "flex-1 bg-transparent border-none outline-none",
              "text-[#1E293B] dark:text-white",
              "placeholder:text-[#94A3B8]",
              "text-base"
            )}
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#F1F5F9] dark:hover:bg-[#2D2D2D] transition-colors"
          >
            <X className="w-4 h-4 text-[#64748B]" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="px-4 py-8 text-center text-[#94A3B8]">
              Searching...
            </div>
          ) : allResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-[#94A3B8]">
              {query ? "No results found" : "Start typing to search..."}
            </div>
          ) : (
            <>
              {/* Projects Section */}
              {projects.length > 0 && (
                <div className="py-2">
                  <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                    Projects
                  </div>
                  {projects.map((project, idx) => {
                    const globalIndex = idx
                    return (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => handleResultClick("project", project)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2.5 text-left",
                          "transition-colors",
                          globalIndex === selectedIndex
                            ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                            : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]"
                        )}
                      >
                        <Folder className="w-4 h-4 text-[#3B82F6]" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#1E293B] dark:text-white truncate">
                            {project.name}
                          </div>
                          {project.description && (
                            <div className="text-xs text-[#94A3B8] truncate">
                              {project.description}
                            </div>
                          )}
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-[#94A3B8] opacity-0 group-hover:opacity-100" />
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Workflows Section */}
              {workflows.length > 0 && (
                <div className="py-2 border-t border-[#E2E8F0] dark:border-[#2D2D2D]">
                  <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                    Workflows
                  </div>
                  {workflows.map((workflow, idx) => {
                    const globalIndex = projects.length + idx
                    return (
                      <button
                        key={workflow.id}
                        type="button"
                        onClick={() => handleResultClick("workflow", workflow)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2.5 text-left",
                          "transition-colors",
                          globalIndex === selectedIndex
                            ? "bg-[#F1F5F9] dark:bg-[#2D2D2D]"
                            : "hover:bg-[#F8FAFC] dark:hover:bg-[#252525]"
                        )}
                      >
                        <GitBranch className="w-4 h-4 text-[#ff0073]" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#1E293B] dark:text-white truncate">
                            {workflow.name}
                          </div>
                          {workflow.project_name && (
                            <div className="text-xs text-[#94A3B8] truncate">
                              in {workflow.project_name}
                            </div>
                          )}
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-[#94A3B8] opacity-0 group-hover:opacity-100" />
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[#E2E8F0] dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#1A1A1A]">
          <div className="flex items-center gap-4 text-[10px] text-[#94A3B8]">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-[#252525] rounded border border-[#E2E8F0] dark:border-[#3D3D3D] font-mono">
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-[#252525] rounded border border-[#E2E8F0] dark:border-[#3D3D3D] font-mono">
                Enter
              </kbd>
              Open in new tab
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-white dark:bg-[#252525] rounded border border-[#E2E8F0] dark:border-[#3D3D3D] font-mono">
                Esc
              </kbd>
              Close
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
