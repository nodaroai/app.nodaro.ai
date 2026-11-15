/**
 * The browser judges a deployment by its own lists before this server's
 * availability answer arrives (`nodeListsWithhold`, @nodaro/shared/runtime-config),
 * and a whitelist there inverts over every node type but
 * `ALLOW_LIST_EXEMPT_NODE_TYPES`. Here a whitelist inverts over
 * `GATEABLE_NODE_TYPES`, built from the registry (utility nodes and Site
 * Capture left out). The two must name the same node types, or the editor
 * would hide a node this server offers (or draw one it withholds) until the
 * answer arrived: a new utility node is added to the shared list, a node that
 * stops being utility is taken off it.
 */
import { describe, expect, it } from "vitest"
import {
  ALLOW_LIST_EXEMPT_NODE_TYPES,
  isAllowListGatedNodeType,
  nodeListsWithhold,
} from "@nodaro/shared/runtime-config"
import {
  GATEABLE_NODE_TYPES,
  KNOWN_NODE_TYPES,
  ONE_OFF_VOICE_CLONE_FEATURE,
  __availabilityUniverseReadyForTests,
} from "../availability-override.js"

describe("the node types a whitelist does not invert over, here and in the browser", () => {
  it("are exactly the shared list", async () => {
    await __availabilityUniverseReadyForTests()
    const notGated = [...KNOWN_NODE_TYPES].filter((type) => !GATEABLE_NODE_TYPES.has(type)).sort()
    expect(notGated).toEqual([...ALLOW_LIST_EXEMPT_NODE_TYPES].sort())
  })

  it("so every node type this server knows is gated alike on both sides", async () => {
    await __availabilityUniverseReadyForTests()
    const differ = [...KNOWN_NODE_TYPES].filter((type) => GATEABLE_NODE_TYPES.has(type) !== isAllowListGatedNodeType(type))
    expect(differ).toEqual([])
  })

  it("the one-off voice clone the shared rule follows a Voice Clone deny with is this server's", () => {
    expect(nodeListsWithhold({ allow: [], deny: ["voice-clone"] }, ONE_OFF_VOICE_CLONE_FEATURE)).toBe(true)
  })
})
