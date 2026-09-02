/**
 * Prompt-policy registry (B4b). Mirrors B3's egress-decorator slot
 * (providers/egress.ts) but as an ORDERED LIST — spec §7.2 Stage 2 exports
 * `promptPolicies[]`. With NO policy registered, `applyPromptPolicies` is the
 * identity: mainline prompt assembly is byte-identical.
 *
 * BACKEND-ONLY (spec §5.4b, §10): prompt assembly runs in the browser AND the
 * backend re-assembles server-side; applying at both roots doubles the clause
 * and a client-only clause is bypassable. So the transform lives here, on the
 * server, layered over the pure `@nodaro/prompts` assembly output. The registry
 * is CONTENT-FREE — the modesty clause text and any forced `vocalGender` are the
 * deployment's, set inside its registered policy, never in a package and never
 * from `process.env` inside a package.
 *
 * Registration happens at the composition root (or, later, via the Stage-2
 * overlay loader). Idempotence is the POLICY AUTHOR's contract: a re-run over
 * already-transformed text must be a no-op, achieved with a marker segment.
 */

/** The assembled prompt as the server holds it, just before dispatch. */
export interface PromptAssembly {
  prompt: string
  negativePrompt: string
  kind: "image" | "video" | "audio"
  /** Suno vocal gender (audio only); a policy may force it. undefined elsewhere. */
  vocalGender?: string
  /** W1-a: true when the subject of an IMAGE assembly is a minor (catalog age,
   *  custom age < 20, or a minor-implying type — `isMinorAge` in
   *  @nodaro/prompts). Set by the entity image handler from the character row;
   *  undefined on every other lane, where the floor is the identity. */
  subjectMinor?: boolean
}

export interface PromptPolicy {
  readonly id: string
  apply(a: PromptAssembly): PromptAssembly
}

const policies: PromptPolicy[] = []

/** Register a policy. Order is preserved; policies run in registration order. */
export function registerPromptPolicy(policy: PromptPolicy): void {
  policies.push(policy)
}

/** Test/bootstrap hook: drop all registered policies. */
export function clearPromptPolicies(): void {
  policies.length = 0
}

/** Ids of the registered policies, in order (idempotent registration checks). */
export function getRegisteredPromptPolicyIds(): readonly string[] {
  return policies.map((p) => p.id)
}

/** Run every registered policy in order. No policy registered = identity. */
export function applyPromptPolicies(a: PromptAssembly): PromptAssembly {
  let out = a
  for (const p of policies) out = p.apply(out)
  return out
}
