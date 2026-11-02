import type { AnyVerifiableCredential, Profile } from "@interopkit/achievement-credentials";
import { newerCredential, sameCredential } from "@interopkit/achievement-credentials";
import { handleCredentialsRequest } from "@interopkit/achievement-credentials/provider";
import type { VerifyOptions } from "@interopkit/achievement-credentials/verify";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";

/** What the wallet is built from. */
export interface WalletConfig {
  /** The address of the wallet, without a trailing slash. */
  readonly origin: string;
  /** The access token that the learner's apps send. A real wallet gets tokens from an authorization server. */
  readonly token: string;
  /** How the wallet verifies a credential before it keeps it: the keys, the clock, the contexts and the `fetch`. */
  readonly verify: VerifyOptions;
}

/** The wallet of one learner: the Open Badges API over a store in memory. */
export interface Wallet {
  /** Answers a request, as a route of a web framework would. */
  handle(request: HttpRequest): Promise<HttpResponse>;
}

/** The scopes of the Open Badges API, which the wallet offers and the token holds. */
const SCOPES = [
  "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.readonly",
  "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.upsert",
  "https://purl.imsglobal.org/spec/ob/v3p0/scope/profile.readonly",
  "https://purl.imsglobal.org/spec/ob/v3p0/scope/profile.update",
];

/** The learner whose credentials the token reaches. */
const OWNER = "learner-1";

/** What a credential is kept as: as it came, and as the model reads it. */
interface Kept {
  readonly received: string | Readonly<Record<string, unknown>>;
  readonly credential: AnyVerifiableCredential;
}

/** Opens the wallet of a learner. It refuses a credential that does not verify, and keeps the newest version of each. */
export function createWallet(config: WalletConfig): Wallet {
  const { origin, token, verify } = config;
  const held = new Map<string, Kept>();
  let profile: Profile | undefined;
  const serviceDescription = {
    openapi: "3.0.1",
    info: {
      title: "Example Wallet",
      version: "1.0",
      termsOfService: `${origin}/terms`,
      "x-imssf-privacyPolicyUrl": `${origin}/privacy`,
    },
    components: {
      securitySchemes: {
        OAuth2ACG: {
          type: "oauth2",
          "x-imssf-registrationUrl": "https://auth.example.edu/registration",
          flows: {
            authorizationCode: {
              authorizationUrl: "https://auth.example.edu/authorize",
              tokenUrl: "https://auth.example.edu/token",
              scopes: Object.fromEntries(SCOPES.map((scope) => [scope, "A scope of the Open Badges API."])),
            },
          },
        },
      },
    },
  };
  return {
    handle: (request) =>
      handleCredentialsRequest(request, {
        api: "badges",
        verify,
        serviceDescription,
        credentials: {
          async list(_owner, { limit, offset }) {
            const all = [...held.values()].map(({ received }) => received);
            return { credentials: all.slice(offset, offset + limit), total: all.length };
          },
          async upsert(_owner, { received, credential }) {
            const known = [...held.entries()].find(([, each]) => sameCredential(each.credential, credential));
            if (known === undefined) {
              held.set(String(held.size + 1), { received, credential });
              return "created";
            }
            const [key, current] = known;
            if (newerCredential(current.credential, credential) === current.credential) return "unchanged";
            held.set(key, { received, credential });
            return "replaced";
          },
        },
        profiles: {
          get: async () => profile,
          put: async (_owner, next) => {
            profile = next;
            return next;
          },
        },
        authorize: async (request, scope) => {
          const given = request.headers.authorization;
          if (given === undefined) return { allowed: false, status: 401 };
          return given === `Bearer ${token}` && SCOPES.includes(scope)
            ? { allowed: true, owner: OWNER }
            : { allowed: false, status: 403 };
        },
      }),
  };
}
