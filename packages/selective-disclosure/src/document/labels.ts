import { createHmac, createHmacIdLabelMapFunction, type LabelMapFactory } from "./primitives.js";

/**
 * Makes the function that gives each blank node of a document the label that an HMAC of its canonical label makes: the same
 * key gives the same labels, and without the key a label says nothing of the blank node (section 3.4.4).
 *
 * @param hmacKey - The key of the HMAC.
 */
export async function hmacLabelMap(hmacKey: Uint8Array): Promise<LabelMapFactory> {
  return createHmacIdLabelMapFunction({ hmac: await createHmac({ key: hmacKey }) });
}
