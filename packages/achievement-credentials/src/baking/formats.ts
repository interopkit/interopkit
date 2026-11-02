/** The kinds of credential that the bakers write into an image: an Open Badges credential, and a CLR. */
export type BakedKind = "badge" | "clr";

/** The kinds of credential that the readers find in an image: those that the bakers write, and an Open Badges 2.0 assertion. */
export type FoundKind = BakedKind | "badge-v2";

/** Where one kind of credential is written in a PNG and in an SVG. */
export interface BakedFormat {
  /** The keyword of the `iTXt` chunk of a PNG (Open Badges 3.0 section 5.3.1.1, CLR 2.0 section 4.3.1.1). */
  readonly keyword: string;
  /** The namespace of the `credential` element of an SVG (Open Badges 3.0 section 5.3.2.1, CLR 2.0 section 4.3.2.1). */
  readonly namespace: string;
  /** The prefix that the baker writes for the namespace. A reader accepts any prefix. */
  readonly prefix: string;
  /** The local name of the element of an SVG that holds the credential. */
  readonly element: string;
}

/**
 * The formats of the kinds: those of Open Badges 3.0 and CLR 2.0, and that of an Open Badges 2.0 assertion (Open Badges 2.0
 * Baking), the keyword `openbadges` of a PNG and the element `assertion` of `http://openbadges.org` in an SVG.
 */
export const FORMATS: Readonly<Record<FoundKind, BakedFormat>> = {
  badge: {
    keyword: "openbadgecredential",
    namespace: "https://purl.imsglobal.org/ob/v3p0",
    prefix: "openbadges",
    element: "credential",
  },
  clr: {
    keyword: "clrcredential",
    namespace: "https://purl.imsglobal.org/clr/v2p0",
    prefix: "clr",
    element: "credential",
  },
  "badge-v2": { keyword: "openbadges", namespace: "http://openbadges.org", prefix: "openbadges", element: "assertion" },
};

/** The kinds that the bakers write, and that an image to bake may already hold. */
export const BAKED_KINDS: readonly BakedKind[] = ["badge", "clr"];

/** The kinds that the readers look for. */
export const FOUND_KINDS: readonly FoundKind[] = ["badge", "clr", "badge-v2"];

/** The attribute of the element that holds a credential signed as a compact JWS, or for Open Badges 2.0 the address of a hosted assertion. */
export const VERIFY_ATTRIBUTE = "verify";

/** The namespace of an SVG (SVG 1.1, section 1.1). */
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
