import { createInterface } from "node:readline";
import { createLrsClient } from "@interopkit/learning-records/client";
import { openUnit, playLesson } from "./src/au.ts";

/**
 * A unit on the command line, for a content suite: each line on its input is the JSON of `{ url, plant? }`, a launch URL to
 * play, and each line on its output what the session recorded or the refusal of the launch. A lesson runs as `playLesson`
 * plays it, with a scaled score of 1; with `plant`, the unit sends an allowed statement before its initialized statement
 * first, past the rules of its session, so that a suite records the violation.
 */
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const { url, plant } = JSON.parse(line) as { readonly url: string; readonly plant?: boolean };
  try {
    const session = await openUnit(url, fetch);
    if (typeof session === "string") {
      console.log(JSON.stringify({ refusal: session }));
      continue;
    }
    if (plant === true) {
      const client = createLrsClient({
        endpoint: `${session.launch.endpoint.replace(/\/$/u, "")}/`,
        fetch,
        version: "1.0.3",
        authorization: async () => `Basic ${session.resume.token}`,
      });
      await client.sendStatement({
        id: crypto.randomUUID(),
        actor: session.launch.actor,
        verb: { id: "http://adlnet.gov/expapi/verbs/experienced" },
        object: { objectType: "Activity", id: session.launch.activityId },
        context: { ...session.launchData.contextTemplate, registration: session.launch.registration },
        timestamp: new Date().toISOString(),
      });
    }
    console.log(JSON.stringify(await playLesson(session, 1)));
  } catch (error) {
    console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}
