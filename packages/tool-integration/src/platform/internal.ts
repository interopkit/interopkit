/**
 * What the tests of the platform role use of `platform` and the package does not export.
 *
 * @module
 */
export { LTI_HINT_TTL_SECONDS } from "./login.js";
export { autoPostPage } from "./page.js";
export { openToken, sealToken } from "./seal.js";
export {
  openAccess,
  openHint,
  openLineItem,
  openLoginHint,
  sealAccess,
  sealHint,
  sealLineItem,
  sealLoginHint,
} from "./tokens.js";
