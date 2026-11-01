import { Buffer } from "node:buffer";

/** The origin that a client of the tests believes it talks to: CASE clients need `https`, and OpenSALT is on loopback. */
export const OPENSALT_ORIGIN = "https://opensalt.test";

/** What OpenSALT answered to a request that changes something. */
export interface Answer {
  readonly status: number;
  readonly body: string;
}

/** A signed-in user of OpenSALT: the cookies of its session. */
export interface Session {
  /** The `Cookie` header to send. */
  readonly cookie: string;
}

const CSRF_FIELD = /name="_csrf_token" value="([^"]+)"/u;

/** Joins the cookies that a response sets into the value of a `Cookie` header. */
function cookiesOf(response: Response, previous = ""): string {
  const jar = new Map(
    previous
      .split("; ")
      .filter(Boolean)
      .map((pair) => [pair.split("=")[0] ?? "", pair]),
  );
  for (const setting of response.headers.getSetCookie()) {
    const pair = setting.split(";")[0] ?? "";
    jar.set(pair.split("=")[0] ?? "", pair);
  }
  return [...jar.values()].join("; ");
}

/**
 * Signs in with the login form of OpenSALT, the way a browser does: the form carries a token against forged requests, which
 * belongs to the session cookie of the page.
 *
 * @param baseUrl - The address of OpenSALT, such as `http://127.0.0.1:18080`.
 * @throws `Error` when the form has no token or the sign-in is not redirected to the application.
 */
export async function signIn(baseUrl: string, username: string, password: string): Promise<Session> {
  const page = await fetch(`${baseUrl}/login`, { redirect: "manual" });
  const token = CSRF_FIELD.exec(await page.text())?.[1];
  if (token === undefined) throw new Error(`The login page of ${baseUrl} has no form token.`);
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookiesOf(page) },
    body: new URLSearchParams([
      ["_username", username],
      ["_password", password],
      ["_csrf_token", token],
    ]),
  });
  if (
    response.status !== 302 ||
    new URL(response.headers.get("location") ?? "", baseUrl).pathname.startsWith("/login")
  ) {
    throw new Error(`OpenSALT refused the sign-in with status ${response.status}.`);
  }
  return { cookie: cookiesOf(response, cookiesOf(page)) };
}

/**
 * Imports a framework as the editor of OpenSALT does: the file goes to the import route as base64 text in a form. The route
 * checks the file against the JSON schema of CASE before it reads it.
 *
 * @param baseUrl - The address of OpenSALT.
 * @param session - A user who may create frameworks.
 * @param file - The text of the package, as JSON.
 */
export async function importFramework(baseUrl: string, session: Session, file: string): Promise<Answer> {
  const response = await fetch(`${baseUrl}/salt/case/import`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: session.cookie },
    body: new URLSearchParams({ fileContent: Buffer.from(file).toString("base64") }),
  });
  return { status: response.status, body: await response.text() };
}
