export interface Profile {
  readonly id: string
  readonly email: string
  readonly full_name: string | null
  readonly avatar_url: string | null
  readonly tier: 'free' | 'basic' | 'pro' | 'business' | 'enterprise'
  readonly credits_balance: number
  readonly storage_used_bytes: number
  readonly created_at: string
  readonly updated_at: string
}

export interface Project {
  readonly id: string
  readonly user_id: string
  readonly name: string
  readonly description: string | null
  readonly settings: Record<string, unknown>
  readonly created_at: string
  readonly updated_at: string
}

export interface Workflow {
  readonly id: string
  readonly project_id: string
  readonly user_id: string
  readonly name: string
  readonly description: string | null
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  readonly settings: Record<string, unknown>
  readonly is_template: boolean
  readonly version: number
  readonly created_at: string
  readonly updated_at: string
}

export interface WorkflowNode {
  readonly id: string
  readonly type: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: Record<string, unknown>
}

export interface WorkflowEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string
  readonly targetHandle?: string
}

export interface Job {
  readonly id: string
  readonly workflow_id: string
  readonly user_id: string
  readonly parent_job_id: string | null
  readonly status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  readonly priority: number
  readonly progress: number
  readonly credits_estimated: number | null
  readonly input_data: Record<string, unknown>
  readonly output_data: Record<string, unknown> | null
  readonly error_message: string | null
  readonly started_at: string | null
  readonly completed_at: string | null
  readonly created_at: string
}

export interface Asset {
  readonly id: string
  readonly user_id: string
  readonly job_id: string | null
  readonly type: 'image' | 'video' | 'audio' | 'document'
  readonly filename: string
  readonly mime_type: string
  readonly size_bytes: number
  readonly r2_key: string
  readonly r2_url: string
  readonly metadata: Record<string, unknown>
  readonly expires_at: string | null
  readonly created_at: string
}

export interface ApiResponse<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: string
  readonly meta?: {
    readonly total: number
    readonly page: number
    readonly limit: number
  }
}

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: ReadonlyArray<ValidationMessage>
  readonly warnings: ReadonlyArray<ValidationMessage>
  readonly estimatedCredits: number
}

export interface ValidationMessage {
  readonly nodeId: string
  readonly type: 'error' | 'warning'
  readonly message: string
  readonly suggestion?: string
  readonly suggestedNode?: string
}
