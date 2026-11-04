/**
 * The identity of the family: its site, its sentence, the identity of each package and the marks of others that its texts
 * name. `check:standards`, the TypeDoc plugin of `docs/typedoc-seo.ts`, `scripts/llms.ts` and `scripts/check-site.ts` read
 * this file and nothing else of the family, so another family copies them unchanged and writes its own copy of this file.
 */

/**
 * The base of every URL of the docs site, with its trailing slash: the `hostedBaseUrl` of TypeDoc, the `homepage` of each
 * package, the links of the READMEs, the sitemap, `robots.txt` and the `CNAME` of the site. A labeled default until the
 * owner buys the domain; changing it is this one line, and `check:standards` then lists every file that names the old one.
 */
export const SITE = "https://interopkit.dev/";

/** The repository, which a link to a file that the docs site does not publish points into, on its default branch. */
export const REPOSITORY = "https://github.com/interopkit/interopkit";

/** The name of the family, its sentence and the `author` of every package. */
export const FAMILY = {
  name: "interopkit",
  sentence:
    "Learning standards for JavaScript and TypeScript: LTI 1.3, Caliper 1.2, xAPI 2.0, cmi5, CASE 1.1, Open Badges 3.0, CLR 2.0 and the ecdsa-sd-2023 cryptosuite.",
  author: "Fariz Wakan (https://github.com/luthfanwakan)",
} as const;

/** Facts of use that hold for every package, as `llms.txt` and `context7.json` state them to an assistant. */
export const FACTS: readonly string[] = [
  "Import each part from its subpath, such as `@interopkit/tool-integration/tool`; every package is ESM with TypeScript types.",
  "Inputs and results are plain JSON data; readers throw `DataError` on invalid input, and validators return findings as data.",
  "Nothing reaches the network or storage on its own: the caller passes a `fetch` and the stores as ports, and may pass a `Clock`.",
  "A handler takes an `HttpRequest` and returns an `HttpResponse` of `@interopkit/core/http`, which any web framework can build.",
];

/** The identity of one package: what npm, the README, the docs site and `llms.txt` say of it. */
export interface PackageIdentity {
  /** The name on npm, which is also the folder below `packages/` and `docs/` after the scope. */
  readonly name: string;
  /** The standard and its version that the package implements, which the title of each of its pages carries. */
  readonly label?: string;
  /** The identity sentence: the `description` of `package.json` and the first sentence of the README. */
  readonly description: string;
  /** The `keywords` of `package.json`, as people type them. */
  readonly keywords: readonly string[];
}

/** Every package of the family, in the order of the README's table. */
export const PACKAGES: readonly PackageIdentity[] = [
  {
    name: "@interopkit/tool-integration",
    label: "LTI 1.3",
    description:
      "LTI 1.3 for JavaScript and TypeScript, in the tool and the platform role: launches, Deep Linking, Assignment and Grade Services, Names and Role Provisioning, Context Groups, Proctoring and Dynamic Registration.",
    keywords: [
      "lti",
      "lti-1.3",
      "lti13",
      "lti-advantage",
      "learning-tools-interoperability",
      "lti-tool",
      "lti-platform",
      "deep-linking",
      "assignment-and-grade-services",
      "names-and-role-provisioning",
      "dynamic-registration",
      "lms",
      "openid-connect",
      "typescript",
    ],
  },
  {
    name: "@interopkit/learning-analytics",
    label: "Caliper Analytics 1.2",
    description:
      "Caliper Analytics 1.2 for JavaScript and TypeScript: the event and entity model, a sensor that sends events, and the endpoint that receives and checks them; reads Caliper 1.1.",
    keywords: [
      "caliper",
      "caliper-analytics",
      "caliper-1.2",
      "learning-analytics",
      "learning-events",
      "sensor",
      "json-ld",
      "typescript",
    ],
  },
  {
    name: "@interopkit/competency-frameworks",
    label: "CASE 1.1",
    description:
      "CASE 1.1 and 1.0 for JavaScript and TypeScript: the model of a competency framework, readers checked against the published CASE JSON schemas, crosswalks, changes, and a client and a provider of the CASE REST API.",
    keywords: [
      "case",
      "case-1.1",
      "competencies-and-academic-standards-exchange",
      "competency-framework",
      "competencies",
      "academic-standards",
      "learning-standards",
      "crosswalk",
      "typescript",
    ],
  },
  {
    name: "@interopkit/learning-records",
    label: "xAPI 2.0",
    description:
      "xAPI 2.0 (IEEE 9274.1.1) and 1.0.3 for JavaScript and TypeScript: the Statement model, validators for the rules of an LRS and a provider, builders, signatures, an LRS client, an LRS request handler, and xAPI Profiles 1.0 with Statements matched to a profile's templates and patterns.",
    keywords: [
      "xapi",
      "xapi-2.0",
      "experience-api",
      "tin-can",
      "statements",
      "learning-record-store",
      "lrs",
      "lrp",
      "learning-records",
      "xapi-profiles",
      "typescript",
    ],
  },
  {
    name: "@interopkit/achievement-credentials",
    label: "Open Badges 3.0, CLR 2.0",
    description:
      "Open Badges 3.0 and CLR 2.0 for JavaScript and TypeScript: the credential model, readers, issuing, Data Integrity and JWT proofs, status lists, verification, and the Open Badges and CLR APIs; reads and verifies Open Badges 2.0.",
    keywords: [
      "open-badges",
      "openbadges",
      "open-badges-3",
      "clr",
      "comprehensive-learner-record",
      "verifiable-credentials",
      "digital-credentials",
      "achievement-credentials",
      "data-integrity",
      "bitstring-status-list",
      "typescript",
    ],
  },
  {
    name: "@interopkit/selective-disclosure",
    label: "ecdsa-sd-2023",
    description:
      "The W3C ecdsa-sd-2023 Data Integrity cryptosuite for JavaScript and TypeScript: base proofs for issuers, derived proofs for holders and their verification, for any verifiable credential.",
    keywords: [
      "ecdsa-sd-2023",
      "selective-disclosure",
      "data-integrity",
      "verifiable-credentials",
      "cryptosuite",
      "typescript",
    ],
  },
  {
    name: "@interopkit/course-launch",
    label: "cmi5",
    description:
      "cmi5 for JavaScript and TypeScript: the course structure with its reader, validator and writer, course packages, the LMS role over an xAPI LRS, and the assignable unit runtime.",
    keywords: ["cmi5", "xapi", "course-structure", "assignable-unit", "lms", "elearning", "typescript"],
  },
  {
    name: "@interopkit/core",
    description:
      "The shared foundation of the interopkit packages: errors, argument checks, bounded HTTP service calls, plain request and response types, a signing port and OAuth 2.0 clients.",
    keywords: ["interopkit", "interoperability", "http-client", "oauth2", "abort-signal", "argument-validation"],
  },
];

