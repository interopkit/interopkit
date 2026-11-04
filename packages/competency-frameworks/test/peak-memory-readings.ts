import { type Reading, refusal } from "../../../scripts/peak-memory-child.js";
import { createCaseClient } from "../src/client/index.js";
import { readEntity, readPackage, validatePackage } from "../src/index.js";
import { handleCaseRequest } from "../src/provider/index.js";
import { framework } from "./bank.js";
import { fakeProvider } from "./fake-provider.js";
import { id, uri } from "./full-package.js";
import { DISCOVERY, memoryStore } from "./provider-fixture.js";

const MIB = 1024 * 1024;

/** The list of a million wrong values, which a reader refuses at the first and a validator stops at its limit of findings. */
const WRONG_VALUES = 1_000_000;

/** The most bytes of an answer that a client reads unless it is told another: 16 MiB. */
const MAX_BYTES = 16 * MIB;

/** The most members of an object that the default limit of 2,000,000 tokens takes: four tokens each, a key, a colon, a value and a comma. */
const MEMBERS = 499_000;
/** The characters of each key, so that the answer is as close to the default limit of 16 MiB as the members allow. */
const KEY_LENGTH = 28;

/** A document that is sound. */
const document = () => ({
  identifier: id(1),
  uri: uri("CFDocuments", 1),
  creator: "Ministry of Education",
  title: "A framework",
  lastChangeDateTime: "2024-06-13T18:46:03+00:00",
});

/** A package whose items are a million wrong values. */
const hostilePackage = () => ({ CFDocument: document(), CFItems: new Array(WRONG_VALUES).fill(0) });

/** The text of the largest framework of the bank that an answer of at most 16 MiB holds. */
function largestFramework(): { readonly text: string; readonly items: number } {
  for (let items = 15_000; ; items -= 100) {
    const text = JSON.stringify(framework(items));
    if (new TextEncoder().encode(text).byteLength <= MAX_BYTES) return { text, items };
  }
}

/** The text of a package whose document has extensions of as many distinct keys as the default limits take. */
function widestAnswer(): string {
  let members = "";
  for (let index = 0; index < MEMBERS; index += 1) {
    members += `${index === 0 ? "" : ","}"${String(index).padStart(KEY_LENGTH, "k")}":0`;
  }
  return `{"CFDocument":${JSON.stringify(document()).slice(0, -1)},"extensions":{${members}}}}`;
}

/** The readings of the package, by name. */
export const READINGS = {
  /** A request with a fields list of 10 MiB, refused before the list is split. */
  providerFields: {
    input: () => ({
      method: "GET",
      url: `https://case.example.org/ims/case/v1p1/CFDocuments?fields=${"title,".repeat(1_747_626)}title`,
      headers: {},
      body: new Uint8Array(),
    }),
    read: async (request: Parameters<typeof handleCaseRequest>[0]) => {
      const response = await handleCaseRequest(request, { store: memoryStore(), discovery: DISCOVERY });
      return `status ${response.status}`;
    },
  },
  /** The associations of an item that are a million wrong values, refused at the first. */
  readEntity: {
    input: () => ({
      CFItem: {
        identifier: id(2),
        uri: uri("CFItems", 2),
        fullStatement: "Explain how a quantity changes.",
        CFDocumentURI: { title: "A framework", identifier: id(1), uri: uri("CFDocuments", 1) },
        lastChangeDateTime: "2024-06-13T18:46:03+00:00",
      },
      CFAssociations: new Array(WRONG_VALUES).fill(0),
    }),
    read: (value: unknown) => refusal(() => readEntity("CFAssociationSet", value)),
  },
  /** A package with a million wrong items, which a reader counts the errors of up to its limit. */
  readPackage: {
    input: hostilePackage,
    read: (value: unknown) => refusal(() => readPackage(value)),
  },
  /** A package with a million wrong items, judged: the findings of the limit and one that says it stopped. */
  validatePackage: {
    input: hostilePackage,
    read: (value: unknown) => {
      const findings = validatePackage(value);
      return `${findings.length} findings, the last ${findings.at(-1)?.rule}`;
    },
  },
  /** The largest package that the default limits of a client take, read to the last item. */
  clientPackage: {
    input: largestFramework,
    read: async ({ text, items }: { text: string; items: number }) => {
      const provider = fakeProvider(() => ({ body: text }));
      const client = createCaseClient({ baseUrl: "https://case.example.org", fetch: provider.fetch });
      const pkg = await client.package("00000000-0000-4000-8000-000000000001");
      return `${pkg?.CFItems?.length === items ? "every one of" : "not all of"} ${items} items`;
    },
  },
  /** Extensions of as many distinct keys as the default limits of a client take. */
  clientKeys: {
    input: widestAnswer,
    read: async (text: string) => {
      const provider = fakeProvider(() => ({ body: text }));
      const client = createCaseClient({ baseUrl: "https://case.example.org", fetch: provider.fetch });
      const pkg = await client.package(id(1));
      return `${Object.keys(pkg?.CFDocument.extensions ?? {}).length} keys`;
    },
  },
} satisfies Record<string, Reading>;
