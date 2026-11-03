import type { IssuableCredential } from "@interopkit/achievement-credentials";
import {
  addProof,
  deriveDisclosure,
  type SigningCryptosuite,
  verifyProof,
} from "@interopkit/achievement-credentials/data-integrity";
import { verifyCredentialStatus } from "@interopkit/achievement-credentials/status";
import type { VerifyOptions } from "@interopkit/achievement-credentials/verify";
import { DataError, type Random, type Signer } from "@interopkit/core";
import { isRecord } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpRequest, type HttpResponse, readJson } from "@interopkit/core/http";
import type { SigningAlgorithm } from "./keys.ts";
import { createStatusLists, dateTimeOf, type StatusLists, type StatusPurpose } from "./status-lists.ts";

/** An issuer that the service issues credentials for. */
export interface VcApiIssuer {
  /** The `id` of the issuer: a credential it issues names this. */
  readonly id: string;
  /** The algorithm of its key: `EdDSA` signs `eddsa-rdfc-2022`, and `ES256` signs `ecdsa-sd-2023`. */
  readonly algorithm: SigningAlgorithm;
  /** Signs, and names the verification method of the key. */
  readonly signer: Signer;
  /**
   * The purpose of the status entry that the issuer gives each credential that has none.
   *
   * @defaultValue none: credentials get no entry
   */
  readonly status?: StatusPurpose;
}

/** What the service is built from. */
export interface VcApiConfig {
  /** The address the service answers at, without a trailing slash: the status lists are below it. */
  readonly origin: string;
  /** The issuers, by the name that their paths carry. */
  readonly issuers: Readonly<Record<string, VcApiIssuer>>;
  /** The options of every verification: the keys, the clock, the contexts and the `fetch` that reaches status lists. */
  readonly verify: VerifyOptions & Required<Pick<VerifyOptions, "contexts" | "fetch">>;
  /** Picks the index of a status entry. */
  readonly random: Random;
}

/** The service: one handler for the routes below. */
export interface VcApi {
  /** Answers a request, as a route of a web framework would. */
  handle(request: HttpRequest): Promise<HttpResponse>;
}

/** What the routes share. */
interface Service {
  readonly config: VcApiConfig;
  readonly listsOf: (name: string, issuer: VcApiIssuer) => StatusLists;
}

/** The cryptosuite that a key signs: Ed25519 signs `eddsa-rdfc-2022` and P-256 `ecdsa-sd-2023`. */
function suiteOf(issuer: VcApiIssuer): SigningCryptosuite {
  return issuer.algorithm === "EdDSA" ? "eddsa-rdfc-2022" : "ecdsa-sd-2023";
}

/** The error body of the API: what failed, for each cause. */
function failure(status: number, message: string, name = "Error"): HttpResponse {
  return buildJsonResponse(status, { errors: [{ name, message }] });
}

/** Reads the body as a JSON object with the object that the operation needs, and returns both. */
function bodyWith(
  request: HttpRequest,
  property: string,
): { readonly options: Record<string, unknown>; readonly value: Record<string, unknown> } {
  const body = readJson(request);
  const value = isRecord(body) ? body[property] : undefined;
  if (!isRecord(body) || !isRecord(value)) {
    throw new DataError(`The body must be an object with the object ${property}.`);
  }
  return { options: isRecord(body.options) ? body.options : {}, value };
}

/** The refusal of an issue request that asks for what the issuer does not offer, or `undefined`. */
function unsupported(issuer: VcApiIssuer, options: Record<string, unknown>): string | undefined {
  if (options.type !== undefined && options.type !== "DataIntegrityProof") {
    return `The proof type ${String(options.type)} is not offered; the type is DataIntegrityProof.`;
  }
  if (options.cryptosuite !== undefined && options.cryptosuite !== suiteOf(issuer)) {
    return `The key of this issuer signs ${suiteOf(issuer)}, not ${String(options.cryptosuite)}.`;
  }
  return undefined;
}

/** Issues the credential of the request: names this issuer, takes a status entry when the issuer gives them, and signs. */
async function issue(service: Service, request: HttpRequest, name: string): Promise<HttpResponse> {
  const issuer = service.config.issuers[name];
  if (issuer === undefined) return failure(404, `There is no issuer ${name}.`);
  const { options, value } = bodyWith(request, "credential");
  const refusal = unsupported(issuer, options);
  if (refusal !== undefined) return failure(400, refusal);
  const credential = structuredClone(value);
  const named = isRecord(credential.issuer) ? credential.issuer.id : credential.issuer;
  if (named !== issuer.id) return failure(400, `The credential must name the issuer ${issuer.id}.`);
  // Open Badges asks every credential for the time it becomes valid, which the API leaves to the issuer to fill in.
  credential.validFrom ??= dateTimeOf(service.config.verify.clock.now());
  if (issuer.status !== undefined && credential.credentialStatus === undefined) {
    credential.credentialStatus = service.listsOf(name, issuer).allocate(issuer.status);
  }
  const { mandatoryPointers } = options;
  const signed = await addProof(credential as unknown as IssuableCredential, issuer.signer, {
    cryptosuite: suiteOf(issuer),
    ...(Array.isArray(mandatoryPointers) ? { mandatoryPointers: mandatoryPointers as string[] } : {}),
    contexts: service.config.verify.contexts,
    clock: service.config.verify.clock,
  });
  return buildJsonResponse(201, signed);
}

/** Derives a disclosure of the credential of the request, revealing the pointers it selects. */
async function derive(service: Service, request: HttpRequest): Promise<HttpResponse> {
  const { options, value } = bodyWith(request, "verifiableCredential");
  const { selectivePointers } = options;
  const disclosed = await deriveDisclosure(value as unknown as IssuableCredential, {
    selectivePointers: Array.isArray(selectivePointers) ? (selectivePointers as string[]) : [],
    contexts: service.config.verify.contexts,
  });
  return buildJsonResponse(201, disclosed);
}

