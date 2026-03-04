/**
 * Re-export presentation utilities from shared package.
 * All pure logic lives in packages/shared/src/presentation-utils.ts.
 * This file keeps all existing frontend imports working unchanged.
 */

export {
  INPUT_NODE_TYPES,
  getInputNodes,
  getOutputNodes,
  getOutputType,
  getNodeResult,
  getNodeLabel,
  getInputFieldSchema,
  type OutputType,
  type InputFieldSchema,
} from "@nodaro-shared/presentation-utils"
