import type { Clock, Fetch } from "@interopkit/core";
import { createJwksCache, SCOPES } from "@interopkit/tool-integration";
import {
  buildPlatformEndpoints,
  type LaunchStore,
  type MessageInput,
  type PlatformConfig,
  type PlatformEndpoints,
  type PlatformLoginOptions,
  type PlatformRequestOptions,
  type ToolMessageOptions,
  type ToolRegistration,
} from "@interopkit/tool-integration/platform";
import { createGradebook, type Gradebook } from "./gradebook.ts";
import { generateHintKey, generatePlatformKeys } from "./keys.ts";
import { type Attempts, createAttempts } from "./proctoring.ts";
import { createRegistrations, type Registrations } from "./registration.ts";
import { courseOf, createRosterStores } from "./roster.ts";

/** What the platform knows of the tool: the tool's side of the registration. */
export interface ToolSide {
  readonly clientId: string;
  readonly deploymentId: string;
  readonly loginUrl: string;
  readonly redirectUri: string;
  /** The tool's public key, which the platform has instead of a URL of the tool's key set. */
  readonly keyId: string;
  readonly publicKey: CryptoKey;
}

/** The issuer of the platform, which is also its origin. */
export const ISSUER = "https://lms.example";
const FRAME_ORIGIN = "https://app.lms.example";

/** What the platform is configured with: the options of its login and of its handler, and its endpoints. */
export interface PlatformSetup {
  /** The options of `prepareToolLaunch`. */
  readonly login: PlatformLoginOptions;
  /** The options of `handlePlatformRequest`. */
  readonly requests: PlatformRequestOptions;
  /** The URLs of the endpoints, which the administrator of the tool registers with it. */
  readonly endpoints: PlatformEndpoints;
  /** The options of `readDeepLinkingResponse`, which reads what the tool posts to the return URL of a Deep Linking request. */
  readonly toolMessage: ToolMessageOptions;
  /** The gradebook behind the grade services. */
  readonly gradebook: Gradebook;
  /** The attempts of proctored assessments behind the Assessment Control Service. */
  readonly attempts: Attempts;
  /** The registrations of the tools that registered themselves through Dynamic Registration. */
  readonly registrations: Registrations;
}

/** The path of the platform's route that reads the response of a Deep Linking request, on the platform's origin. */
export const DEEP_LINKING_PATH = "/deep-linking";
/** The path of the platform's route that reads the Start Assessment message of a proctoring tool, on the platform's origin. */
export const START_ASSESSMENT_PATH = "/proctoring/start";

/** The launches in progress, in memory: a real host keeps them where every process can reach them, for 300 seconds. */
function launchStore(): LaunchStore {
  const kept = new Map<string, MessageInput>();
  return {
    put: async (id, message) => void kept.set(id, message),
    take: async (id) => {
      const message = kept.get(id);
      kept.delete(id);
      return message;
    },
  };
}

/**
 * Configures a platform with the keys it generates, the one tool that its administrator registered by hand, and the tools that
 * register themselves. `fetch` reaches the key sets of the tools that registered themselves.
 */
export async function setupPlatform(clock: Clock, side: ToolSide, fetch: Fetch): Promise<PlatformSetup> {
  const config: PlatformConfig = {
    issuer: ISSUER,
    origin: ISSUER,
    frameOrigin: FRAME_ORIGIN,
    reservedOrigins: [],
    keys: await generatePlatformKeys("platform-1"),
    hintKey: await generateHintKey(),
    // Dynamic Registration names the product of the platform in its OpenID configuration.
    instance: { guid: "lms-example-1", productFamilyCode: "lms-example", version: "1.0" },
  };
  const registration: ToolRegistration = {
    clientId: side.clientId,
    deploymentIds: [side.deploymentId],
    loginUrl: side.loginUrl,
    redirectUris: [side.redirectUri],
    keys: new Map([[side.keyId, side.publicKey]]),
    // The tool may read the line items and the results, and post scores; it may not change the line items. It may read the
    // members of the course, its groups and the record of needs of a user, and control the attempts that it proctors.
    scopes: [
      SCOPES.lineitemReadonly,
      SCOPES.resultReadonly,
      SCOPES.score,
      SCOPES.contextMembershipReadonly,
      SCOPES.contextGroupReadonly,
      SCOPES.preferencesRecordReadonly,
      SCOPES.assessmentControl,
    ],
  };
  const registrations = createRegistrations();
  const tools = async (clientId: string) =>
    clientId === registration.clientId ? registration : registrations.active(clientId);
  // The ledger of single-use identifiers: a client assertion is accepted once.
  const used = new Set<string>();
  const once = async (id: string): Promise<boolean> => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  };
  const launches = launchStore();
  const gradebook = createGradebook();
  const { roster, groups, preferences } = createRosterStores(courseOf(side.clientId));
  const attempts = createAttempts();
  // The tool registered by hand gave its key; a tool that registered itself names its key set, which the platform fetches.
  const jwks = createJwksCache({ fetch, clock });
  return {
    login: { config, clock, registration: tools, check: async () => undefined, launches },
    requests: {
      config,
      clock,
      registration: tools,
      launches,
      once,
      jwks,
      services: {
        gradebook: gradebook.store,
        roster,
        groups,
        preferences,
        control: attempts.store,
        registrations: registrations.store,
      },
    },
    toolMessage: { config, clock, registration: tools, jwks, once },
    endpoints: buildPlatformEndpoints(config),
    gradebook,
    attempts,
    registrations,
  };
}
