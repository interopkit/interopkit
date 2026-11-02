import { type CallOptions, callPort, DataError } from "@interopkit/core";
import { nonEmptyStringSchema, parseWith } from "@interopkit/core/checks";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import * as v from "valibot";
import type { MessageServices } from "../../protocol/index.js";
import type { MessageInput } from "../messages/input.js";
import type { PlatformSettings } from "../options.js";
import type { PlatformServices, ServiceCaller, StorePage } from "../ports.js";

/** A request to a route of a service whose token passed: the request, the parameters of its path, the caller and the store. */
export interface ServiceRequest<TStore> {
  /** The request. */
  readonly request: HttpRequest;
  /** The URL of the request. */
  readonly url: URL;
  /** The parameters of the path, decoded, by name. */
  readonly params: Readonly<Record<string, string>>;
  /** The tool that the access token names. */
  readonly caller: ServiceCaller;
  /** The store of the service. */
  readonly store: TStore;
  /** The options of the handler. */
  readonly settings: PlatformSettings;
}

/** A request to a route before the store of its service is bound to it. */
export type RouteCall = Omit<ServiceRequest<unknown>, "store">;

/** One method of a route: the scopes of which the token needs one, and what answers it. */
interface ServiceMethod<TStore> {
  /** The scopes, any one of which allows the method. */
  readonly scopes: readonly string[];
  /** Answers the request. */
  readonly handle: (call: ServiceRequest<TStore>) => Promise<HttpResponse>;
}

/** A route of a service: its path under the origin, with `{name}` for a parameter, and its methods. */
interface ServiceRoute<TStore> {
  /** The path, such as `/contexts/{context}/line-items`. */
  readonly path: string;
  /** The methods by name. */
  readonly methods: Readonly<Record<string, ServiceMethod<TStore>>>;
}

/** What a service writes its claim from. */
export interface ClaimRequest {
  /** The message. */
  readonly message: MessageInput;
  /** The scopes of the service that the tool's registration grants. */
  readonly granted: readonly string[];
  /** The origin of the platform, under which the URLs of the claim lie. */
  readonly origin: string;
}

/** A service of the platform: the port it needs, its scopes, the claim it writes into a message, and its routes. */
export interface Service<TName extends keyof PlatformServices> {
  /** The name of the store in `PlatformServices`; without it the service is neither offered nor routed. */
  readonly store: TName;
  /** Every scope of the service, which the token endpoint grants when the registration does. */
  readonly scopes: readonly string[];
  /** Writes the claim of the service into the services of a message, or nothing when the message does not ask for it. */
  readonly claim: (request: ClaimRequest) => MessageServices;
  /** The routes. */
  readonly routes: readonly ServiceRoute<NonNullable<PlatformServices[TName]>>[];
}

/** The failure of a store, which the route answers with 500 and nothing of the cause. */
export class StoreFailed extends Error {}

/**
 * Calls the store of a route with the signal of the request.
 *
 * @throws `StoreFailed` when the store rejects, which the route answers with 500.
 * @throws The `reason` of the signal when it aborts.
 */
export async function askStore<T>(call: RouteCall, port: (options: CallOptions) => Promise<T>): Promise<T> {
  const { signal } = call.settings;
  const outcome = await callPort(() => port({ signal }), signal);
  if (outcome === undefined) throw new StoreFailed();
  return outcome.value;
}

/**
 * Reads what a store answered with a reader of the model, and names the store in the error.
 *
 * @remarks
 * A writer takes the types of the model, so a value of another shape fails it with a `TypeError`; that too is a store that breaks
 * its contract.
 *
 * @throws `DataError` that names the store and says what is wrong.
 */
export function fromStore<T>(label: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof DataError || error instanceof TypeError) {
      throw new DataError(`The answer of ${label} breaks its contract: ${error.message}`);
    }
    throw error;
  }
}

/** The members of the page that a store answers, beside which a store may give more. */
export const PAGE_ENTRIES = { items: v.array(v.unknown()), cursor: v.optional(nonEmptyStringSchema) };

const pageSchema = v.object(PAGE_ENTRIES);

/**
 * Reads the frame of a page that a store answered: a list of items, which the caller reads, and the opaque cursor of the next page.
 *
 * @throws `DataError` that names the store when the answer is not a page.
 */
export function readStorePage(label: string, value: unknown): StorePage<unknown> {
  const page = parseWith(pageSchema, value, `The answer of ${label}`);
  return page.cursor === undefined ? { items: page.items } : { items: page.items, cursor: page.cursor };
}
