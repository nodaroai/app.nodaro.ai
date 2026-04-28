import type { NodaroClient } from "../client.js"

export interface Project {
  id: string
  userId: string
  name: string
  description?: string | null
  settings?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  description?: string
  settings?: Record<string, unknown>
}

export interface UpdateProjectInput {
  name?: string
  description?: string
  settings?: Record<string, unknown>
}

export class ProjectsResource {
  constructor(private client: NodaroClient) {}

  /** List the authenticated user's projects. */
  list(): Promise<{ data: Project[] }> {
    return this.client.request("GET", "/v1/projects")
  }

  /** Get a project by ID. */
  get(id: string): Promise<{ data: Project }> {
    return this.client.request("GET", `/v1/projects/${encodeURIComponent(id)}`)
  }

  /** Create a new project. */
  create(input: CreateProjectInput): Promise<{ data: Project }> {
    return this.client.request("POST", "/v1/projects", { body: input })
  }

  /** Update a project. At least one field must be provided. */
  update(id: string, input: UpdateProjectInput): Promise<{ data: Project }> {
    return this.client.request(
      "PATCH",
      `/v1/projects/${encodeURIComponent(id)}`,
      { body: input },
    )
  }

  /** Delete a project. Returns `{ success: true }`. */
  delete(id: string): Promise<{ success: true }> {
    return this.client.request("DELETE", `/v1/projects/${encodeURIComponent(id)}`)
  }
}
