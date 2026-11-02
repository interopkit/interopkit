import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Browser, textOfAnswer } from "./local-network.js";

const run = promisify(execFile);

/** The hidden inputs and the action of the first form of a page: what a browser posts when the page submits itself. */
export function formOf(page: string): {
  readonly action: string;
  readonly method: string;
  readonly fields: Record<string, string>;
} {
  const form = /<form\b([^>]*)>([\s\S]*?)<\/form>/iu.exec(page);
  if (form === null) throw new Error(`The page has no form: ${page.slice(0, 300)}`);
  const attribute = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`, "iu").exec(tag)?.[1];
  const unescapeHtml = (text: string) =>
    text
      .replaceAll("&quot;", '"')
      .replaceAll("&#039;", "'")
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
  const fields: Record<string, string> = {};
  for (const [tag] of (form[2] ?? "").matchAll(/<input\b[^>]*>/giu)) {
    const name = attribute(tag, "name");
    if (name !== undefined) fields[unescapeHtml(name)] = unescapeHtml(attribute(tag, "value") ?? "");
  }
  return {
    action: unescapeHtml(attribute(form[1] ?? "", "action") ?? ""),
    method: (attribute(form[1] ?? "", "method") ?? "get").toUpperCase(),
    fields,
  };
}

/** The `sesskey` that Moodle's pages carry for the script of the page and for every request that changes something. */
function sesskeyOf(page: string): string {
  const key = /"sesskey":"([A-Za-z0-9]+)"/u.exec(page)?.[1];
  if (key === undefined) throw new Error("The page carries no sesskey.");
  return key;
}

/** Signs a browser in to Moodle with the login form, and returns the `sesskey` of its session. */
export async function signIn(browser: Browser, origin: string, username: string, password: string): Promise<string> {
  const form = await browser.request("GET", `${origin}/login/index.php`);
  const token = formOf(form.text.slice(form.text.indexOf('id="login"') - 200)).fields.logintoken;
  const posted = await browser.request("POST", `${origin}/login/index.php`, {
    form: { username, password, logintoken: token ?? "" },
  });
  if (posted.status !== 303 && posted.status !== 302)
    throw new Error(`Moodle did not sign ${username} in: ${posted.status}.`);
  return sesskeyOf((await browser.request("GET", `${origin}/my/`)).text);
}

/**
 * Runs a command of `validation/moodle/setup.php` in the container of Moodle, and returns the JSON that it printed, with what a
 * task of Moodle printed before it as `output`. `T` is the shape of the JSON that the command prints.
 */
export async function setup<T extends object = object>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T & { readonly output: string }> {
  const [program = "docker", ...prefix] = JSON.parse(process.env.MOODLE_EXEC ?? "[]") as string[];
  const { stdout } = await run(program, [...prefix, command, JSON.stringify(args)], { maxBuffer: 1 << 24 });
  const lines = stdout.trim().split("\n");
  return { ...JSON.parse(lines.at(-1) ?? ""), output: lines.slice(0, -1).join("\n") };
}

/** Calls a web service of Moodle as the user whose `sesskey` it is, the way the scripts of its pages do. */
export async function callService(
  browser: Browser,
  origin: string,
  sesskey: string,
  methodname: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const answer = await browser.request("POST", `${origin}/lib/ajax/service.php?sesskey=${sesskey}&info=${methodname}`, {
    json: [{ index: 0, methodname, args }],
  });
  const [result] = JSON.parse(answer.text) as { error: boolean | string; data?: unknown; exception?: unknown }[];
  if (result === undefined || result.error !== false)
    throw new Error(`${methodname} failed: ${textOfAnswer(answer).slice(0, 400)}`);
  return result.data;
}
