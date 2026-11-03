import { type CallOptions, type Clock, type Fetch, SYSTEM_CLOCK } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { CourseStructure } from "@interopkit/course-launch";
import {
  abandonSession,
  createRegistration,
  extendLrsOptions,
  handleFetchRequest,
  type ImportedCourse,
  importCourse,
  type Launch,
  type LaunchInput,
  type LmsOptions,
  prepareLaunch,
  type Registration,
  waiveAu,
} from "@interopkit/course-launch/lms";
import { createMemoryDocuments } from "@interopkit/example-learning-records/src/documents.ts";
import { createMemoryStatements, type MemoryStatements } from "@interopkit/example-learning-records/src/statements.ts";
import type { Actor, Agent } from "@interopkit/learning-records";
import { createLrsClient, type LrsClient } from "@interopkit/learning-records/client";
import {
  type Access,
  handleLrsRequest,
  type LrsAction,
  readBasicAuthorization,
} from "@interopkit/learning-records/store";
import { createMemoryCmi5Store, type MemoryCmi5Store } from "./stores.ts";

/** A credential of the host: its user and password, the authority of what it writes, and what it may do. */
interface Credential {
  readonly user: string;
  readonly password: string;
  readonly authority: Actor;
  readonly actions: readonly LrsAction[];
}

/** What the host sets for the example LMS. */
export interface LmsConfig {
  /** The address of the LMS, such as `https://lms.campus.example`: its LRS is at `/xapi/` and its fetch URL at `/fetch`. */
  readonly origin: string;
  /** The password of the LMS's own credential, which writes the launch data and the statements of the LMS. */
  readonly lmsPassword: string;
  /** The password of the administrator, who reads every record of every learner (4.2). */
  readonly adminPassword: string;
  /** @defaultValue the system clock */
  readonly clock?: Clock;
  /** @defaultValue `crypto.randomUUID` */
  readonly newId?: () => string;
}

/** The example LMS: its handler, the functions a host calls, and what a report reads. */
export interface Lms {
  /** Answers the requests of the LRS below `/xapi/` and of the fetch URL at `/fetch`. */
  readonly handle: (request: HttpRequest, options?: CallOptions) => Promise<HttpResponse>;
  /** A `fetch` that reaches the handler in the same process. */
  readonly fetch: Fetch;
  /** The options of the LMS role. */
  readonly options: LmsOptions;
  /** The store of courses, registrations and sessions. */
  readonly store: MemoryCmi5Store;
  /** The Statements that the LRS holds, for a report. */
  readonly statements: MemoryStatements;
  /** The `Authorization` of the administrator, who reads everything. */
  readonly adminAuthorization: string;
  /** Imports a course structure and keeps it. */
  readonly importCourse: (structure: CourseStructure, courseId: string, contentBase?: string) => ImportedCourse;
  readonly register: (courseId: string, actor: Agent, registration?: string) => Promise<Registration>;
  readonly launch: (input: LaunchInput) => Promise<Launch>;
  readonly abandon: (session: string) => Promise<"abandoned" | "already-ended">;
  readonly waive: (registration: string, au: string, reason: string) => Promise<"waived" | "already-waived">;
}

/** The namespace of the ids that the LMS makes, the same at every start, so that a course imported again keeps its ids. */
const ID_NAMESPACE = "4a8f0c2e-5b1d-4e7a-9c3f-2d6e8b0a1c4f";

/** Every action, for the LMS's own credential and the administrator. */
const ALL: readonly LrsAction[] = [
  "statements.read",
  "statements.write",
  "state.read",
  "state.write",
  "profiles.read",
  "profiles.write",
  "activities.read",
  "agents.read",
];

/** Whether two secrets are equal, in time that does not depend on where they differ. */
function sameSecret(given: string, expected: string): boolean {
  const [a, b] = [new TextEncoder().encode(given), new TextEncoder().encode(expected)];
  let difference = a.length ^ b.length;
  for (const [index, byte] of b.entries()) difference |= byte ^ (a[index] ?? 0);
  return difference === 0;
}

