// @test-reads-for-caller reads only the test files Vitest hands it to order
// The file order for a run with a shared-worker project: the default order,
// with the shared files grouped by environment so their workers are reused
// (why, and the measurement: groupSharedByEnvironment in test-projects.ts).
// Kept apart from test-projects.ts because `vitest/node` loads Vite, which
// cannot be imported under the node-environment DOM tripwire that the guard
// test runs with.
import { readFileSync } from "node:fs"
import { BaseSequencer, type TestSpecification } from "vitest/node"
import { groupSharedByEnvironment, NODE_ENVIRONMENT_DOCBLOCK, shuffleWithSeed } from "./test-projects"

export class SharedWorkerSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    // A shuffle the config could not see on the command line (see
    // shuffleRequested) still shuffles: this sequencer replaced Vitest's random one.
    const { shuffle, seed } = this.ctx.config.sequence
    if (shuffle) return shuffleWithSeed(files, seed ?? Date.now())
    return groupSharedByEnvironment(await super.sort(files), (spec) => NODE_ENVIRONMENT_DOCBLOCK.test(readFileSync(spec.moduleId, "utf8")))
  }
}
