/**
 * The rules of Open Badges 2.0 that a reader of a badge applies, one entry for each sentence of the specification or rule of
 * the validator of 1EdTech, each with a document that breaks it and what the reader finds.
 *
 * The entries are written from the vocabulary of Open Badges 2.0 (its tables, whose bold properties are required, and its
 * primitive data types) and from the class validators of `openbadges-validator-core` (`tasks/validation.py`), and not from
 * the code that reads badges: the tests of the package change a sound document with `fixture` and compare what the readers
 * find with `findings`. A source names the class of the specification, or `validator` and the class of `validation.py`.
 */

/** A JSON object, such as an assertion. */
export type Json = Record<string, unknown>;

/** What a reader finds: where, which rule and how serious. */
interface ExpectedFinding {
  readonly path: string;
  readonly rule: string;
  readonly severity: "error" | "warning";
}

/** The documents that the rules change: an assertion that embeds its BadgeClass and issuer, and the documents of a verifier. */
export type RuleDocument = "assertion" | "cryptographic-key" | "endorsement" | "revocation-list";

/** A sentence of the specification, a document that breaks it, and what the reader finds in that document. */
export interface Ob2Rule {
  /** The class of the specification or of the validator that states the rule, such as `OB 2.0 Assertion`. */
  readonly source: string;
  /** What the specification says, in its words or shortened. */
  readonly text: string;
  /** The document that the fixture changes. */
  readonly document: RuleDocument;
  /** Changes a sound document into one that breaks the rule. It does not change its argument. */
  readonly fixture: (document: Json) => Json;
  /** Every finding of the reader, in order. Empty when the reader accepts the document. */
  readonly findings: readonly ExpectedFinding[];
}

const CONTEXT = "https://w3id.org/openbadges/v2";

/**
 * The first example of Open Badges 2.0: an assertion that embeds its BadgeClass, which embeds its issuer. The example leaves
 * out `hashed`, which its IdentityObject table requires; here it is false, as the plain identity is.
 */
export function soundAssertion(): Json {
  return {
    "@context": CONTEXT,
    id: "https://example.org/assertions/123",
    type: "Assertion",
    recipient: { type: "email", hashed: false, identity: "alice@example.org" },
    issuedOn: "2016-12-31T23:59:59+00:00",
    verification: { type: "hosted" },
    badge: {
      type: "BadgeClass",
      id: "https://example.org/badges/5",
      name: "3-D Printmaster",
      description: "This badge is awarded for passing the 3-D printing knowledge and safety test.",
      image: "https://example.org/badges/5/image",
      criteria: {
        narrative:
          "Students are tested on knowledge and safety, both through a paper test and a supervised performance evaluation on live equipment",
      },
      issuer: {
        id: "https://example.org/issuer",
        type: "Profile",
        name: "Example Maker Society",
        url: "https://example.org",
        email: "contact@example.org",
        verification: { allowedOrigins: "example.org" },
      },
    },
  };
}

/** The CryptographicKey example of Open Badges 2.0. */
export function soundKey(): Json {
  return {
    "@context": CONTEXT,
    type: "CryptographicKey",
    id: "https://example.org/publicKey/1",
    owner: "https://example.org/organization.json",
    publicKeyPem:
      "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----\n",
  };
}

/** The Endorsement example of Open Badges 2.0. */
export function soundEndorsement(): Json {
  return {
    "@context": CONTEXT,
    type: "Endorsement",
    id: "https://example.org/assertions/123",
    issuer: "https://example.org/issuer",
    issuedOn: "2016-12-31T23:59:59+00:00",
    claim: {
      id: "https://otherissuer.example/1",
      email: "contact@otherissuer.example",
      endorsementComment: "A great provider of badged learning.",
    },
    verification: { type: "hosted" },
  };
}

/** The RevocationList example of Open Badges 2.0, with the entries that its prose describes. */
export function soundRevocationList(): Json {
  return {
    "@context": CONTEXT,
    id: "https://example.org/revocationList",
    type: "RevocationList",
    issuer: "https://example.org/organization.json",
    revokedAssertions: [
      { id: "urn:uuid:52e4c6b3-8c13-4fa8-8482-a5cf34ef37a9", revocationReason: "Violation of policy" },
      "urn:uuid:6deb4a00-ebce-4b28-8cc2-afa705ef7be4",
      { uid: "abc123", revocationReason: "Awarded in error" },
    ],
  };
}

