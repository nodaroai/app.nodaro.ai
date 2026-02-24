import { useQuery } from "@tanstack/react-query"
import { getCallableWorkflows, getWorkflowInterface } from "@/lib/api"

export function useCallableWorkflows(projectId?: string) {
  return useQuery({
    queryKey: ["callable-workflows", projectId ?? "all"],
    queryFn: () => getCallableWorkflows(projectId),
    staleTime: 30_000, // 30s
  })
}

export function useWorkflowInterface(workflowId?: string) {
  return useQuery({
    queryKey: ["workflow-interface", workflowId],
    queryFn: () => getWorkflowInterface(workflowId!),
    enabled: !!workflowId,
    staleTime: 30_000,
  })
}
