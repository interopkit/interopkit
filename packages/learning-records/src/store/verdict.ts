import { DataError } from "@interopkit/core";
import type { HttpRequest } from "@interopkit/core/http";
import { MultipartLimitError } from "../attachments/index.js";
import type { LrsSettings } from "./options.js";
import type { Access } from "./ports.js";
import type { Refuse } from "./status.js";

/** A request that is refused: the status and the sentence that says why. */
export interface Refusal {
  readonly status: number;
  readonly message: string;
}

/** What a step of a request gave: its value, or the refusal that ends the request. */
export type Verdict<T> = { readonly value: T } | Refusal;

/** Tells whether a verdict is a refusal. */
export function isRefusal<T>(verdict: Verdict<T>): verdict is Refusal {
  return "status" in verdict;
}

/** Refuses a request. */
export function refused(status: number, message: string): Refusal {
  return { status, message };
}

/**
 * Runs a reader of the request: a `DataError` that it throws is the request's fault and is refused with 400, and a multipart
 * message over a limit with 413 (4.1.5).
 */
export function attempt<T>(read: () => T): Verdict<T> {
  try {
    return { value: read() };
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    return refused(error instanceof MultipartLimitError ? 413 : 400, error.message);
  }
}

/** The access of a request that is allowed. */
type GrantedAccess = Extract<Access, { readonly allowed: true }>;

/** What a resource handler needs of a request. */
export interface Context {
  readonly request: HttpRequest;
  readonly settings: LrsSettings;
  readonly access: GrantedAccess;
  readonly refuse: Refuse;
}