/** Changes a copy of a document at a path of names and indexes, separated by dots: `badge.issuer.email`. */
function change(path: string, edit: (parent: Json, key: string) => void): (document: Json) => Json {
  return (document) => {
    const copy = structuredClone(document);
    const keys = path.split(".");
    let parent: Json = copy;
    for (const key of keys.slice(0, -1)) {
      parent[key] ??= {};
      parent = parent[key] as Json;
    }
    edit(parent, keys.at(-1) ?? "");
    return copy;
  };
}

/** Sets the value at a path, making the objects on the way when there are none. */
function set(path: string, value: unknown): (document: Json) => Json {
  return change(path, (parent, key) => {
    parent[key] = value;
  });
}

/** Removes the property at a path. */
function remove(path: string): (document: Json) => Json {
  return change(path, (parent, key) => {
    delete parent[key];
  });
}

/** Applies several changes in order. */
function all(...steps: readonly ((document: Json) => Json)[]): (document: Json) => Json {
  return (document) => steps.reduce((current, step) => step(current), document);
}

const error = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "error" });
const warning = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "warning" });

/** A rule of the assertion and the documents that it embeds. */
function assertion(
  source: string,
  text: string,
  fixture: (document: Json) => Json,
  findings: readonly ExpectedFinding[],
): Ob2Rule {
  return { source, text, document: "assertion", fixture, findings };
}

/** A rule of a document that a verifier reads on its own. */
function documentRule(
  document: RuleDocument,
  source: string,
  text: string,
  fixture: (value: Json) => Json,
  findings: readonly ExpectedFinding[],
): Ob2Rule {
  return { source, text, document, fixture, findings };
}

