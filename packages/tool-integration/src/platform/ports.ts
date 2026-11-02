import type { CallOptions } from "@interopkit/core";
import type { MessageInput } from "./messages/input.js";
import type { ToolRegistration } from "./registration.js";

/**
 * Where the platform keeps a launch between the login and the authentication request: one message for at most 300 seconds.
 * The store is shared by every process that serves the platform.
 */
export interface LaunchStore {
  /**
   * Keeps a message under an identifier until a time.
   *
   * @param id - A random identifier of 160 bits, new for each login.
   * @param message - The message, as plain data. It holds no secret, and it holds the personal data of the launch.
   * @param expiresAt - The time in milliseconds since 1970-01-01T00:00:00Z after which the message may be forgotten.
   * @param options - The `signal` of the call.
   */
  put(id: string, message: MessageInput, expiresAt: number, options?: CallOptions): Promise<void>;
  /**
   * Returns the message kept under an identifier and forgets it, atomically: of two calls with one identifier, one gets it.
   *
   * @param id - The identifier of `put`.
   * @param options - The `signal` of the call.
   * @returns The message, or `undefined` when there is none, it was taken, or it expired.
   */
  take(id: string, options?: CallOptions): Promise<MessageInput | undefined>;
}

/**
 * The variables of custom properties (LTI 1.3 Core Appendix B) that the host resolves beyond those that the message answers,
 * such as the dates of a resource link, the course template, group and membership variables and the variables of a vendor.
 */
export interface Substitution {
  /** The names of the variables the host resolves, without the `$`, such as `ResourceLink.available.startDateTime`. */
  readonly names: readonly string[];
  /**
   * Resolves a variable of `names` for a launch.
   *
   * @param name - The name of the variable, without the `$`.
   * @param message - The message of the launch.
   * @param tool - The registration of the tool, whose access to the data the host may weigh.
   * @param options - The `signal` of the call.
   * @returns The value: `""` when the platform has none, and `undefined` to leave the variable unsubstituted, as for one
   * that the tool may not see.
   */
  resolve(
    name: string,
    message: MessageInput,
    tool: ToolRegistration,
    options?: CallOptions,
  ): Promise<string | undefined>;
}
