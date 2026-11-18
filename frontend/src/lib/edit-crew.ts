/**
 * Who is editing the video with Edit with AI right now, for the editor's top
 * bar to show. Edit with AI (enterprise code) announces its crew on the window
 * whenever it changes; core code listens, so neither imports the other.
 */
import { useEffect, useState } from "react"

export const EDIT_CREW_EVENT = "nodaro:edit-crew"

/** At work now, waiting its turn, or finished for this run. */
export type CrewMood = "working" | "waiting" | "done"

export interface CrewMember {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly mood: CrewMood
}

/** Tells the page who is on the crew now; an empty list when the run is over. */
export function announceCrew(members: readonly CrewMember[]): void {
  window.dispatchEvent(new CustomEvent<readonly CrewMember[]>(EDIT_CREW_EVENT, { detail: members }))
}

/** The crew as last announced; empty until a run starts. */
export function useEditCrew(): readonly CrewMember[] {
  const [crew, setCrew] = useState<readonly CrewMember[]>([])
  useEffect(() => {
    const onCrew = (event: Event) => setCrew((event as CustomEvent<readonly CrewMember[]>).detail ?? [])
    window.addEventListener(EDIT_CREW_EVENT, onCrew)
    return () => window.removeEventListener(EDIT_CREW_EVENT, onCrew)
  }, [])
  return crew
}
