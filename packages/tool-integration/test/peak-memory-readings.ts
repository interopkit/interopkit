// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims and of the parameters of its forms are those of the specifications.
import { createCryptoKeySigner, DataError } from "@interopkit/core";
import { base64url } from "jose";
import { type Reading, refusal } from "../../../scripts/peak-memory-child.js";
import type { LtiMessage } from "../src/index.js";
import { SCOPES } from "../src/index.js";
import { readDeepLinkingResponse, readStartAssessment } from "../src/platform/index.js";
import { unverifiedClaims } from "../src/protocol/internal.js";
import { createServiceClient, discoverPlatform, handleLaunch, handleLogin, registerTool } from "../src/tool/index.js";
import { CONTAINER_URL, FakeLms, SUBJECT } from "./fake-lms.js";
import { formPost, LOGIN_URL, ISSUER as PLATFORM_ISSUER } from "./fake-platform.js";
import { FakeRosterLms, MEMBERSHIPS_URL, PNP_HOST } from "./fake-roster.js";
import {
  clientAssertion,
  messageForm,
  TOOL_CLIENT_ID,
  TOOL_DEPLOYMENT_ID,
  tokenRequest,
  toolMessage,
  toolRegistration,
} from "./fake-tool.js";
import { generateKeyPair, request } from "./fixture.js";
import { MemoryGradebook } from "./gradebook.js";
import {
  baseFields,
  config,
  endpoints,
  handle,
  ISSUER,
  launch,
  PLATFORM_ORIGIN,
  setup as setupPlatform,
  toolKeys,
  toolMessageOptions,
} from "./platform-setup.js";
import { textOf } from "./text-of.js";
import { cookieLogin, setup } from "./tool-setup.js";

const MIB = 1024 * 1024;
const encoder = new TextEncoder();

/** The most bytes of the form of a launch, of the body of a request to the platform, and of a login initiation, by default. */
const MAX_FORM_BYTES = 65_536;
const MAX_BODY_BYTES = 65_536;
const MAX_INITIATION_BYTES = 65_536;
/** The most bytes of an answer of a step of Dynamic Registration by default. */
const MAX_ANSWER_BYTES = 65_536;
/** The objects that a record of 1,000,000 tokens holds, three tokens each. */
const OBJECTS = 330_000;

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const AP = "https://purl.imsglobal.org/spec/lti-ap/claim/";
const RETURN_URL = "https://lms.platform.example/deep-linking";
const START_URL = "https://lms.platform.example/proctoring/start";
const ACS_URL = `${PLATFORM_ISSUER}/proctoring/acs`;
const CONTROL_TYPE = "application/vnd.ims.lti-ap.v1.control+json";

const REGISTRATION_ISSUER = "https://lms.example.edu";
const CONFIGURATION_URL = `${REGISTRATION_ISSUER}/.well-known/openid-configuration`;
const TOOL = "https://tool.example.com";

/** What a refusal is: the class of the error and the reason or the limit it names, when it names one. */
async function refused(read: () => unknown): Promise<string> {
  try {
    await read();
  } catch (error) {
    if (error instanceof Error) {
      const named = error as Error & { reason?: string; limit?: string };
      return [error.name, named.reason ?? named.limit].filter((part) => part !== undefined).join(" ");
    }
    throw error;
  }
  return "no error";
}

/** Says that a refusal names the limit `limit`, or what it said. */
async function refusedBy(limit: string, read: () => unknown): Promise<string> {
  const said = await refusal(read);
  return said.includes(limit) ? `refused by ${limit}` : said;
}

/** The bytes of a form far above the limit, made once: a value of `a` of 64 MiB. */
const hugeForm = (name: string): Uint8Array => encoder.encode(`${name}=${"a".repeat(64 * MIB)}`);

