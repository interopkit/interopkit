/**
 * What the tests of the platform role use of `platform` and the package does not export.
 *
 * @module
 */
export { LAUNCH_TTL_SECONDS } from "./login.js";
export { openToken, sealToken } from "./seal.js";
export { openDeepLinkingData, openHint, sealDeepLinkingData, sealHint } from "./tokens.js";
