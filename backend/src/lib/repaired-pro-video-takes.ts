import { repairedCanvasTake, savedVideoSources, type VideoRepair } from "@nodaro/render-rules"
import type { SimpleNode } from "../services/workflow-engine/types.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { supabase } from "./supabase.js"

/** A server run can start from a saved first clip while its editor is closed.
 * Resolve that take against the runner's own visible, completed Pro jobs. */
export async function withRepairedProVideoTakes(nodes: SimpleNode[], userId: string): Promise<SimpleNode[]> {
  const pro = nodes.filter(node => node.type === "generate-video-pro" || node.type === "edit-video-pro")
  const ids = [...new Set(pro.flatMap(node => savedVideoSources(node.data).map(source => source.jobId))
    .filter(id => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)))]
  if (!ids.length) return nodes
  const repairs: VideoRepair[] = []
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await supabase.from("jobs")
      .select("id, first:output_data->unassembledClips->0->>url, url:output_data->>videoUrl")
      .in("id", ids.slice(i, i + 50)).eq("user_id", userId).eq("status", "completed")
      .in("job_type", ["generate-video-pro", "edit-video-pro"]).eq("output_data->>deliveryMode", "simple_cuts")
      .is(CHILD_JOB_COLUMN, null).is(TRASHED_JOB_COLUMN, null).is("restricted_at", null)
    if (error) throw new Error("Could not read the repaired video for this run", { cause: error })
    for (const row of data ?? []) {
      if (typeof row.first === "string" && typeof row.url === "string") repairs.push({ jobId: row.id, first: row.first, url: row.url })
    }
  }
  if (!repairs.length) return nodes
  return nodes.map(node => {
    if (node.type !== "generate-video-pro" && node.type !== "edit-video-pro") return node
    const patch = repairedCanvasTake(node.data, repairs)
    return patch ? { ...node, data: { ...node.data, ...patch } } : node
  })
}
