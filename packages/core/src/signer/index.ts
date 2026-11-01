/**
 * The `Signer` port, which signs bytes with a key that the host holds, a `Signer` over a `CryptoKey`, and the assembly of a
 * compact JWS around a signer. `@interopkit/core` exports them.
 *
 * @module
 */
export { signCompactJws } from "./jws.js";
export { type CryptoKeySignerOptions, type Signer, signerFromCryptoKey } from "./signer.js";
