import type { MentionCandidate } from "../../prompt-mentions"

/**
 * The library the §3 example is authored against — one row per `cast` entry, in
 * the shape the editor hands the importer (`mentionCandidates` in `Studio.tsx`:
 * characters, locations, objects and creatures, each able to produce its own
 * `ConnectedReference`).
 *
 * Kept beside the example so the "imports with zero warnings" guard has a
 * library to resolve against without touching the network or a hook.
 */
export const EXAMPLE_LIBRARY: ReadonlyArray<MentionCandidate> = [
  {
    id: "char-natalie",
    name: "Natalie",
    toConnectedReference: () => ({
      id: "char-natalie",
      defaultName: "Natalie",
      source: "wired-character",
      url: "https://r2.example/natalie.png",
    }),
  },
]
