import { type CallOptions, callPort, DataError } from "@interopkit/core";
import { describe } from "@interopkit/core/checks";
import type { MessageServices, PlatformInstance, ResourceLink } from "../../protocol/index.js";
import type { Substitution } from "../ports.js";
import type { ToolRegistration } from "../registration.js";
import type { MessageInput } from "./input.js";

/** What the variables that the message answers are read from: the message and the instance of the platform. */
interface LaunchView {
  /** The message of the launch. */
  readonly message: MessageInput;
  /** The instance of the platform, from its configuration. */
  readonly instance?: PlatformInstance | undefined;
  /** The claims of the services that the message offers. */
  readonly services?: MessageServices | undefined;
}

/** The resource link of a message, when its type has one. */
function resourceLinkOf({ message }: LaunchView): ResourceLink | undefined {
  return "resourceLink" in message ? message.resourceLink : undefined;
}

/**
 * The variables of LTI 1.3 Core Appendix B that the message answers, each with the value it has in the claims. A variable
 * whose value the message lacks is answered with `""`, which Appendix B gives for a variable that the platform supports and
 * has no value for. `ActualUser` and `ActualPerson` mirror `User` and `Person` for the person acting.
 */
const MESSAGE_VARIABLES: ReadonlyMap<string, (view: LaunchView) => string | number | undefined> = new Map<
  string,
  (view: LaunchView) => string | number | undefined
>([
  ["User.id", ({ message }) => message.user.subject],
  ["User.image", ({ message }) => message.user.picture],
  ["User.scope.mentor", ({ message }) => message.roleScopeMentor?.join(",")],
  ["ActualUser.id", ({ message }) => message.actualUser?.id],
  ["ActualUser.image", ({ message }) => message.actualUser?.picture],
  ["Person.sourcedId", ({ message }) => message.lis?.person_sourcedid],
  ["Person.name.full", ({ message }) => message.user.name],
  ["Person.name.family", ({ message }) => message.user.familyName],
  ["Person.name.given", ({ message }) => message.user.givenName],
  ["Person.name.middle", ({ message }) => message.user.middleName],
  ["Person.email.primary", ({ message }) => message.user.email],
  ["ActualPerson.name.full", ({ message }) => message.actualUser?.name],
  ["ActualPerson.name.family", ({ message }) => message.actualUser?.familyName],
  ["ActualPerson.name.given", ({ message }) => message.actualUser?.givenName],
  ["ActualPerson.name.middle", ({ message }) => message.actualUser?.middleName],
  ["ActualPerson.email.primary", ({ message }) => message.actualUser?.email],
  ["Context.id", ({ message }) => message.context?.id],
  ["Context.type", ({ message }) => message.context?.type?.join(",")],
  ["Context.label", ({ message }) => message.context?.label],
  ["Context.title", ({ message }) => message.context?.title],
  ["CourseOffering.sourcedId", ({ message }) => message.lis?.course_offering_sourcedid],
  ["CourseSection.sourcedId", ({ message }) => message.lis?.course_section_sourcedid],
  ["ResourceLink.id", (view) => resourceLinkOf(view)?.id],
  ["ResourceLink.title", (view) => resourceLinkOf(view)?.title],
  ["ResourceLink.description", (view) => resourceLinkOf(view)?.description],
  ["Message.returnUrl", ({ message }) => message.presentation?.returnUrl],
  ["Message.documentTarget", ({ message }) => message.presentation?.documentTarget],
  ["Message.height", ({ message }) => message.presentation?.height],
  ["Message.width", ({ message }) => message.presentation?.width],
  ["Message.locale", ({ message }) => message.presentation?.locale],
  ["Organization.id", ({ message }) => message.organization?.id],
  ["Organization.type", ({ message }) => message.organization?.type],
  ["Organization.name", ({ message }) => message.organization?.name],
  ["Organization.description", ({ message }) => message.organization?.description],
  ["Organization.url", ({ message }) => message.organization?.url],
  ["ToolPlatform.productFamilyCode", ({ instance }) => instance?.productFamilyCode],
  ["ToolPlatform.version", ({ instance }) => instance?.version],
  ["ToolPlatformInstance.guid", ({ instance }) => instance?.guid],
  ["ToolPlatformInstance.name", ({ instance }) => instance?.name],
  ["ToolPlatformInstance.description", ({ instance }) => instance?.description],
  ["ToolPlatformInstance.url", ({ instance }) => instance?.url],
  ["ToolPlatformInstance.contactEmail", ({ instance }) => instance?.contactEmail],
  // AGS 3.1: the claim of the grade services, whose line item exists only for a single line item of the resource link.
  ["LineItems.url", ({ services }) => services?.grades?.lineitems],
  ["LineItem.url", ({ services }) => services?.grades?.lineitem],
]);

/** What the substitution of a launch needs beside the custom properties. */
export interface SubstitutionCall extends CallOptions {
  /** The message and the instance of the platform. */
  readonly view: LaunchView;
  /** The registration of the tool. */
  readonly tool: ToolRegistration;
  /** The host's variables, when it resolves any. */
  readonly substitution?: Substitution | undefined;
}

/** What a variable resolves to when `substitution.resolve` failed. */
const FAILED = Symbol("failed");

/** Resolves one variable: from the message, from the host, or not at all (`undefined`). */
async function resolveVariable(variable: string, call: SubstitutionCall): Promise<string | undefined | typeof FAILED> {
  const { view, tool, substitution, signal } = call;
  const answer = MESSAGE_VARIABLES.get(variable);
  if (answer !== undefined) return String(answer(view) ?? "");
  if (substitution === undefined || !substitution.names.includes(variable)) return undefined;
  const asked = await callPort(() => substitution.resolve(variable, view.message, tool, { signal }), signal);
  if (asked === undefined) return FAILED;
  const resolved: unknown = asked.value;
  if (resolved !== undefined && typeof resolved !== "string") {
    throw new DataError(
      `The substitution of ${describe(variable)} must resolve with a string or undefined, found ${describe(resolved)}.`,
    );
  }
  return resolved;
}

/**
 * Substitutes the variables of custom properties (LTI 1.3 Core section 5.4.6 and Appendix B): a value that is `$` and the name
 * of a variable becomes its value. The message answers its own variables; a variable that `substitution.names` lists goes to
 * `substitution.resolve`, which may leave it as it is; every other value passes unchanged, which tells the tool that the
 * platform does not support the variable.
 *
 * @param custom - The custom properties of the tool and the message, by name.
 * @param call - The message, the tool, the host's variables and the signal.
 * @returns The custom properties, or `undefined` when `substitution.resolve` failed.
 * @throws `DataError` when `substitution.resolve` gives something other than a string or `undefined`.
 * @throws The `reason` of the signal when it aborts.
 */
export async function substitute(
  custom: Readonly<Record<string, string>>,
  call: SubstitutionCall,
): Promise<Map<string, string> | undefined> {
  const substituted = new Map<string, string>();
  for (const [name, value] of Object.entries(custom)) {
    const resolved = value.startsWith("$") ? await resolveVariable(value.slice(1), call) : undefined;
    if (resolved === FAILED) return undefined;
    substituted.set(name, resolved ?? value);
  }
  return substituted;
}
