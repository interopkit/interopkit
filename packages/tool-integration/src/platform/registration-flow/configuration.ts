import { type HttpRequest, type HttpResponse, jsonResponse } from "@interopkit/core/http";
import { APPROVED_ALGORITHMS, type PlatformConfiguration } from "../../protocol/index.js";
import { PLATFORM_MESSAGE_TYPES, writePlatformConfiguration } from "../../protocol/internal.js";
import { methodNotAllowed } from "../answers.js";
import { endpointsOf, PATHS } from "../config.js";
import { supportedVariables } from "../messages/substitution.js";
import type { PlatformSettings } from "../options.js";
import { offeredScopes } from "../services/routes.js";

/** The claims of a user that the messages of the platform role may carry (LTI 1.3 Core section 5.3.6). */
const DEFAULT_CLAIMS = [
  "iss",
  "sub",
  "name",
  "given_name",
  "family_name",
  "middle_name",
  "email",
  "email_verified",
  "picture",
  "locale",
];
/** One `sub` for a user at every tool: what the platform role sends when the host gives the same subject to each. */
const DEFAULT_SUBJECT_TYPES = ["public"];

/**
 * Returns the OpenID configuration of the platform (Dynamic Registration 1.0 section 2.1): its endpoints on its origin, the
 * client authentication of `/token` with the algorithms that the platform verifies, the scopes of the services whose stores are
 * given with `openid`, the algorithm of its signer, the variables it substitutes, and what `discovery` and `config.instance`
 * say of it.
 */
function platformConfiguration(settings: PlatformSettings): PlatformConfiguration {
  const { config, discovery } = settings;
  const endpoints = endpointsOf(config);
  return {
    issuer: config.issuer,
    authorizationEndpoint: endpoints.authorization,
    registrationEndpoint: `${config.origin}${PATHS.registration}`,
    jwksUri: endpoints.jwks,
    tokenEndpoint: endpoints.token,
    tokenEndpointAuthMethodsSupported: ["private_key_jwt"],
    tokenEndpointAuthSigningAlgValuesSupported: [...APPROVED_ALGORITHMS],
    scopesSupported: ["openid", ...offeredScopes(settings)],
    responseTypesSupported: ["id_token"],
    idTokenSigningAlgValuesSupported: [config.keys.signer.algorithm],
    claimsSupported: [...(discovery.claimsSupported ?? DEFAULT_CLAIMS)],
    subjectTypesSupported: [...(discovery.subjectTypesSupported ?? DEFAULT_SUBJECT_TYPES)],
    lti: {
      // The options check that Dynamic Registration has the product family code of the instance.
      productFamilyCode: config.instance?.productFamilyCode ?? "",
      ...(config.instance?.version === undefined ? {} : { version: config.instance.version }),
      messagesSupported: discovery.messagesSupported ?? PLATFORM_MESSAGE_TYPES.map((type) => ({ type })),
      variables: supportedVariables(settings.substitution),
    },
  };
}

/** Answers a GET of the OpenID configuration of the platform. */
export function answerConfiguration(request: HttpRequest, settings: PlatformSettings): HttpResponse {
  if (request.method !== "GET") return methodNotAllowed(request.method, "GET");
  return jsonResponse(200, writePlatformConfiguration(platformConfiguration(settings)));
}
