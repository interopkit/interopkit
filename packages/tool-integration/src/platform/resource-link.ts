import { base64url } from "jose";

/**
 * Returns the identifier of the resource link of a launch: the hash of its `resource`, so that it is stable for the
 * resource, different for every other, opaque to the tool, and at most 255 characters (LTI 1.3 Core section 5.3.5). The
 * launch and the line item (`resourceLinkId`, LTI AGS 2.0 section 3.2.9) name the same link.
 */
export async function resourceLinkId(resource: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resource));
  return base64url.encode(new Uint8Array(digest));
}