/** The rules that a document breaks and the reader reports. */
export const OB2_REFUSALS: readonly Ob2Rule[] = [
  assertion("OB 2.0 Assertion", "id: Unique IRI for the Assertion (required).", remove("id"), [
    error("id", "missing-property"),
  ]),
  assertion(
    "OB 2.0 Primitive datatypes",
    "IRI: the only known supported IRI schemes are http and https.",
    set("id", "assertions/123"),
    [error("id", "invalid-format")],
  ),
  assertion(
    "OB 2.0 Assertion",
    "type: in most cases, this will simply be the string Assertion.",
    set("type", "BadgeClass"),
    [error("type", "invalid-value")],
  ),
  assertion(
    "OB 2.0 Assertion",
    "type: an array including Assertion and other string elements that are either URLs or compact IRIs within the current context.",
    set("type", ["Assertion", "Award"]),
    [error("type[1]", "invalid-format")],
  ),
  assertion(
    "OB 2.0 Assertion",
    "type: a compact IRI must use a prefix of the context.",
    set("type", ["Assertion", "ex:Award"]),
    [error("type[1]", "invalid-format")],
  ),
  assertion("OB 2.0 Assertion", "recipient: the recipient of the achievement (required).", remove("recipient"), [
    error("recipient", "missing-property"),
  ]),
  assertion("OB 2.0 Assertion", "badge: IRI or document of the BadgeClass (required).", remove("badge"), [
    error("badge", "missing-property"),
  ]),
  assertion(
    "OB 2.0 Assertion",
    "verification: instructions for third parties to verify this assertion (required).",
    remove("verification"),
    [error("verification", "missing-property")],
  ),
  assertion(
    "OB 2.0 Assertion",
    "issuedOn: timestamp of when the achievement was awarded (required).",
    remove("issuedOn"),
    [error("issuedOn", "missing-property")],
  ),
  assertion(
    "OB 2.0 Primitive datatypes",
    "DateTime: ISO 8601 including the time and a time zone indicator.",
    set("issuedOn", "2016-12-31T23:59:59"),
    [error("issuedOn", "invalid-format")],
  ),
  assertion(
    "OB 2.0 Primitive datatypes",
    "DateTime: Open Badges v2.0 requires string ISO 8601 values; previous versions allowed Unix timestamps as integers.",
    set("issuedOn", 1_483_228_799),
    [error("issuedOn", "wrong-type")],
  ),
  assertion(
    "OB 2.0 Primitive datatypes",
    "DateTime: the date must be a day of the calendar.",
    set("expires", "2017-02-29T00:00:00Z"),
    [error("expires", "invalid-format")],
  ),
  assertion(
    "validator Assertion",
    "Assertion expiration is prior to issue date.",
    set("expires", "2016-12-30T23:59:59+00:00"),
    [error("expires", "expiry-before-issue")],
  ),
  assertion(
    "OB 2.0 Assertion",
    "image: an IRI; an image for the assertion may not be a data URI (validator: allow_data_uri false).",
    set("image", "data:image/png;base64,iVBORw0KGgo="),
    [error("image", "invalid-format")],
  ),
  assertion(
    "validator Assertion",
    "image: the image of an assertion, as a document, may not be a data URI either.",
    set("image", { id: "data:image/png;base64,iVBORw0KGgo=" }),
    [error("image.id", "invalid-format")],
  ),
  assertion(
    "OB 2.0 Assertion",
    "evidence: an IRI of a webpage, or a document.",
    set("evidence", ["urn:uuid:3f4ac4c2-55bd-4f63-a3f6-6b3a4c6f7e10"]),
    [error("evidence[0]", "invalid-format")],
  ),
  assertion("OB 2.0 Assertion", "narrative: Text or Markdown Text.", set("narrative", 5), [
    error("narrative", "wrong-type"),
  ]),
  assertion("OB 2.0 Assertion", "revoked: Boolean.", set("revoked", "yes"), [error("revoked", "wrong-type")]),
  assertion("validator Assertion", "@language: a language tag.", set("@language", "en_US"), [
    error('["@language"]', "invalid-format"),
  ]),
  assertion("OB 2.0 Properties", "version: Text or Number.", set("version", true), [error("version", "wrong-type")]),
  assertion(
    "validator Assertion",
    "related: the URL of another edition.",
    set("related", ["urn:uuid:3f4ac4c2-55bd-4f63-a3f6-6b3a4c6f7e10"]),
    [error("related[0]", "invalid-format")],
  ),
  assertion(
    "OB 2.0 Linked Data",
    "A document under another context is not one of Open Badges 2.0.",
    set("badge.@context", "https://w3id.org/openbadges/v1"),
    [error('badge["@context"]', "invalid-value")],
  ),
  assertion(
    "OB 2.0 context",
    "verify is an alias of verification: an object holding both holds the property twice.",
    set("verify", { type: "hosted" }),
    [error("verify", "duplicate-term")],
  ),
  assertion(
    "OB 2.0 VerificationObject",
    "type: HostedBadge or SignedBadge for single assertion verification.",
    set("verification.type", "VerificationObject"),
    [error("verification.type", "invalid-value")],
  ),
  assertion(
    "validator VerificationObjectAssertion",
    "type: a single way to verify an assertion.",
    set("verification.type", ["HostedBadge", "SignedBadge"]),
    [error("verification.type", "invalid-value")],
  ),
  assertion("OB 2.0 VerificationObject", "type is required.", set("verification", {}), [
    error("verification.type", "missing-property"),
  ]),
  assertion(
    "OB 2.0 SignedBadge",
    "creator: the (HTTP) id of the key used to sign the assertion.",
    set("verification", { type: "signed", creator: 5 }),
    [error("verification.creator", "wrong-type")],
  ),
  assertion(
    "validator IdentityObject",
    "type: one of the profile identifier properties id, email, url and telephone.",
    set("recipient.type", "name"),
    [error("recipient.type", "invalid-value")],
  ),
  assertion(
    "OB 2.0 IdentityObject",
    "hashed: whether or not the identity value is hashed (required).",
    remove("recipient.hashed"),
    [error("recipient.hashed", "missing-property")],
  ),
  assertion("OB 2.0 IdentityObject", "identity: identityHash or Text (required).", set("recipient.identity", 5), [
    error("recipient.identity", "wrong-type"),
  ]),
  assertion(
    "validator IdentityObject",
    "Identity must match known hash style if hashed is true.",
    set("recipient.hashed", true),
    [error("recipient.identity", "identity-hash-form")],
  ),
  assertion(
    "validator IdentityObject",
    "Identity must not be hashed if hashed is false.",
    set("recipient.identity", "md5$c0b8f5c4f8b2e1f0c5d4a3b2e1f0c5d4"),
    [error("recipient.identity", "identity-hash-flag")],
  ),
  assertion(
    "validator IdentityObject",
    "Email type identity must match email format.",
    set("recipient.identity", "alice"),
    [error("recipient.identity", "identity-email-form")],
  ),
  assertion(
    "OB 2.0 Primitive datatypes",
    "IdentityHash: the only supported algorithms are MD5 and SHA-256.",
    all(set("recipient.hashed", true), set("recipient.identity", "sha1$5b03e11fe1e0a04ddbe2a1bd3d1d4bd0d43c3b6d")),
    [error("recipient.identity", "identity-hash-form")],
  ),
  assertion("OB 2.0 BadgeClass", "name: the name of the achievement (required).", remove("badge.name"), [
    error("badge.name", "missing-property"),
  ]),
  assertion(
    "OB 2.0 BadgeClass",
    "description: a short description of the achievement (required).",
    remove("badge.description"),
    [error("badge.description", "missing-property")],
  ),
  assertion("OB 2.0 BadgeClass", "image: an image of the achievement (required).", remove("badge.image"), [
    error("badge.image", "missing-property"),
  ]),
  assertion(
    "OB 2.0 BadgeClass",
    "image: this must be a PNG or SVG image.",
    set("badge.image", "data:image/jpeg;base64,/9j/4AAQ"),
    [error("badge.image", "invalid-format")],
  ),
  assertion(
    "OB 2.0 Image",
    "id: the URI or Data URI of the image (required).",
    set("badge.image", { caption: "A printer" }),
    [error("badge.image.id", "missing-property")],
  ),
  assertion("OB 2.0 BadgeClass", "criteria: URI or embedded criteria document (required).", remove("badge.criteria"), [
    error("badge.criteria", "missing-property"),
  ]),
  assertion(
    "validator Criteria",
    "Criteria node has no narrative: either external id or narrative is required.",
    set("badge.criteria", {}),
    [error("badge.criteria", "criteria-undescribed")],
  ),
  assertion("OB 2.0 BadgeClass", "criteria: the URI of a page.", set("badge.criteria", "criteria/5"), [
    error("badge.criteria", "invalid-format"),
  ]),
  assertion("OB 2.0 BadgeClass", "issuer: IRI or document of the Profile (required).", remove("badge.issuer"), [
    error("badge.issuer", "missing-property"),
  ]),
  assertion(
    "OB 2.0 BadgeClass",
    "type: in most cases, this will simply be the string BadgeClass.",
    set("badge.type", "Assertion"),
    [error("badge.type", "invalid-value")],
  ),
  assertion(
    "OB 2.0 AlignmentObject",
    "targetUrl is required to accurately identify targets.",
    set("badge.alignment", [{ targetName: "Making" }]),
    [error("badge.alignment[0].targetUrl", "missing-property")],
  ),
  assertion(
    "OB 2.0 AlignmentObject",
    "targetUrl: URL linking to the official description of the alignment target.",
    set("badge.alignment", { targetName: "Making", targetUrl: "standards/making" }),
    [error("badge.alignment.targetUrl", "invalid-format")],
  ),
  assertion("OB 2.0 BadgeClass", "tags: Text (multiple values allowed).", set("badge.tags", [5]), [
    error("badge.tags[0]", "wrong-type"),
  ]),
  assertion("OB 2.0 Profile", "name is required of an issuer.", remove("badge.issuer.name"), [
    error("badge.issuer.name", "missing-property"),
  ]),
  assertion("OB 2.0 Profile", "url is required of an issuer.", remove("badge.issuer.url"), [
    error("badge.issuer.url", "missing-property"),
  ]),
  assertion("OB 2.0 Profile", "email is required of an issuer.", remove("badge.issuer.email"), [
    error("badge.issuer.email", "missing-property"),
  ]),
  assertion("validator Profile", "email: an email address.", set("badge.issuer.email", "contact"), [
    error("badge.issuer.email", "invalid-format"),
  ]),
  assertion("OB 2.0 Profile", "telephone: E.164, like +16175551212.", set("badge.issuer.telephone", "617-555-1212"), [
    error("badge.issuer.telephone", "invalid-format"),
  ]),
  assertion(
    "OB 2.0 Profile",
    "type: Issuer or the more general Profile.",
    set("badge.issuer.type", "schema:Organization"),
    [error("badge.issuer.type", "invalid-value")],
  ),
  assertion(
    "OB 2.0 Profile",
    "url: a URL accessible via HTTP.",
    set("badge.issuer.url", "mailto:contact@example.org"),
    [error("badge.issuer.url", "invalid-format")],
  ),
  assertion(
    "OB 2.0 VerificationObject",
    "allowedOrigins: the host registered name subcomponent of an allowed origin.",
    set("badge.issuer.verification.allowedOrigins", "https://example.org"),
    [error("badge.issuer.verification.allowedOrigins", "invalid-format")],
  ),
  assertion(
    "OB 2.0 VerificationObject",
    "verificationProperty: the @id of the property to be used for verification, a term of the context.",
    set("badge.issuer.verification.verificationProperty", "assertionId"),
    [error("badge.issuer.verification.verificationProperty", "invalid-format")],
  ),
  assertion(
    "validator VerificationObjectIssuer",
    "startsWith: a URL.",
    set("badge.issuer.verification.startsWith", "/assertions/"),
    [error("badge.issuer.verification.startsWith", "invalid-format")],
  ),
  assertion(
    "OB 2.0 CryptographicKey",
    "publicKeyPem: Text.",
    set("badge.issuer.publicKey", [{ id: "https://example.org/key", publicKeyPem: 5 }]),
    [error("badge.issuer.publicKey[0].publicKeyPem", "wrong-type")],
  ),
  assertion(
    "validator Profile",
    "Issuer Profile not hosted with HTTP-based identifier: many platforms can only handle HTTP(s)-hosted issuers.",
    set("badge.issuer.id", "urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0a01"),
    [warning("badge.issuer.id", "issuer-not-http")],
  ),
  assertion(
    "OB 2.0 Assertion",
    "badge: an IRI is the address of the BadgeClass, which reading without the network cannot follow.",
    set("badge", "https://example.org/badges/5"),
    [error("badge", "not-embedded")],
  ),
  assertion(
    "OB 2.0 BadgeClass",
    "issuer: an IRI is the address of the Profile, which reading without the network cannot follow.",
    set("badge.issuer", "https://example.org/issuer"),
    [error("badge.issuer", "not-embedded")],
  ),
  assertion(
    "OB 2.0 Endorsement",
    "claim: an entity identified by an id (required).",
    set("badge.endorsement", [{ ...soundEndorsement(), claim: {} }]),
    [error("badge.endorsement[0].claim.id", "missing-property")],
  ),
  assertion(
    "OB 2.0 Endorsement",
    "verification: instructions for third parties to verify this assertion of endorsement (required).",
    all(set("badge.endorsement", [soundEndorsement()]), remove("badge.endorsement.0.verification")),
    [error("badge.endorsement[0].verification", "missing-property")],
  ),
  documentRule(
    "endorsement",
    "OB 2.0 Endorsement",
    "issuedOn: timestamp of when the endorsement was published (required).",
    remove("issuedOn"),
    [error("issuedOn", "missing-property")],
  ),
  documentRule("endorsement", "OB 2.0 Endorsement", "type: Endorsement.", set("type", "Assertion"), [
    error("type", "invalid-value"),
  ]),
  documentRule(
    "cryptographic-key",
    "OB 2.0 CryptographicKey",
    "owner: the identifier of the Profile that owns this key.",
    set("owner", "issuer"),
    [error("owner", "invalid-format")],
  ),
  documentRule("revocation-list", "OB 2.0 RevocationList", "type: RevocationList (required).", remove("type"), [
    error("type", "missing-property"),
  ]),
  documentRule(
    "revocation-list",
    "OB 2.0 RevocationList",
    "revokedAssertions (required).",
    remove("revokedAssertions"),
    [error("revokedAssertions", "missing-property")],
  ),
  documentRule(
    "revocation-list",
    "OB 2.0 RevocationList",
    "An identifying property must be used, either id or (legacy) uid.",
    set("revokedAssertions", [{ revocationReason: "Awarded in error" }]),
    [error("revokedAssertions[0]", "entry-unidentified")],
  ),
  documentRule(
    "revocation-list",
    "validator RevocationList",
    "An entry with an id not in IRI format.",
    set("revokedAssertions", ["assertion-1"]),
    [error("revokedAssertions[0]", "invalid-format")],
  ),
];