/** Serves the status list credential of an issuer: a Data Integrity proof for a key that signs it, and a JWS otherwise. */
async function statusList(service: Service, name: string, purpose: string): Promise<HttpResponse> {
  const { origin, verify, issuers } = service.config;
  const issuer = issuers[name];
  if (issuer === undefined) return failure(404, `There is no issuer ${name}.`);
  const address = `${origin}/issuers/${name}/status/${purpose}/1`;
  const proof = issuer.algorithm === "EdDSA" ? "data-integrity" : "jwt";
  const list = await service
    .listsOf(name, issuer)
    .credentialAt(address, issuer.signer, { proof, contexts: verify.contexts, clock: verify.clock });
  if (list === undefined) return failure(404, "There is no such status list.");
  return typeof list === "string"
    ? { status: 200, headers: { "content-type": "application/jwt" }, body: list }
    : buildJsonResponse(200, list, { type: "application/ld+json" });
}

/** The checks of the API that the service offers, each by a function of the package. */
const CHECKS: readonly unknown[] = ["proof", "credentialStatus"];

/** Runs the checks that the request names, one by one, and returns the ones that passed and an error for each that did not. */
async function checksOf(
  service: Service,
  credential: Record<string, unknown>,
  names: readonly unknown[],
): Promise<{ passed: string[]; errors: { name: string; message: string }[] }> {
  const { keys, clock, contexts, fetch, allowUnboundKeys = false } = service.config.verify;
  const passed: string[] = [];
  const errors: { name: string; message: string }[] = [];
  if (names.includes("proof")) {
    const proof = await verifyProof(credential as unknown as IssuableCredential, {
      keys,
      clock,
      contexts,
      allowUnboundKeys,
    });
    if (proof.valid) passed.push("proof");
    else errors.push({ name: "proof", message: proof.reason });
  }
  if (names.includes("credentialStatus")) {
    const status = await verifyCredentialStatus(credential as unknown as IssuableCredential, {
      fetch,
      keys,
      clock,
      contexts,
      allowUnboundKeys,
    });
    // A credential that names no status list has nothing to check, which is no failure.
    if (status.outcome === "passed" || status.outcome === "skipped") passed.push("credentialStatus");
    else errors.push({ name: "credentialStatus", message: status.detail });
  }
  return { passed, errors };
}

/** Verifies the credential of the request: the checks it names, or every check that the service offers. */
async function check(service: Service, request: HttpRequest): Promise<HttpResponse> {
  const { options, value } = bodyWith(request, "verifiableCredential");
  const names = options.checks ?? CHECKS;
  if (!Array.isArray(names) || names.length === 0 || names.some((name) => !CHECKS.includes(name))) {
    return failure(
      400,
      `The checks must be a list of ${CHECKS.join(" and ")}, found ${JSON.stringify(options.checks)}.`,
    );
  }
  const { passed, errors } = await checksOf(service, value, names);
  return buildJsonResponse(errors.length === 0 ? 200 : 400, {
    verified: errors.length === 0,
    checks: passed,
    warnings: [],
    errors,
  });
}

/** A route: its method, the path it matches, and what runs for the name and the purpose that the path carries. */
interface Route {
  readonly method: "GET" | "POST";
  readonly pattern: RegExp;
  readonly run: (service: Service, request: HttpRequest, name: string, purpose: string) => Promise<HttpResponse>;
}

/** The VC-API operations below a role and a name, and the status lists below an issuer. */
const ROUTES: readonly Route[] = [
  { method: "POST", pattern: /^\/issuers\/([^/]+)\/credentials\/issue$/u, run: issue },
  {
    method: "POST",
    pattern: /^\/verifiers\/([^/]+)\/credentials\/verify$/u,
    run: (service, request) => check(service, request),
  },
  {
    method: "POST",
    pattern: /^\/holders\/([^/]+)\/credentials\/derive$/u,
    run: (service, request) => derive(service, request),
  },
  {
    method: "GET",
    pattern: /^\/issuers\/([^/]+)\/status\/(revocation|suspension)\/1$/u,
    run: (service, _request, name, purpose) => statusList(service, name, purpose),
  },
];

/**
 * Makes a service that speaks the VC-API over the functions of the package: it issues a credential with a Data Integrity proof,
 * verifies one, derives a disclosure from an `ecdsa-sd-2023` base proof, and serves the status lists it fills. It is what a
 * conformance suite of the W3C reaches over HTTP, and what a host that already runs a VC-API wraps its issuer in.
 */
export function createVcApi(config: VcApiConfig): VcApi {
  const lists = new Map<string, StatusLists>();
  const service: Service = {
    config,
    listsOf(name, issuer) {
      const held =
        lists.get(name) ??
        createStatusLists({
          issuer: issuer.id,
          base: `${config.origin}/issuers/${name}/status`,
          clock: config.verify.clock,
          random: config.random,
        });
      lists.set(name, held);
      return held;
    },
  };
  return {
    async handle(request) {
      const { pathname } = new URL(request.url);
      const found = ROUTES.map((route) => ({ route, matched: route.pattern.exec(pathname) })).find(
        ({ matched }) => matched !== null,
      );
      if (found?.matched == null) return failure(404, "There is no such route.");
      const { route, matched } = found;
      if (request.method !== route.method) return { status: 405, headers: { allow: route.method }, body: "" };
      try {
        return await route.run(service, request, matched[1] ?? "", matched[2] ?? "");
      } catch (error) {
        if (error instanceof DataError) return failure(400, error.message, "DataError");
        throw error;
      }
    },
  };
}