/** A form POST to a URL of the platform. */
const formTo = (url: string, body: string | Uint8Array) =>
  request({ url, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

/** A form at the limit of repeated parameters: each `a=&` is one parameter of three bytes. */
const repeatedParameters = (limit: number) => "a=&".repeat(Math.floor(limit / 3));

/** A form at the limit of distinct parameters. */
const distinctParameters = (limit: number) =>
  Array.from({ length: Math.floor(limit / 8) }, (_, index) => `p${index.toString(36)}=`)
    .join("&")
    .slice(0, limit);

/** Bodies of 64 KiB of nesting and of arrays. */
const NESTING = `${"[".repeat(MAX_BODY_BYTES / 2)}${"]".repeat(MAX_BODY_BYTES / 2)}`;
const ARRAY = `[${"0,".repeat(MAX_BODY_BYTES / 2 - 2)}0]`;

/** The statuses of the answers to the posts, in order. */
async function statusesOf(
  posts: readonly Parameters<typeof handle>[1][],
  run: (post: Parameters<typeof handle>[1]) => ReturnType<typeof handle>,
): Promise<number[]> {
  const statuses: number[] = [];
  for (const post of posts) statuses.push((await run(post)).status);
  return statuses;
}

/** The statuses of the answers to the posts, in order, as a sentence. */
const describeStatuses = async (...args: Parameters<typeof statusesOf>): Promise<string> =>
  `statuses ${(await statusesOf(...args)).join(", ")}`;

/** The platform's configuration, which leads the tool to the registration endpoint. */
const CONFIGURATION = JSON.stringify({
  issuer: REGISTRATION_ISSUER,
  authorization_endpoint: `${REGISTRATION_ISSUER}/auth`,
  token_endpoint: `${REGISTRATION_ISSUER}/token`,
  token_endpoint_auth_methods_supported: ["private_key_jwt"],
  token_endpoint_auth_signing_alg_values_supported: ["RS256"],
  jwks_uri: `${REGISTRATION_ISSUER}/jwks`,
  registration_endpoint: `${REGISTRATION_ISSUER}/register`,
  scopes_supported: ["openid", SCOPES.score],
  response_types_supported: ["id_token"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  claims_supported: ["iss", "sub"],
  "https://purl.imsglobal.org/spec/lti-platform-configuration": {
    product_family_code: "lms",
    messages_supported: [{ type: "LtiResourceLinkRequest" }],
  },
});

/** The platform's answer to the registration, whose `redirect_uris` is an array of the given length. */
function registered(uris: number): string {
  return JSON.stringify({
    client_id: "tool-2",
    application_type: "web",
    response_types: ["id_token"],
    grant_types: ["implicit", "client_credentials"],
    initiate_login_uri: `${TOOL}/login`,
    redirect_uris: Array.from({ length: uris }, () => `${TOOL}/l`),
    client_name: "Tool",
    jwks_uri: `${TOOL}/jwks`,
    token_endpoint_auth_method: "private_key_jwt",
    "https://purl.imsglobal.org/spec/lti-tool-configuration": {
      domain: "tool.example.com",
      target_link_uri: `${TOOL}/launch`,
      claims: ["iss", "sub"],
      messages: [{ type: "LtiResourceLinkRequest" }],
    },
  });
}

/** The tool's configuration. */
const TOOL_CONFIGURATION = {
  initiateLoginUri: `${TOOL}/login`,
  redirectUris: [`${TOOL}/l`],
  clientName: "Tool",
  jwksUri: `${TOOL}/jwks`,
  lti: {
    domain: "tool.example.com",
    targetLinkUri: `${TOOL}/launch`,
    messages: [{ type: "LtiResourceLinkRequest" }],
    claims: ["iss", "sub"],
  },
};

/** A configuration whose `claims_supported` is an array of the given length. */
function configuration(claims: number): string {
  return JSON.stringify({
    ...JSON.parse(CONFIGURATION),
    scopes_supported: ["openid"],
    claims_supported: Array.from({ length: claims }, () => "a"),
    "https://purl.imsglobal.org/spec/lti-platform-configuration": {
      product_family_code: "lms",
      messages_supported: [],
    },
  });
}

/** A tool that has launched, with a client of the services whose `fetch` is the given one. */
async function launched(
  ctx: ReturnType<typeof setup>,
  options: Parameters<typeof cookieLogin>[1],
  services: Pick<Parameters<typeof createServiceClient>[1], "fetch" | "scopes">,
) {
  const { request: login } = await cookieLogin(ctx, options);
  const message = (await handleLaunch(login, ctx.options)) as LtiMessage;
  return createServiceClient(message, { ...ctx.options, ...services });
}

/** The readings of the package, by name. */
export const READINGS = {
  /** The claims of a token of 1.2 million empty objects, refused by the number of tokens before the signature is verified. */
  claims: {
    input: () => {
      // 1.2 million empty objects: 3.6 million tokens in 3.6 MB, which a parser turns into an object each.
      const payload = `[${"{},".repeat(1_200_000)}{}]`;
      return `${base64url.encode('{"alg":"RS256"}')}.${base64url.encode(payload)}.${base64url.encode("signature")}`;
    },
    read: (token: string) => refused(() => unverifiedClaims(token)),
  },
  /** A launch whose form is at the limit with one array of small objects as its token, and a launch whose form is far above it. */
  launch: {
    input: () => hugeForm("id_token"),
    read: async (huge: Uint8Array) => {
      const ctx = setup();
      const { auth, cookie } = await cookieLogin(ctx);
      const [header = "", , signature = ""] = auth.idToken.split(".");
      const room = MAX_FORM_BYTES - formPost({ id_token: `${header}..${signature}`, state: auth.state }).body.length;
      // Each `{},` is three bytes of JSON and four of base64url, so the payload fills the form to its last byte.
      const objects = Math.floor((room * 3) / 4 / 3) - 1;
      const payload = base64url.encode(`[${"{},".repeat(objects)}{}]`);
      const atLimit = formPost({ id_token: `${header}.${payload}.${signature}`, state: auth.state }, { cookie });
      const above = { ...formPost({ id_token: "", state: auth.state }, { cookie }), body: huge };
      return [
        await refused(() => handleLaunch(atLimit, ctx.options)),
        await refused(() => handleLaunch(above, ctx.options)),
      ].join("; ");
    },
  },
  /** The authentication and token requests with forms at the limit of repeated and of distinct parameters, and far above it. */
  platformForms: {
    input: () => hugeForm("a"),
    read: async (huge: Uint8Array) => {
      const ctx = setupPlatform();
      const repeated = repeatedParameters(MAX_BODY_BYTES);
      const distinct = distinctParameters(MAX_BODY_BYTES);
      const posts = [endpoints.authorization, endpoints.token].flatMap((url) => [
        formTo(url, repeated),
        formTo(url, distinct),
        formTo(url, huge),
      ]);
      const statuses = await statusesOf(posts, (post) => handle(ctx, post));
      return statuses.every((status) => [400, 405, 413].includes(status))
        ? `${statuses.length} requests, each refused with 400, 405 or 413`
        : `statuses ${statuses.join(", ")}`;
    },
  },
  /** The requests of the Assessment Control Service with bodies of 64 KiB of nesting and of arrays. */
  platformControl: {
    input: () => undefined,
    read: async () => {
      const ctx = setupPlatform({ tools: [toolRegistration({ scopes: [SCOPES.assessmentControl] })] });
      const services = { control: { control: async () => ({ status: "running" as const }) } };
      const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
      const granted = await handle(ctx, tokenRequest(endpoints.token, assertion, SCOPES.assessmentControl), {
        services,
      });
      const token = JSON.parse(textOf(granted.body)).access_token;
      const posts = [NESTING, ARRAY].map((body) =>
        request({
          url: `${PLATFORM_ORIGIN}/assessment-control`,
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": CONTROL_TYPE },
          body,
        }),
      );
      // The nesting passes the limit of levels, 413; the array is read within its limits and is not the model, 400.
      return await describeStatuses(posts, (post) => handle(ctx, post, { services }));
    },
  },
  /** The line items and scores of the grade services with bodies of 64 KiB of nesting and of arrays. */
  platformGrades: {
    input: () => undefined,
    read: async () => {
      const ctx = setupPlatform({ tools: [toolRegistration({ scopes: [SCOPES.lineitem, SCOPES.score] })] });
      const gradebook = new MemoryGradebook(TOOL_CLIENT_ID).add("course-1", {
        id: "quiz",
        label: "Quiz",
        scoreMaximum: 1,
      });
      const services = { gradebook };
      const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
      const granted = await handle(
        ctx,
        tokenRequest(endpoints.token, assertion, `${SCOPES.lineitem} ${SCOPES.score}`),
        {
          services,
        },
      );
      const token = JSON.parse(textOf(granted.body)).access_token;
      const container = `${PLATFORM_ORIGIN}/contexts/course-1/line-items`;
      const posts = [
        [container, "application/vnd.ims.lis.v2.lineitem+json"],
        [`${container}/quiz/scores`, "application/vnd.ims.lis.v1.score+json"],
      ].flatMap(([url = "", type = ""]) =>
        [NESTING, ARRAY].map((body) =>
          request({ url, method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": type }, body }),
        ),
      );
      // The nesting passes the limit of levels, 413; the array is read within its limits and is not the model, 400.
      return await describeStatuses(posts, (post) => handle(ctx, post, { services }));
    },
  },
  /** The registration endpoint with bodies of 64 KiB of nesting and of arrays. */
  platformRegistration: {
    input: () => undefined,
    read: async () => {
      const ctx = setupPlatform();
      const key = await generateKeyPair("platform-rsa-1");
      const registering = {
        config: {
          ...config,
          issuer: PLATFORM_ORIGIN,
          keys: {
            signer: createCryptoKeySigner(key.privateKey, { algorithm: "RS256", keyId: key.kid }),
            publicKeys: [key.publicJwk],
          },
          instance: { guid: "platform-1", productFamilyCode: "tests" },
        },
        openRegistration: true,
        services: {
          registrations: {
            register: async () => ({ reason: "invalid_client_metadata" as const, message: "No." }),
            get: async () => undefined,
            update: async () => undefined,
          },
        },
      };
      const posts = [NESTING, ARRAY].map((body) =>
        request({
          url: `${PLATFORM_ORIGIN}/registration`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
      return await describeStatuses(posts, (post) => handle(ctx, post, registering));
    },
  },
  /** A Deep Linking response of under 1 MiB that lists 10,000 items, refused by their number. */
  deepLinking: {
    input: () => undefined,
    read: async () => {
      const ctx = setupPlatform();
      const { claims } = await launch(ctx, {
        ...baseFields,
        messageType: "LtiDeepLinkingRequest",
        settings: { returnUrl: RETURN_URL, acceptTypes: ["html"], acceptPresentationDocumentTargets: ["iframe"] },
      });
      const common = {
        [`${CLAIM}message_type`]: "LtiDeepLinkingResponse",
        [`${CLAIM}version`]: "1.3.0",
        [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
        [`${DL}data`]: (claims[`${DL}deep_linking_settings`] as { data: string }).data,
      };
      const items = Array.from({ length: 10_000 }, (_, index) => ({ type: "html", html: "", title: `item ${index}` }));
      const listing = messageForm(
        ISSUER,
        await toolMessage(toolKeys, ISSUER, ctx.clock, { ...common, [`${DL}content_items`]: items }),
      );
      return `a form of ${listing.body.byteLength > MIB / 2 && listing.body.byteLength < MIB ? "more than half a MiB" : "another size"}: ${await refused(() => readDeepLinkingResponse(listing, toolMessageOptions(ctx)))}`;
    },
  },
  /** A Start Assessment message whose form is at the limit with one array of small objects as its token. */
  startAssessment: {
    input: () => undefined,
    read: async () => {
      const ctx = setupPlatform();
      const { claims } = await launch(ctx, {
        ...baseFields,
        messageType: "LtiStartProctoring",
        resourceLink: { id: "exam-1" },
        attemptNumber: 1,
        startAssessmentUrl: START_URL,
      });
      // A base64url payload is 4/3 of its JSON, so 46,000 bytes of `{},` fill a form of 64 KiB with the rest of the token.
      const objects = Array.from({ length: 15_400 }, () => ({}));
      const jwt = await toolMessage(toolKeys, ISSUER, ctx.clock, {
        [`${CLAIM}message_type`]: "LtiStartAssessment",
        [`${CLAIM}version`]: "1.3.0",
        [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
        [`${AP}session_data`]: claims[`${AP}session_data`],
        [`${CLAIM}resource_link`]: { id: "exam-1" },
        [`${AP}attempt_number`]: 1,
        "https://tool.example.com/padding": objects,
      });
      const form = messageForm(START_URL, jwt);
      const read = await readStartAssessment(form, toolMessageOptions(ctx));
      return `a form of ${form.body.byteLength > MAX_FORM_BYTES - 4096 && form.body.byteLength <= MAX_FORM_BYTES ? "almost the limit" : "another size"}, attempt ${read.attemptNumber}`;
    },
  },
  /** A control status just under the limits of bytes and tokens, and an answer far above them. */
  toolControl: {
    input: () => ({
      // Each `{},` is three bytes and three tokens of JSON, so the answer is the most that the limit of 1,000,000 tokens lets in.
      body: encoder.encode(`{"status":"running","list":[${"{},".repeat(OBJECTS - 1)}{}]}`),
      huge: encoder.encode(`{"status":"running","list":[${"{},".repeat(8 * MIB)}{}]}`),
    }),
    read: async ({ body, huge }: { body: Uint8Array<ArrayBuffer>; huge: Uint8Array<ArrayBuffer> }) => {
      const ctx = setup();
      let answer = body;
      const client = await launched(ctx, undefined, {
        fetch: async (url: string, init: Parameters<typeof ctx.platform.fetch>[1]) =>
          url === ACS_URL
            ? new Response(answer, { headers: { "content-type": CONTROL_TYPE } })
            : ctx.platform.fetch(url, init),
        scopes: [SCOPES.assessmentControl],
      });
      const control = {
        user: { issuer: PLATFORM_ISSUER, subject: "a6d5c443" },
        resourceLink: { id: "exam-1" },
        attemptNumber: 1,
        action: "update" as const,
      };
      const first = await client.control(ACS_URL, control);
      answer = huge;
      return `${first.status}; ${await refusedBy("maxBytes", () => client.control(ACS_URL, control))}`;
    },
  },
  /** Login initiations at the limit of repeated and of distinct parameters, and a form far above it. */
  toolLogin: {
    input: () => encoder.encode("a".repeat(64 * MIB)),
    read: async (huge: Uint8Array) => {
      const ctx = setup();
      const post = (body: string | Uint8Array) =>
        request({
          url: LOGIN_URL,
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
      const repeated = repeatedParameters(MAX_INITIATION_BYTES);
      const distinct = distinctParameters(MAX_INITIATION_BYTES);
      const initiations = [
        post(repeated),
        post(distinct),
        post(huge),
        request({ url: `${LOGIN_URL}?${repeated}` }),
        request({ url: `${LOGIN_URL}?${distinct}` }),
      ];
      const refusals: string[] = [];
      for (const initiation of initiations) {
        refusals.push(
          await refused(async () => {
            try {
              await handleLogin(initiation, ctx.options);
            } catch (error) {
              if (error instanceof DataError) throw error;
              throw new Error("A login initiation was refused by something else than a DataError.", { cause: error });
            }
          }),
        );
      }
      return refusals.join("; ");
    },
  },
  /** A preferences record just under the limits of bytes and tokens, and an answer far above them. */
  toolPreferences: {
    input: () => ({
      // Each `{},` is three bytes and three tokens of JSON, so the record is the most that the limit of 1,000,000 tokens lets in.
      body: encoder.encode(`{"list":[${"{},".repeat(OBJECTS - 1)}{}]}`),
      huge: encoder.encode(`{"list":[${"{},".repeat(8 * MIB)}{}]}`),
    }),
    read: async ({ body, huge }: { body: Uint8Array<ArrayBuffer>; huge: Uint8Array<ArrayBuffer> }) => {
      const ctx = setup();
      const lms = new FakeRosterLms(ctx.platform);
      const client = await launched(ctx, undefined, { fetch: lms.fetch, scopes: [SCOPES.preferencesRecordReadonly] });
      lms.answer = () => new Response(body, { headers: { "content-type": "application/json" } });
      const claim = { hostUrl: PNP_HOST, activityIds: ["a"], scopes: [SCOPES.preferencesRecordReadonly] };
      const record = await client.preferences(claim, "ana-1", "a");
      lms.answer = () => new Response(huge, { headers: { "content-type": "application/json" } });
      return `${Array.isArray(record?.list) ? record.list.length : "no"} objects; ${await refusedBy("maxBytes", () => client.preferences(claim, "ana-1", "a"))}`;
    },
  },
  /** A registration with an array just under the limit of an answer, and one of 1 MiB. */
  toolRegister: {
    input: () => ({ under: registered(2_200), over: registered(50_000) }),
    read: async ({ under, over }: { under: string; over: string }) => {
      const initiation = { openidConfiguration: CONFIGURATION_URL };
      let body = under;
      const fetch = async (url: string) =>
        new Response(url === CONFIGURATION_URL ? CONFIGURATION : body, {
          headers: { "content-type": "application/json" },
        });
      const platform = await discoverPlatform(initiation, { fetch });
      const size =
        body.length > MAX_ANSWER_BYTES - 8192 && body.length < MAX_ANSWER_BYTES ? "under the limit" : "of another size";
      const tool = await registerTool(platform, TOOL_CONFIGURATION, initiation, { fetch });
      body = over;
      return `${size}, client ${tool.clientId}; ${await refusedBy("maxBytes", () => registerTool(platform, TOOL_CONFIGURATION, initiation, { fetch }))}`;
    },
  },
  /** A configuration with an array just under the limit of an answer, and one of 1 MiB. */
  toolRegistration: {
    input: () => ({ under: configuration(15_000), over: configuration(270_000) }),
    read: async ({ under, over }: { under: string; over: string }) => {
      let body = under;
      const fetch = async () => new Response(body, { headers: { "content-type": "application/json" } });
      const initiation = { openidConfiguration: CONFIGURATION_URL };
      const platform = await discoverPlatform(initiation, { fetch });
      body = over;
      return `issuer ${platform.issuer}; ${await refusedBy("maxBytes", () => discoverPlatform(initiation, { fetch }))}`;
    },
  },
  /** A page of members just under the limit of tokens, and 1 MiB of empty members, refused at it. */
  toolRoster: {
    input: () => {
      // One member with an extension of empty objects, three bytes and three tokens each: the most that the limit of 1,000,000
      // tokens lets in, which the reader copies.
      const extension = `[${"{},".repeat(329_999)}{}]`;
      const page = `{"id":"${MEMBERSHIPS_URL}","context":{"id":"c"},"members":[{"user_id":"u","roles":[],"https://x.example/e":${extension}}]}`;
      const objects = Math.floor((MIB - 200) / 3);
      const refusedPage = `{"id":"${MEMBERSHIPS_URL}","context":{"id":"c"},"members":[${"{},".repeat(objects - 1)}{}]}`;
      return { page, refusedPage };
    },
    read: async ({ page, refusedPage }: { page: string; refusedPage: string }) => {
      const ctx = setup();
      const lms = new FakeRosterLms(ctx.platform);
      const client = await launched(ctx, undefined, { fetch: lms.fetch, scopes: [SCOPES.contextMembershipReadonly] });
      lms.answer = () => new Response(page, { headers: { "content-type": "application/json" } });
      const members = (await client.members(MEMBERSHIPS_URL)).items.length;
      lms.answer = () => new Response(refusedPage, { headers: { "content-type": "application/json" } });
      return `${members} member; ${await refusedBy("the limit of the option maxTokens", () => client.members(MEMBERSHIPS_URL))}`;
    },
  },
  /** A page of line items just under the limit of tokens, and 1 MiB of empty objects, refused at it. */
  toolServices: {
    input: () => {
      const extension = `[${"{},".repeat(329_999)}{}]`;
      const page = `[{"id":"${CONTAINER_URL}/1","label":"a","scoreMaximum":1,"https://x.example/e":${extension}}]`;
      const objects = Math.floor((MIB - 2) / 3);
      return { page, refusedPage: `[${"{},".repeat(objects - 1)}{}]` };
    },
    read: async ({ page, refusedPage }: { page: string; refusedPage: string }) => {
      const ctx = setup();
      const lms = new FakeLms(ctx.platform);
      const client = await launched(ctx, { claims: { sub: SUBJECT } }, { fetch: lms.fetch, scopes: [SCOPES.lineitem] });
      lms.answer = () => new Response(page, { headers: { "content-type": "application/json" } });
      const items = (await client.lineItems(CONTAINER_URL)).items.length;
      lms.answer = () => new Response(refusedPage, { headers: { "content-type": "application/json" } });
      return `${items} line item; ${await refusedBy("the limit of the option maxTokens", () => client.lineItems(CONTAINER_URL))}`;
    },
  },
} satisfies Record<string, Reading>;
