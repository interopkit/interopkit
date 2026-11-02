import { createLrs } from "./src/lrs.ts";
import { serve } from "./src/server.ts";

/**
 * Starts the example LRS on the loopback address, for a conformance suite or a person with `curl`. The user and the password
 * come from the environment, `LRS_USER` and `LRS_PASSWORD`, and the port from `LRS_PORT` (a free one by default).
 */
const user = process.env.LRS_USER;
const password = process.env.LRS_PASSWORD;
if (user === undefined || password === undefined) {
  throw new Error("Set LRS_USER and LRS_PASSWORD: the example LRS has no default credential.");
}
const lrs = createLrs({
  origin: "http://localhost",
  credentials: [
    {
      user,
      password,
      authority: { account: { homePage: "https://lrs.campus.example", name: user } },
      actions: [
        "statements.read",
        "statements.write",
        "state.read",
        "state.write",
        "profiles.read",
        "profiles.write",
        "activities.read",
        "agents.read",
      ],
    },
  ],
});
const { url } = await serve(lrs.handle, Number(process.env.LRS_PORT ?? 0));
console.log(`${url}/xapi`);
