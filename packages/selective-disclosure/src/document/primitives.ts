// @ts-expect-error The package ships no types. This module types the part of it that the package calls, and nothing else imports it.
import * as untyped from "@digitalbazaar/di-sd-primitives";

/** The options that the JSON-LD and canonicalization functions pass on to `jsonld` and `rdf-canonize`. */
export interface ProcessingOptions {
  /** The only place a context is read from. */
  readonly documentLoader: (url: string) => Promise<{
    readonly contextUrl: null;
    readonly documentUrl: string;
    readonly document: unknown;
  }>;
  /** The most runs of the Hash N-Degree Quads algorithm in one canonicalization. */
  readonly maxDeepIterations: number;
  /** Ends the canonicalization at its next check. */
  readonly signal?: AbortSignal;
}

/** A compact JSON-LD document. */
type Document = Readonly<Record<string, unknown>>;

/** Gives the blank nodes of a document new labels, from the map of their canonical labels. */
export type LabelMapFactory = (input: { readonly canonicalIdMap: Map<string, string> }) => Promise<Map<string, string>>;

/** The canonical statements of a selection, with their positions among the statements of the whole document. */
interface Group {
  readonly matching: Map<number, string>;
  readonly nonMatching: Map<number, string>;
  readonly deskolemizedNQuads: string[];
}

/** The part of `@digitalbazaar/di-sd-primitives` that the package calls. Each function is as the Recommendation defines it. */
interface Primitives {
  createHmac(input: {
    readonly algorithm?: "HS256";
    readonly key: Uint8Array | null;
  }): Promise<{ export(): Promise<Uint8Array>; sign(bytes: Uint8Array): Promise<Uint8Array> }>;
  createHmacIdLabelMapFunction(input: {
    readonly hmac: { sign(bytes: Uint8Array): Promise<Uint8Array> };
  }): LabelMapFactory;
  createLabelMapFunction(input: { readonly labelMap: ReadonlyMap<string, string> }): LabelMapFactory;
  hashCanonizedProof(input: {
    readonly document: Document;
    readonly proof: Document;
    readonly options: ProcessingOptions;
  }): Promise<Uint8Array>;
  hashMandatory(input: { readonly mandatory: readonly string[] }): Promise<{ readonly mandatoryHash: Uint8Array }>;
  canonicalize(
    input: string,
    options: ProcessingOptions & {
      readonly inputFormat: "application/n-quads";
      readonly canonicalIdMap: Map<string, string>;
    },
  ): Promise<string>;
  canonicalizeAndGroup<TName extends string>(input: {
    readonly document: Document;
    readonly labelMapFactoryFunction: LabelMapFactory;
    readonly groups: Readonly<Record<TName, readonly string[]>>;
    readonly options: ProcessingOptions;
  }): Promise<{ readonly groups: Readonly<Record<TName, Group>>; readonly labelMap: Map<string, string> }>;
  labelReplacementCanonicalizeJsonLd(input: {
    readonly document: Document;
    readonly labelMapFactoryFunction: LabelMapFactory;
    readonly options: ProcessingOptions;
  }): Promise<string[]>;
  /** Selects parts of a document by JSON pointers. For no pointers it returns `null`, which no caller of the package asks for. */
  selectJsonLd(input: { readonly document: Document; readonly pointers: readonly string[] }): Document;
  stripBlankNodePrefixes(map: Map<string, string>): Map<string, string>;
}

const primitives: Primitives = untyped;

export const {
  canonicalize,
  canonicalizeAndGroup,
  createHmac,
  createHmacIdLabelMapFunction,
  createLabelMapFunction,
  hashCanonizedProof,
  hashMandatory,
  labelReplacementCanonicalizeJsonLd,
  selectJsonLd,
  stripBlankNodePrefixes,
} = primitives;
