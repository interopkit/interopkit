import type { JsonObject } from "@interopkit/core/checks";

/**
 * What a Caliper endpoint says of itself when a sensor asks with a GET (Caliper 1.2 section 6.2): the largest payload it takes,
 * the versions it reads and what else it chooses to tell.
 *
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#configuration-information | Caliper Analytics 1.2, Configuration Information}
 */
export interface EndpointConfiguration {
  /** The size in kilobytes of the largest payload that the endpoint takes in one POST. A kilobyte is 1,024 bytes. */
  readonly caliperMaximumPayloadSize?: number;
  /** The IRIs of the contexts of the Caliper versions that the endpoint reads: a sensor sends data based on one of them. */
  readonly caliperSupportedVersions: readonly string[];
  /** What the endpoint chooses to tell beyond the specification, as a JSON object. */
  readonly caliperSupportedExtensions?: JsonObject;
}
