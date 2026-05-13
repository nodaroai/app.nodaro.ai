import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { saveCharacter } from "@/lib/api"
import type { CharacterNodeData } from "@/types/nodes"

export interface CharacterStudioState {
  staged: CharacterNodeData
  isDirty: boolean
  patch: (p: Partial<CharacterNodeData>) => void
  /** Persist to the canvas node + the `characters` DB table. An optional `extraPatch`
   *  is merged into what's written (used by the modal to stamp `*Status: "running"`
   *  for in-flight asset jobs at save time — without relying on a queued setState). */
  save: (extraPatch?: Partial<CharacterNodeData>) => Promise<void>
  discard: () => void
}

export function useCharacterStudio(nodeId: string): CharacterStudioState | null {
  const node = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const initialRef = useRef<CharacterNodeData | null>(null)
  const [staged, setStaged] = useState<CharacterNodeData | null>(null)

  useEffect(() => {
    if (node && initialRef.current === null) {
      initialRef.current = JSON.parse(JSON.stringify(node.data)) as CharacterNodeData
      setStaged(JSON.parse(JSON.stringify(node.data)) as CharacterNodeData)
    }
  }, [node])

  const isDirty = useMemo(() => {
    if (!staged || !initialRef.current) return false
    return JSON.stringify(staged) !== JSON.stringify(initialRef.current)
  }, [staged])

  const patch = useCallback((p: Partial<CharacterNodeData>) => {
    setStaged((prev) => (prev ? { ...prev, ...p } : prev))
  }, [])

  const save = useCallback(
    async (extraPatch?: Partial<CharacterNodeData>) => {
      if (!staged) return
      const toWrite: CharacterNodeData = extraPatch ? { ...staged, ...extraPatch } : staged
      updateNodeData(nodeId, toWrite)
      const { id: dbId } = await saveCharacter({
        id: toWrite.characterDbId || undefined,
        nodeId,
        projectId: toWrite.projectId || undefined,
        name: toWrite.characterName,
        description: toWrite.description,
        gender: toWrite.gender,
        style: toWrite.style,
        baseOutfit: toWrite.baseOutfit,
        sourceImageUrl: toWrite.sourceImageUrl || undefined,
        expressions: toWrite.expressions,
        poses: toWrite.poses,
        lightingVariations: toWrite.lightingVariations,
        angles: toWrite.angles,
        motions: toWrite.motions,
        voice: toWrite.voice,
        personality: toWrite.personality,
      })
      // First save of a Studio-only character: learn the DB id so subsequent saves
      // UPDATE the row instead of inserting a new one.
      const persisted: CharacterNodeData =
        toWrite.characterDbId === dbId ? toWrite : { ...toWrite, characterDbId: dbId }
      if (persisted !== toWrite) updateNodeData(nodeId, { characterDbId: dbId })
      setStaged(persisted)
      initialRef.current = JSON.parse(JSON.stringify(persisted)) as CharacterNodeData
    },
    [staged, nodeId, updateNodeData],
  )

  const discard = useCallback(() => {
    if (initialRef.current) setStaged(JSON.parse(JSON.stringify(initialRef.current)) as CharacterNodeData)
  }, [])

  if (!staged) return null
  return { staged, isDirty, patch, save, discard }
}
