/** The kinds of credential that an image holds: an Open Badges credential, and a CLR. */
export type BakedKind = "badge" | "clr";

/** Where one kind of credential is written in a PNG and in an SVG. */
export interface BakedFormat {
  /** The keyword of the `iTXt` chunk of a PNG (Open Badges 3.0 section 5.3.1.1, CLR 2.0 section 4.3.1.1). */
  readonly keyword: string;
  /** The namespace of the `credential` element of an SVG (Open Badges 3.0 section 5.3.2.1, CLR 2.0 section 4.3.2.1). */
  readonly namespace: string;
  /** The prefix that the baker writes for the namespace. A reader accepts any prefix. */
  readonly prefix: string;
}

/** The formats of the kinds, in the order that a reader looks for them. */
export const FORMATS: Readonly<Record<BakedKind, BakedFormat>> = {
  badge: { keyword: "openbadgecredential", namespace: "https://purl.imsglobal.org/ob/v3p0", prefix: "openbadges" },
  clr: { keyword: "clrcredential", namespace: "https://purl.imsglobal.org/clr/v2p0", prefix: "clr" },
};

/** The kinds, to loop over. */
export const BAKED_KINDS: readonly BakedKind[] = ["badge", "clr"];

/** The local name of the element that holds the credential in an SVG, in the namespace of its kind. */
export const CREDENTIAL_ELEMENT = "credential";

/** The attribute of that element that holds a credential signed as a compact JWS. */
export const VERIFY_ATTRIBUTE = "verify";

/** The namespace of an SVG (SVG 1.1, section 1.1). */
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
