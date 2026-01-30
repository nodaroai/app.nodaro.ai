"use client"

import { use } from "react"
import Link from "next/link"
import { ArrowLeft, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { WorkflowsTab } from "@/components/dashboard/workflows-tab"
import { AssetsTab } from "@/components/dashboard/assets-tab"
import { JobsTab } from "@/components/dashboard/jobs-tab"

export default function ProjectPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === id))

  if (!project) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>Project not found.</p>
        <Link href="/projects" className="text-primary underline text-sm mt-2 block">
          Back to projects
        </Link>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold truncate">{project.name}</h1>
          {project.description && (
            <p className="text-xs sm:text-sm text-muted-foreground truncate sm:whitespace-normal">{project.description}</p>
          )}
        </div>
        <Button variant="outline" size="sm" disabled className="hidden sm:flex">
          <Settings className="h-4 w-4 mr-1" />
          Settings
        </Button>
      </div>

      <Tabs defaultValue="workflows">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="workflows" className="mt-4">
          <WorkflowsTab projectId={id} />
        </TabsContent>
        <TabsContent value="assets" className="mt-4">
          <AssetsTab />
        </TabsContent>
        <TabsContent value="jobs" className="mt-4">
          <JobsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
