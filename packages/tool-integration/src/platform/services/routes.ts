import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { MessageServices } from "../../protocol/index.js";
import { methodNotAllowed, serverError } from "../answers.js";
import type { MessageInput } from "../messages/input.js";
import type { PlatformSettings } from "../options.js";
import type { PlatformServices } from "../ports.js";
import type { ToolRegistration } from "../registration.js";
import { authorizeService } from "./access.js";
import { GRADES } from "./grades.js";
import { GROUPS } from "./groups.js";
import { ROSTER } from "./members.js";
import { PREFERENCES } from "./preferences.js";
import { type ClaimRequest, type RouteCall, type Service, StoreFailed } from "./service.js";

/** A route of a service whose store the host gave, with the store bound to its methods. */
interface BoundRoute {
  readonly path: string;
  readonly methods: Readonly<
    Record<string, { readonly scopes: readonly string[]; readonly handle: (call: RouteCall) => Promise<HttpResponse> }>
  >;
}

/** A service whose store the host gave. */
interface BoundService {
  readonly scopes: readonly string[];
  readonly claim: (request: ClaimRequest) => MessageServices;
  readonly routes: readonly BoundRoute[];
}

/** Binds a service to its store, or returns `undefined` when the host gave none. */
function bind<TName extends keyof PlatformServices>(
  service: Service<TName>,
  services: PlatformServices,
): BoundService | undefined {
  const store = services[service.store];
  if (store === undefined) return undefined;
  const routes = service.routes.map((route) => ({
    path: route.path,
    methods: Object.fromEntries(
      Object.entries(route.methods).map(([method, { scopes, handle }]) => [
        method,
        { scopes, handle: (call: RouteCall) => handle({ ...call, store }) },
      ]),
    ),
  }));
  return { scopes: service.scopes, claim: service.claim, routes };
}

/** A service of the platform with the type of its store erased: what the router needs of it. */
interface ListedService {
  readonly claim: BoundService["claim"];
  readonly bind: (services: PlatformServices) => BoundService | undefined;
}

/** Lists a service, so that services with stores of different types are one list. */
function listed<TName extends keyof PlatformServices>(service: Service<TName>): ListedService {
  return { claim: service.claim, bind: (services) => bind(service, services) };
}

/** The services of the platform, one line each. */
const SERVICES: readonly ListedService[] = [listed(GRADES), listed(ROSTER), listed(GROUPS), listed(PREFERENCES)];

/** Returns the services whose store the host gave. */
function boundServices(settings: PlatformSettings): BoundService[] {
  return SERVICES.flatMap((service) => service.bind(settings.services ?? {}) ?? []);
}

/** Returns the scopes that the services of the platform offer: those of every service whose store the host gave. */
export function offeredScopes(settings: PlatformSettings): readonly string[] {
  return boundServices(settings).flatMap((service) => service.scopes);
}

/**
 * Returns the claims of the services that a message asks for and the platform offers, with the scopes of each that the
 * registration grants.
 */
export function serviceClaims(
  message: MessageInput,
  tool: ToolRegistration,
  settings: PlatformSettings,
): MessageServices {
  const claims = boundServices(settings).map((service) => {
    const granted = service.scopes.filter((scope) => tool.scopes.includes(scope));
    return service.claim({ message, granted, origin: settings.config.origin });
  });
  return Object.assign({}, ...claims);
}

/**
 * Returns the claims of the services that a message asks for, whichever stores the host gives, with no scope: what the rules
 * of the sender are checked against before the message is kept.
 */
export function requestedClaims(message: MessageInput, origin: string): MessageServices {
  return Object.assign({}, ...SERVICES.map((service) => service.claim({ message, granted: [], origin })));
}

/** Returns the parameters of a path that matches a route, decoded, or `undefined` when it does not match. */
function matchPath(pattern: string, pathname: string): Record<string, string> | undefined {
  const wanted = pattern.split("/");
  const given = pathname.split("/");
  if (wanted.length !== given.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, part] of wanted.entries()) {
    const segment = given[index] ?? "";
    if (!part.startsWith("{")) {
      if (segment !== part) return undefined;
      continue;
    }
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      // A segment that is not percent-encoded UTF-8 names nothing.
      return undefined;
    }
    if (value === "") return undefined;
    params[part.slice(1, -1)] = value;
  }
  return params;
}

/** Finds the route of a service whose store the host gave that a path names, with the parameters of the path. */
function findRoute(
  services: readonly BoundService[],
  pathname: string,
): { readonly route: BoundRoute; readonly params: Record<string, string> } | undefined {
  for (const service of services) {
    for (const route of service.routes) {
      const params = matchPath(route.path, pathname);
      if (params !== undefined) return { route, params };
    }
  }
  return undefined;
}

/**
 * Answers a request to a route of a service: the method (405 with `Allow`), the access token (401 and 403, checked against the
 * registration again), then the route. A store that rejects is 500; one that breaks its contract throws `DataError`. Returns
 * `undefined` when no route of a service whose store the host gave matches.
 */
export async function answerService(
  request: HttpRequest,
  url: URL,
  settings: PlatformSettings,
): Promise<HttpResponse | undefined> {
  const found = findRoute(boundServices(settings), url.pathname);
  if (found === undefined) return undefined;
  const { route, params } = found;
  const method = Object.hasOwn(route.methods, request.method) ? route.methods[request.method] : undefined;
  if (method === undefined) return methodNotAllowed(request.method, Object.keys(route.methods).join(", "));
  const caller = await authorizeService(request, settings, method.scopes);
  if ("status" in caller) return caller;
  try {
    return await method.handle({ request, url, params, caller, settings });
  } catch (error) {
    if (error instanceof StoreFailed) return serverError();
    throw error;
  }
}
