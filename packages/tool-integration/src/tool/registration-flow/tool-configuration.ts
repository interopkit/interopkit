import { checkProperties, checkRecord } from "@interopkit/core/checks";
import type { ToolConfiguration } from "../../protocol/index.js";
import { readToolConfiguration, writeToolConfiguration } from "../../protocol/internal.js";
import { writeAndRead } from "../write-and-read.js";

/**
 * The registration that a tool asks a platform for (Dynamic Registration 1.0 section 2.2), without what LTI fixes: the library
 * writes `application_type` `web`, the response type `id_token`, the grant types `implicit` and `client_credentials`, and
 * `private_key_jwt`.
 */
export type ToolConfigurationInput = Omit<
  ToolConfiguration,
  "applicationType" | "responseTypes" | "grantTypes" | "tokenEndpointAuthMethod"
>;

const INPUT_PROPERTIES = [
  "initiateLoginUri",
  "redirectUris",
  "clientName",
  "jwksUri",
  "logoUri",
  "contacts",
  "clientUri",
  "tosUri",
  "policyUri",
  "scope",
  "lti",
  "localized",
];

/**
 * Returns the registration request of a tool, written as Dynamic Registration 1.0 section 3.5.2 sends it, with what LTI fixes
 * added and the whole read back against section 2.2.
 *
 * @throws `DataError` when the input has the wrong type or breaks section 2.2, such as an address that is not `https`.
 */
export function writeToolInput(input: unknown): ReturnType<typeof writeToolConfiguration> {
  checkRecord(input, "The tool configuration must be an object");
  checkProperties(input, "The tool configuration", INPUT_PROPERTIES);
  const configuration = {
    ...(input as unknown as ToolConfigurationInput),
    applicationType: "web",
    responseTypes: ["id_token"],
    grantTypes: ["implicit", "client_credentials"],
    tokenEndpointAuthMethod: "private_key_jwt",
  } as const;
  return writeAndRead(configuration, "The tool configuration is not one", writeToolConfiguration, readToolConfiguration)
    .written;
}
