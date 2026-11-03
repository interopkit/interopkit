import { validateStatements } from "@interopkit/learning-records";
import { test } from "vitest";
import { expectRatioInTurns } from "./budgets.js";
import { AU1, testHost } from "./lms-host.js";
import { launchUnit, register, unitStatement } from "./lms-session.js";

/** The allowed statements of one request, the size of a batch that the LRS takes. */
const BATCH = 1000;

test("judges the seven statements of a session within a multiple of validateStatements of them", async ({
  annotate,
  bench,
}) => {
  const host = testHost();
  const registration = await register(host);
  const statements = await (async () => {
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    return {
      launched,
      list: [
        unitStatement(launched, "initialized"),
        unitStatement(launched, "experienced"),
        unitStatement(launched, "experienced"),
        unitStatement(launched, "completed", { completion: true, duration: "PT1M" }),
        unitStatement(launched, "experienced"),
        unitStatement(launched, "passed", { success: true, duration: "PT2M", score: { scaled: 0.9 } }),
        unitStatement(launched, "terminated", { duration: "PT3M" }),
      ],
    };
  })();
  const accept = host.lrsOptions.accept ?? (() => Promise.resolve([]));
  const access = {
    allowed: true as const,
    authority: { mbox: "mailto:au@example.org" },
    actions: [],
    principal: statements.launched.launch.session,
  };
  await expectRatioInTurns(
    { annotate, bench },
    "sessionAgainstValidate",
    { name: "validateStatements", fn: () => validateStatements(statements.list, { role: "lrs", version: "1.0.3" }) },
    { name: "accept of the LMS", fn: () => accept(statements.list, access) },
  );
});

test("judges 1,000 allowed statements of one request within a multiple of validateStatements of them", async ({
  annotate,
  bench,
}) => {
  const host = testHost();
  const registration = await register(host);
  const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
  const initialized = unitStatement(launched, "initialized");
  const batch = [initialized, ...Array.from({ length: BATCH - 1 }, () => unitStatement(launched, "experienced"))];
  const accept = host.lrsOptions.accept ?? (() => Promise.resolve([]));
  const access = {
    allowed: true as const,
    authority: { mbox: "mailto:au@example.org" },
    actions: [],
    principal: launched.launch.session,
  };
  await expectRatioInTurns(
    { annotate, bench },
    "batchAgainstValidate",
    { name: "validateStatements", fn: () => validateStatements(batch, { role: "lrs", version: "1.0.3" }) },
    { name: "accept of the LMS", fn: () => accept(batch, access) },
  );
});

test("prepares a launch over stores in memory and the LRS in the same process", async ({ annotate, bench }) => {
  const host = testHost();
  const registration = await register(host);
  const { prepareLaunch } = await import("@interopkit/course-launch/lms");
  const result = await bench("prepareLaunch", () =>
    prepareLaunch({ registration: registration.id, au: AU1 }, host.options),
  ).run({
    time: 500,
    iterations: 10,
    warmupTime: 100,
    warmupIterations: 3,
  });
  const { min, p50 } = result.latency;
  await annotate(
    `prepareLaunch: fastest ${min.toFixed(3)} ms, median ${p50.toFixed(3)} ms; its budget in time waits for a sample of CI.`,
  );
});
