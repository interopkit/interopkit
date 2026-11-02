/**
 * The configurations of Dynamic Registration: the OpenID configuration of a platform, the registration that a tool asks for,
 * and the acknowledgment of a platform.
 *
 * @module
 */
export type {
  MessageSupported,
  PlatformConfiguration,
  PlatformLtiConfiguration,
  ToolConfiguration,
  ToolLtiConfiguration,
  ToolMessageConfiguration,
  ToolRegistrationResult,
} from "./model.js";
export { readPlatformConfiguration, readToolConfiguration, readToolRegistrationResult } from "./read.js";
export { writePlatformConfiguration, writeToolConfiguration, writeToolRegistrationResult } from "./write.js";
