import { describe, expect, it } from "vitest";
import { runName } from "../../validation/containers/host.ts";

describe("the name of the containers of a run", () => {
  it("is the name that the caller gives its unit, so that two units never share a container", () => {
    expect(runName("moodle", { CONTAINER_NAME: "my-unit" })).toBe("my-unit");
  });

  it("falls back to the project name of Compose, and prefers the container name when both are set", () => {
    expect(runName("moodle", { COMPOSE_PROJECT_NAME: "my-project" })).toBe("my-project");
    expect(runName("moodle", { CONTAINER_NAME: "my-unit", COMPOSE_PROJECT_NAME: "my-project" })).toBe("my-unit");
    expect(runName("moodle", { CONTAINER_NAME: "", COMPOSE_PROJECT_NAME: "my-project" })).toBe("my-project");
  });

  it("is interopkit, the counterparty and 8 random hexadecimal digits when the caller names nothing", () => {
    const first = runName("pylti1p3", {});
    expect(first).toMatch(/^interopkit-pylti1p3-[0-9a-f]{8}$/u);
    expect(runName("pylti1p3", {})).not.toBe(first);
  });

  it.each(["My-Unit", "my unit", "-unit", "unit.one", "unit/one", "../unit"])(
    "refuses %j, which Docker or Compose does not accept as a name",
    (name) => {
      expect(() => runName("moodle", { CONTAINER_NAME: name })).toThrow(/CONTAINER_NAME must name a container/u);
      expect(() => runName("moodle", { COMPOSE_PROJECT_NAME: name })).toThrow(/COMPOSE_PROJECT_NAME must name/u);
    },
  );
});
