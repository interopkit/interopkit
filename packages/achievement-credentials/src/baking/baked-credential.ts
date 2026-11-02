import type { FoundKind } from "./formats.js";

/** A credential that an image holds, with the kind that the image says it is. */
export interface BakedCredential {
  /**
   * `"badge"` for an Open Badges credential, `"clr"` for a CLR and `"badge-v2"` for an Open Badges 2.0 assertion: the keyword
   * of the PNG chunk or the namespace of the SVG element.
   */
  readonly kind: FoundKind;
  /**
   * The compact JWS of a credential signed as a VC-JWT, or of a signed 2.0 assertion; the address of a hosted 2.0 assertion; or
   * the credential as JSON that nothing has checked yet.
   */
  readonly credential: string | object;
}