/** What the reader accepts, which the specification or its context allows. */
export const OB2_ACCEPTANCES: readonly Omit<Ob2Rule, "findings">[] = [
  {
    source: "OB 2.0 context",
    text: "verify is an alias of verification.",
    document: "assertion",
    fixture: all(remove("verification"), set("verify", { type: "hosted" })),
  },
  {
    source: "OB 2.0 VerificationObject",
    text: "Aliases in context are available: hosted and signed.",
    document: "assertion",
    fixture: set("verification", { type: "signed", creator: "https://example.org/key" }),
  },
  {
    source: "OB 2.0 VerificationObject",
    text: "HostedBadge, the term that hosted stands for.",
    document: "assertion",
    fixture: set("verification.type", ["HostedBadge"]),
  },
  {
    source: "OB 2.0 Assertion",
    text: "type: an array including Assertion and compact IRIs within the current context.",
    document: "assertion",
    fixture: set("type", ["Assertion", "extensions:ApprenticeshipAward", "https://example.org/Award"]),
  },
  {
    source: "OB 2.0 Primitive datatypes",
    text: "DateTime: optional seconds and decimal microsecond, and Z or an offset.",
    document: "assertion",
    fixture: all(set("issuedOn", "2016-12-31T23:59Z"), set("expires", "2017-12-31T23:59:59.123456-0500")),
  },
  {
    source: "OB 2.0 Primitive datatypes",
    text: "IdentityHash: SHA-256 in uppercase hexadecimal.",
    document: "assertion",
    fixture: all(
      set("recipient.hashed", true),
      set("recipient.identity", "sha256$7A1A1B3F7D40552E4299180E346E3ADD12BF9A751A43D9C4CA4518FEBC2C60C6"),
    ),
  },
  {
    source: "OB 2.0 Assertion",
    text: "A document embedded in another may name the context of Open Badges 2.0.",
    document: "assertion",
    fixture: set("badge.@context", CONTEXT),
  },
  {
    source: "OB 2.0 Extensions",
    text: "An extension holds its own context and properties that the context of Open Badges 2.0 does not define.",
    document: "assertion",
    fixture: set("badge.extensions:ExampleExtension", {
      "@context": "https://example.org/context.json",
      type: ["Extension", "extensions:ExampleExtension"],
      verify: 5,
    }),
  },
  {
    source: "OB 2.0 Image",
    text: "A data URI of a PNG image in a BadgeClass.",
    document: "assertion",
    fixture: set("badge.image", { id: "data:image/png;base64,iVBORw0KGgo=", caption: "A printer" }),
  },
  {
    source: "OB 2.0 Profile",
    text: "The keys an issuer uses to sign assertions (multiple values allowed).",
    document: "assertion",
    fixture: set("badge.issuer.publicKey", ["https://example.org/keys/1", "https://example.org/keys/2"]),
  },
  {
    source: "OB 2.0 VerificationObject",
    text: "startsWith: multiple values allowed.",
    document: "assertion",
    fixture: set("badge.issuer.verification.startsWith", ["https://example.org/a/", "https://example.org/b/"]),
  },
  {
    source: "OB 2.0 Properties",
    text: "version: Text or Number; related: an edition with its own id and language.",
    document: "assertion",
    fixture: all(
      set("badge.version", 2),
      set("badge.related", [{ id: "https://example.org/badges/5-es", "@language": "es" }]),
    ),
  },
  {
    source: "OB 2.0 VerificationObject",
    text: "verificationProperty: only id is supported; an image of the issuer as a document.",
    document: "assertion",
    fixture: all(
      set("badge.issuer.verification.verificationProperty", "id"),
      set("badge.issuer.image", { id: "https://example.org/logo.png", caption: "The logo" }),
    ),
  },
  {
    source: "OB 2.0 Endorsement",
    text: "issuer: the profile of the issuer, embedded.",
    document: "endorsement",
    fixture: set("issuer", {
      id: "https://example.org/issuer",
      type: "Issuer",
      name: "Example Maker Society",
      url: "https://example.org",
      email: "contact@example.org",
    }),
  },
  {
    source: "OB 2.0 RevocationList",
    text: "The entries of its example: an object with an id, a string, and an object with a uid.",
    document: "revocation-list",
    fixture: (value) => value,
  },
  {
    source: "OB 2.0 CryptographicKey",
    text: "The key of its example.",
    document: "cryptographic-key",
    fixture: (value) => value,
  },
  {
    source: "OB 2.0 Endorsement",
    text: "The endorsement of its example.",
    document: "endorsement",
    fixture: (value) => value,
  },
];