/** Builds a plain request from the arguments of a `fetch`, with header names in lower case as the handlers read them. */
function requestOf(url: string, init: Parameters<Fetch>[1]): HttpRequest {
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array());
  return {
    method: init.method,
    url,
    headers: Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value])),
    body,
  };
}

/** The Basic `Authorization` of a credential. */
function basic({ user, password }: Pick<Credential, "user" | "password">): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

/**
 * Creates the example LMS: the campus LRS in memory made the LRS of cmi5 by `extendLrsOptions`, a store of records in memory,
 * the LMS's own client of xAPI in the same process, and the fetch URL.
 */
export function createLms(config: LmsConfig): Lms {
  const { origin, clock = SYSTEM_CLOCK } = config;
  const statements = createMemoryStatements(clock);
  const documents = createMemoryDocuments();
  const store = createMemoryCmi5Store();
  const credentials: readonly Credential[] = [
    {
      user: "lms",
      password: config.lmsPassword,
      authority: { account: { homePage: origin, name: "lms" } },
      actions: ALL,
    },
    {
      user: "admin",
      password: config.adminPassword,
      authority: { account: { homePage: origin, name: "admin" } },
      actions: ALL,
    },
  ];

  // The host's own credentials: About for anyone, the LMS and the administrator for everything, and no one else. A refusal
  // carries no challenge, since the pages of units call the LRS from a browser, which would ask the learner for a password.
  const access = async (request: HttpRequest): Promise<Access> => {
    if (new URL(request.url).pathname === "/xapi/about")
      return { allowed: true, authority: credentials[0]?.authority ?? {}, actions: [] };
    const given = readBasicAuthorization(request);
    const known = credentials.find(
      ({ user, password }) =>
        given !== undefined && sameSecret(given.user, user) && sameSecret(given.password, password),
    );
    if (known === undefined) {
      return { allowed: false, status: 401, reason: "Send a credential of the LMS." };
    }
    return { allowed: true, authority: known.authority, actions: known.actions };
  };

  // The client of the LMS reaches the handler below, which exists by the time the client makes its first request.
  const fetch: Fetch = async (url, init) => {
    if (new URL(url).origin !== origin) throw new TypeError(`Nothing answers at ${new URL(url).origin}.`);
    const response = await handle(requestOf(url, init), { signal: init.signal });
    return new Response(response.body.length === 0 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
  const records: LrsClient = createLrsClient({
    endpoint: `${origin}/xapi/`,
    version: "1.0.3",
    fetch,
    authorization: async () => basic(credentials[0] ?? { user: "", password: "" }),
  });
  const options: LmsOptions = {
    store,
    records,
    endpoint: `${origin}/xapi/`,
    fetchEndpoint: `${origin}/fetch`,
    authority: { account: { homePage: origin, name: "assignable-units" } },
    clock,
    ...(config.newId === undefined ? {} : { newId: config.newId }),
  };
  const lrsOptions = extendLrsOptions(
    { statements: statements.statements, documents, activities: statements.activities, access, clock },
    options,
  );
  const handle: Lms["handle"] = (request, call) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/fetch") return handleFetchRequest(request, { ...options, ...call });
    return handleLrsRequest(request, { ...lrsOptions, ...call });
  };

  return {
    handle,
    fetch,
    options,
    store,
    statements,
    adminAuthorization: basic({ user: "admin", password: config.adminPassword }),
    importCourse: (structure, courseId, contentBase) => {
      const course = importCourse(structure, {
        courseId,
        idBase: `${origin}/activities/`,
        idNamespace: ID_NAMESPACE,
        ...(contentBase === undefined ? {} : { contentBase }),
      });
      store.addCourse(course);
      return course;
    },
    register: (courseId, actor, registration) =>
      createRegistration({ courseId, actor, ...(registration === undefined ? {} : { registration }) }, options),
    launch: (input) => prepareLaunch(input, options),
    abandon: (session) => abandonSession(session, options),
    waive: (registration, au, reason) => waiveAu({ registration, au, reason }, options),
  };
}
