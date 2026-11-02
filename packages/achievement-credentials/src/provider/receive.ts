import { DataError } from "@interopkit/core";
import { isRecord, MAX_JSON_DEPTH } from "@interopkit/core/checks";
import { type HttpRequest, type HttpResponse, readText } from "@interopkit/core/http";
import * as v from "valibot";
import { parseJsonText } from "../json-text.js";
import { credentialInJws } from "../jwt/internal.js";
import type { AnyVerifiableCredential, CredentialApi, CredentialKind, VerificationResult } from "../model/index.js";
import { readCredential } from "../read/index.js";
import { jws } from "../read/internal.js";
import { kindOf } from "../verify/internal.js";
import { bodyTypeOf } from "./body.js";
import type { ProviderSettings } from "./options.js";
import { invalidData, unreadable } from "./status.js";
import type { ReceivedCredential } from "./store.js";

/** The media type of a credential signed as a VC-JWT, sent as its compact JWS (OB 6.2.3.1). */
const JWS_TYPE = "text/plain";

/** The media types of a credential sent as JSON (OB 6.2.3.1). */
const JSON_TYPES: readonly string[] = ["application/json", "application/vc+ld+json"];

/** The class of credential that each API exchanges, which `readCredential` reads a body as. */
const KINDS: Readonly<Record<CredentialApi, CredentialKind>> = {
  badges: "AchievementCredential",
  clr: "ClrCredential",
};

/** The kind of credential, as `kindOf` names it, that each API exchanges. */
const VERIFIED_KINDS = { badges: "badge", clr: "clr" } as const;

/** What the body of a request to upsert a credential gave: the credential with the answer that repeats it, or a refusal. */
export type Reception =
  | {
      /** The credential, as it came and in the model. */
      readonly credential: ReceivedCredential;
      /** The body of a 200 or 201: the credential of the request, in its media type (OB 6.2.3.2). */
      readonly echo: { readonly type: string; readonly text: string };
    }
  | {
      /** The answer that refuses the request. */
      readonly refusal: HttpResponse;
    };

/** The text of the body, or the refusal of a body that is not UTF-8. */
function textOf(request: HttpRequest): { readonly text: string } | { readonly refusal: HttpResponse } {
  try {
    return { text: readText(request) };
  } catch (error) {
    return { refusal: unreadable(error instanceof DataError ? error.message : "The body is not UTF-8 text.") };
  }
}

/** Says which credential the result of a verification failed on, and its first check that did not pass. */
function faultOf(result: VerificationResult): string {
  const check =
    result.checks.find(({ outcome }) => outcome === "failed") ??
    result.checks.find(({ outcome }) => outcome === "unavailable");
  if (check !== undefined) {
    return `the ${check.check} check ${check.outcome === "failed" ? "failed" : "could not be made"}: ${check.detail}`;
  }
  // Every check passed or did not apply, so an endorsement or a credential that a CLR holds did not verify.
  const endorsement = result.endorsements.find(({ verified }) => !verified);
  if (endorsement !== undefined) return `an endorsement does not verify, as ${faultOf(endorsement)}`;
  const held = result.nested.find(({ verified }) => !verified);
  return held === undefined
    ? "a part of it does not verify"
    : `a credential that it holds does not verify, as ${faultOf(held)}`;
}

/** The signal that ends a verification: the provider's, the one in the options of the verifier, or either. */
function signalOf(settings: ProviderSettings): AbortSignal | undefined {
  const signals = [settings.signal, settings.verify?.signal].filter((signal) => signal !== undefined);
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}

/**
 * Verifies a credential with the options of the host, and says why it is refused when it does not verify. The verifier loads
 * on the first use, so that a provider that does not verify never loads what it needs.
 */
async function verificationFault(received: string | object, settings: ProviderSettings): Promise<string | undefined> {
  if (settings.verify === undefined) return undefined;
  const { verifyCredential } = await import("../verify/index.js");
  const signal = signalOf(settings);
  // The refresh service is not followed: the store keeps the credential that the request carried, not a newer one.
  const result = await verifyCredential(received, {
    ...settings.verify,
    refresh: false,
    ...(signal ? { signal } : {}),
  });
  return result.verified ? undefined : `The credential does not verify: ${faultOf(result)}.`;
}

/** Reads the credential of the body: a compact JWS for `text/plain`, a JSON object for the JSON types. */
function credentialOfBody(
  request: HttpRequest,
  type: string,
  settings: ProviderSettings,
):
  | {
      readonly received: string | Readonly<Record<string, unknown>>;
      readonly credential: AnyVerifiableCredential;
      readonly text: string;
    }
  | { readonly refusal: HttpResponse } {
  const body = textOf(request);
  if ("refusal" in body) return body;
  const { text } = body;
  if (type === JWS_TYPE) {
    if (!v.is(jws, text)) {
      return {
        refusal: unreadable("The body of text/plain must be a compact JWS: three parts of base64url characters."),
      };
    }
    const carried = credentialInJws(text, settings.maxTokens);
    return "reason" in carried
      ? { refusal: invalidData(carried.reason) }
      : { received: text, credential: carried.value, text };
  }
  // The tokens and the levels are counted on the text that was decoded once, before the parser builds anything.
  const parsed = parseJsonText(text, { maxDepth: MAX_JSON_DEPTH, maxTokens: settings.maxTokens }, "The body");
  if ("reason" in parsed) return { refusal: unreadable(parsed.reason) };
  const json = parsed.value;
  if (!isRecord(json)) return { refusal: invalidData("The body must be a credential as a JSON object.") };
  try {
    return { received: json, credential: readCredential(json, { kind: KINDS[settings.api] }), text };
  } catch (error) {
    return { refusal: invalidData(error instanceof DataError ? error.message : "The body is not a credential.") };
  }
}

/**
 * Reads the credential that a request to upsert carries, checks that it is a credential of the kind the API exchanges and,
 * when the host asks for it, that it verifies.
 *
 * @returns The credential and the answer that repeats it, or the answer that refuses the request.
 * @throws The reason of the signal when it aborts during the verification.
 */
export async function receiveCredential(request: HttpRequest, settings: ProviderSettings): Promise<Reception> {
  const body = bodyTypeOf(request, settings, [...JSON_TYPES, JWS_TYPE]);
  if ("refusal" in body) return body;
  const read = credentialOfBody(request, body.type, settings);
  if ("refusal" in read) return read;
  const kind = kindOf(read.credential);
  if (kind !== VERIFIED_KINDS[settings.api]) {
    const name =
      settings.api === "badges"
        ? "the Open Badges API takes an AchievementCredential"
        : "the CLR API takes a ClrCredential";
    return { refusal: invalidData(`The credential is of the type ${read.credential.type.join(", ")}, and ${name}.`) };
  }
  const fault = await verificationFault(read.received, settings);
  if (fault !== undefined) return { refusal: invalidData(fault) };
  return {
    credential: { received: read.received, credential: read.credential },
    echo: { type: body.type, text: read.text },
  };
}
