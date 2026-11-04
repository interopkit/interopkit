import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const DIRECTORY = join(import.meta.dirname, "../../.github/workflows");

interface Job {
  readonly "timeout-minutes"?: number;
  readonly uses?: string;
  readonly needs?: string | readonly string[];
}

interface Workflow {
  readonly on: string | readonly string[] | Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

const WORKFLOWS = readdirSync(DIRECTORY)
  .filter((file) => file.endsWith(".yml"))
  .map((file) => ({ file, workflow: parse(readFileSync(join(DIRECTORY, file), "utf8")) as Workflow }));

const workflowNamed = (file: string): Workflow =>
  WORKFLOWS.find((entry) => entry.file === file)?.workflow ?? expect.unreachable(`No workflow ${file}.`);

describe("the workflows", () => {
  it("stop every job that runs steps at a timeout of its own, so that a hung job does not run for six hours", () => {
    const unbounded = WORKFLOWS.flatMap(({ file, workflow }) =>
      Object.entries(workflow.jobs)
        .filter(([, job]) => job.uses === undefined && !(Number(job["timeout-minutes"]) > 0))
        .map(([name]) => `${file}: ${name}`),
    );
    expect(unbounded).toStrictEqual([]);
  });

  it("publishes only after the mutation rules have passed in the same run", () => {
    const { jobs } = workflowNamed("release.yml");
    const gates = Object.entries(jobs).filter(([, job]) => job.uses === "./.github/workflows/rules.yml");
    expect(gates).toHaveLength(1);
    const needs = [jobs.release?.needs ?? []].flat();
    expect(needs).toStrictEqual(gates.map(([name]) => name));
    expect(Object.keys(workflowNamed("rules.yml").on)).toContain("workflow_call");
  });
});
