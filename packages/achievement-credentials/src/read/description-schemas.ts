/**
 * The schema of the parts of a service description that a client of an API needs to register and ask for tokens, which a
 * provider checks that it serves.
 *
 * @module
 */

import { httpsUrlSchema, looseRecord, nonEmptyStringSchema } from "@interopkit/core/checks";
import * as v from "valibot";

/**
 * The parts of a service description that a client reads, and the name of each in the OpenAPI file (OB 6.3, 7.1.1): the name
 * and the policies of the resource server, the endpoint of registration, and the authorization code flow with its endpoints and
 * scopes. Every address is an absolute `https` URL. The other parts of the file are carried and not read.
 */
export const usableDescriptionSchema = looseRecord({
  info: looseRecord({
    title: nonEmptyStringSchema,
    termsOfService: v.optional(httpsUrlSchema),
    "x-imssf-image": v.optional(v.string()),
    "x-imssf-privacyPolicyUrl": httpsUrlSchema,
  }),
  components: looseRecord({
    securitySchemes: looseRecord({
      OAuth2ACG: looseRecord({
        "x-imssf-registrationUrl": httpsUrlSchema,
        flows: looseRecord({
          authorizationCode: looseRecord({
            authorizationUrl: httpsUrlSchema,
            tokenUrl: httpsUrlSchema,
            refreshUrl: v.optional(httpsUrlSchema),
            scopes: v.record(v.string(), v.unknown()),
          }),
        }),
      }),
    }),
  }),
});
