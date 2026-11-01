import type { BakedKind } from "./formats.js";

/** A credential that an image holds, with the kind that the image says it is. */
export interface BakedCredential {
  /** `"badge"` for an Open Badges credential and `"clr"` for a CLR: the keyword of the PNG chunk or the namespace of the SVG element. */
  readonly kind: BakedKind;
  /** The compact JWS of a credential signed as a VC-JWT, or the credential as JSON that nothing has checked yet. */
  readonly credential: string | object;
}
