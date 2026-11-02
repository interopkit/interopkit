// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { afterEach, describe, expect, it, vi } from "vitest";
import { SCOPES } from "../src/index.js";
import { createRegistrationInitiation, toToolRegistration } from "../src/platform/index.js";
import { createTool, launch } from "./references-lti-tool.js";
import {
  CLOCK,
  connect,
  createReferencePlatform,
  createRegistrations,
  type Handler,
  PLATFORM,
  type ReferencePlatform,
  referenceTool,
  resourceLinkMessage,
  TOOL,
} from "./references-setup.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const DEPLOYMENT = "dynamic-deployment-1";
const REGISTRATION = {
  url: TOOL,
  name: "Reference tool",
  jwksUri: `${TOOL}/lti/jwks`,
  loginUri: `${TOOL}/lti/login`,
  launchUri: `${TOOL}/lti/launch`,
};

/** A platform that serves Dynamic Registration and a tool that knows no platform, which reach each other through the network. */
async function createWorld() {
  const systems: Record<string, Handler> = {};
  const network = connect(systems);
  const registrations = createRegistrations(DEPLOYMENT);
  const platform: ReferencePlatform = await createReferencePlatform({
    algorithm: "RS256",
    tool: referenceTool({ clientId: "registered-by-hand" }),
    registrations: registrations.store,
    fetch: network.fetch,
  });
  const { tool, handler, storage } = await createTool(platform, REGISTRATION);
  systems[PLATFORM] = platform.handle;
  systems[TOOL] = handler;
  return { platform, tool, storage, registrations };
}

/** The steps of the tool's administrator: it opens the initiation URL of the platform and asks for the services. */
async function register(world: Awaited<ReturnType<typeof createWorld>>, token?: string): Promise<string> {
  const initiation = new URL(
    await createRegistrationInitiation(`${TOOL}/lti/register`, { config: world.platform.options.config, clock: CLOCK }),
  );
  const form = await world.tool.initiateDynamicRegistration(
    {
      openid_configuration: initiation.searchParams.get("openid_configuration") ?? "",
      registration_token: token ?? initiation.searchParams.get("registration_token") ?? "",
    },
    "/lti/register",
  );
  const sessionToken = /name="sessionToken" value="([^"]*)"/u.exec(form)?.[1] ?? "";
  return world.tool.completeDynamicRegistration({ sessionToken, services: ["ags", "nrps", "deep_linking"] });
}

describe("@lti-tool/core registers itself through Dynamic Registration", () => {
  it("records the tool at the platform and the platform at the tool, and then the platform launches it", async () => {
    const setup = await createWorld();
    const page = await register(setup);
    expect(page).toContain("Registration Successful");

    const [registered] = [...setup.registrations.registered.values()];
    expect(registered?.configuration).toMatchObject({
      clientName: "Reference tool",
      jwksUri: `${TOOL}/lti/jwks`,
      initiateLoginUri: `${TOOL}/lti/login`,
      tokenEndpointAuthMethod: "private_key_jwt",
    });
    expect(registered?.configuration.redirectUris).toContain(`${TOOL}/lti/launch`);
    expect(registered?.configuration.scope?.split(" ")).toEqual(
      expect.arrayContaining([SCOPES.lineitem, SCOPES.resultReadonly, SCOPES.score, SCOPES.contextMembershipReadonly]),
    );

    const [client] = await setup.tool.listClients();
    expect(client).toMatchObject({
      iss: PLATFORM,
      clientId: registered?.clientId,
      jwksUrl: setup.platform.endpoints.jwks,
      authUrl: setup.platform.endpoints.authorization,
      tokenUrl: setup.platform.endpoints.token,
    });
    expect((await setup.tool.listDeployments(client?.id ?? "")).map((deployment) => deployment.deploymentId)).toEqual([
      DEPLOYMENT,
    ]);

    // The administrator of the platform reviews the registration and activates it with the scopes and the deployment.
    if (registered === undefined) throw new Error("No registration.");
    setup.platform.tools.set(
      registered.clientId,
      toToolRegistration(registered, {
        scopes: [SCOPES.lineitemReadonly, SCOPES.score],
        deploymentIds: [DEPLOYMENT],
      }),
    );
    const { session } = await launch(
      setup.platform,
      setup.tool,
      resourceLinkMessage({ clientId: registered.clientId, deploymentId: DEPLOYMENT }),
    );
    expect(session.platform).toMatchObject({
      issuer: PLATFORM,
      clientId: registered.clientId,
      deploymentId: DEPLOYMENT,
    });
    expect(session.services?.ags?.scopes).toEqual([SCOPES.lineitemReadonly, SCOPES.score]);
  });

  it("refuses a second registration with the token of the first", async () => {
    const setup = await createWorld();
    const initiation = new URL(
      await createRegistrationInitiation(`${TOOL}/lti/register`, {
        config: setup.platform.options.config,
        clock: CLOCK,
      }),
    );
    const token = initiation.searchParams.get("registration_token") ?? "";
    expect(await register(setup, token)).toContain("Registration Successful");
    await expect(register(setup, token)).rejects.toThrow("used");
    expect(setup.registrations.registered.size).toBe(1);
  });

  it("refuses a registration without a token", async () => {
    const setup = await createWorld();
    await expect(register(setup, "not-a-token-of-this-platform")).rejects.toThrow("invalid_token");
    expect(setup.registrations.registered.size).toBe(0);
  });
});
