import type { CALIPER_1_1_CONTEXT, CALIPER_CONTEXT, CaliperEvent, EntityDocument } from "../model/index.js";
import type { CaliperFinding } from "../validate/index.js";

/** An envelope that an endpoint read: who sent it, what it says of itself, the events and entities that read, and the findings. */
export interface ReceivedEnvelope {
  /** Who sent it, as `authorize` named them. The `sensor` of the envelope is only what the sender says of itself. */
  readonly principal: string;
  /** The identifier that the sender gave its sensor, which Caliper advises to be an IRI. */
  readonly sensor: string;
  /** When the sensor issued the message, as `YYYY-MM-DDTHH:mm:ss.SSSZ`. */
  readonly sendTime: string;
  /**
   * The context of the Caliper version that governs the data. The data of 1.1 is read into the same model as the data of 1.2, and
   * each item names the context of its own document in `@context`.
   */
  readonly dataVersion: typeof CALIPER_CONTEXT | typeof CALIPER_1_1_CONTEXT;
  /** The events and the entity describes of the envelope that read, in their order. One that did not read is left out. */
  readonly data: readonly (CaliperEvent | EntityDocument)[];
  /**
   * What `validateEvent` and `validateEntity` found in each item, with the paths prefixed by `data[index]`: the errors of the
   * items that were left out, and the warnings and errors of the profiles of those that read. At most `maxFindings`, and a last
   * one with the rule `findings-stopped` when the list stopped there.
   */
  readonly findings: readonly CaliperFinding[];
}