/** A body whose standards the family implements: how a text names it, and the lines that it asks for. */
export interface Holder {
  /** The name in the line that the family is not affiliated with it. */
  readonly name: string;
  /** Words that name the body or a standard of it that holds no mark of its own, so that a text that has one carries the line. */
  readonly named: RegExp;
  /** The line that names the body's own mark, where it asks for one. */
  readonly trademark?: string;
  /** The line of each of its marks, with `{mark}` where the mark goes. */
  readonly markLine?: string;
}

/** The bodies, in the order of their lines. */
export const HOLDERS: Readonly<Record<string, Holder>> = {
  "1edtech": {
    name: "1EdTech Consortium, Inc.",
    named: /\b1EdTech\b|\bOpen Badges\b/,
    markLine: "{mark} is a trademark of 1EdTech® Consortium, Inc. (1edtech.org).",
  },
  w3c: {
    name: "W3C",
    named:
      /\bW3C\b|(?:verifiable|Verifiable) (?:credential|Credential)s?\b|\bData Integrity\b|\becdsa-sd-2023\b|\bBitstring Status List\b/,
    trademark: "W3C® is a trademark of the World Wide Web Consortium.",
  },
  ieee: {
    name: "IEEE",
    named: /\bIEEE\b|\bxAPI\b|\bExperience API\b|\b(?:cmi5)\b/,
    trademark: "IEEE is a trademark of the Institute of Electrical and Electronics Engineers, Inc.",
  },
  adl: { name: "ADL", named: /\bADL\b|\bxAPI\b|\bExperience API\b|\b(?:cmi5)\b/ },
};

/** A mark of another, as its holder lists it, and how a text names it. */
export interface Mark {
  /** The mark with its symbol, as the holder writes it. */
  readonly mark: string;
  /** The key of its holder in `HOLDERS`. */
  readonly holder: string;
  /** Words that name it. */
  readonly named: RegExp;
}

/** The marks that the texts of the family name, in the order of their lines; 1EdTech asks for one line for each. */
export const MARKS: readonly Mark[] = [
  { mark: "LTI®", holder: "1edtech", named: /\bLTI\b/ },
  { mark: "Learning Tools Interoperability®", holder: "1edtech", named: /\bLearning Tools Interoperability\b/ },
  { mark: "Caliper Analytics®", holder: "1edtech", named: /\bCaliper\b/ },
  { mark: "CASE®", holder: "1edtech", named: /\bCASE\b/ },
  {
    mark: "Competencies and Academic Standards Exchange®",
    holder: "1edtech",
    named: /\bCompetencies and Academic Standards Exchange\b/,
  },
  { mark: "CLR Standard®", holder: "1edtech", named: /\bCLR\b/ },
  { mark: "Comprehensive Learner Record Standard™", holder: "1edtech", named: /\bComprehensive Learner Record\b/ },
  { mark: "AccessForAll®", holder: "1edtech", named: /\bAccessForAll\b|\bAfA\b/ },
  { mark: "QTI®", holder: "1edtech", named: /\bQTI\b/ },
];
