// biome-ignore-all lint/style/useNamingConvention: the names of the bodies of the Assessment Control Service are those of the specification.

import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ATTEMPT_STATUSES, CONTROL_ACTIONS } from "../src/index.js";
import {
  readControlRequest,
  readControlStatus,
  writeControlRequest,
  writeControlStatus,
} from "../src/protocol/internal.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { expectRefusals, expectRefusesOtherTypes } from "./services.js";

const request = {
  user: { iss: "https://assessment.org", sub: "2047534b3cc6d7086909" },
  resource_link: { id: "398" },
  attempt_number: 1,
  action: "flag",
};

describe("the control request", () => {
  it("is read with every parameter of Proctoring Services 5.1, and written as it is read", () => {
    const full = {
      ...request,
      incident_time: "2018-02-01T10:45:33Z",
      extra_time: 15,
      incident_severity: 0.1,
      reason_code: "12056",
      reason_msg: "Noise",
    };
    const read = readControlRequest(full);
    expect(read).toMatchObject({
      user: { issuer: "https://assessment.org", subject: "2047534b3cc6d7086909" },
      resourceLink: { id: "398" },
      attemptNumber: 1,
      action: "flag",
      incidentTime: "2018-02-01T10:45:33Z",
      extraTime: 15,
      incidentSeverity: 0.1,
      reasonCode: "12056",
      reasonMessage: "Noise",
    });
    expect(writeControlRequest(read)).toEqual(full);
  });

  it("reads every action that the text names, and no other", () => {
    for (const action of CONTROL_ACTIONS) expect(readControlRequest({ ...request, action }).action).toBe(action);
    expect(CONTROL_ACTIONS).toEqual(["pause", "resume", "terminate", "update", "flag"]);
    expect(() => readControlRequest({ ...request, action: "stop" })).toThrow(DataError);
  });

  it("reads the severity that the example prints as a string as the number it spells, and writes the number", () => {
    expect(readControlRequest({ ...request, incident_severity: "0.1" }).incidentSeverity).toBe(0.1);
    expect(writeControlRequest(readControlRequest({ ...request, incident_severity: "0.1" })).incident_severity).toBe(
      0.1,
    );
    for (const incident_severity of ["high", "", "1e0", 1.1, -0.1, "2", null]) {
      expect(() => readControlRequest({ ...request, incident_severity }), String(incident_severity)).toThrow(DataError);
    }
  });

  it("is refused when it breaks a rule of Proctoring Services 5.1", () => {
    expectRefusals(readControlRequest, request, [
      ["no user", { user: undefined }],
      ["a user without a sub", { user: { iss: "x" } }],
      ["a user without an iss", { user: { sub: "x" } }],
      ["no resource_link", { resource_link: undefined }],
      ["a resource_link without an id", { resource_link: {} }],
      ["no attempt_number", { attempt_number: undefined }],
      ["an attempt_number that is a string", { attempt_number: "1" }],
      ["an attempt_number that is 1.5", { attempt_number: 1.5 }],
      ["no action", { action: undefined }],
      ["an incident_time without a zone", { incident_time: "2018-02-01T10:45:33" }],
      ["a negative extra_time", { extra_time: -1 }],
    ]);
    expectRefusesOtherTypes(readControlRequest);
  });

  it("is written only with a severity from 0 to 1", () => {
    const read = readControlRequest(request);
    for (const incidentSeverity of [-0.1, 1.5, Number.NaN])
      expect(() => writeControlRequest({ ...read, incidentSeverity })).toThrow(DataError);
  });
});

describe("the control status", () => {
  it("is read with each status that Proctoring Services names, and written as it is read", () => {
    for (const status of ATTEMPT_STATUSES) expect(readControlStatus({ status }).status).toBe(status);
    expect(ATTEMPT_STATUSES).toEqual(["none", "running", "paused", "terminated", "complete"]);
    const body = { status: "paused", extra_time: 30 };
    expect(writeControlStatus(readControlStatus(body))).toEqual(body);
    expectRefusals(readControlStatus, { status: "running" }, [
      ["no status", { status: undefined }],
      ["a status of no kind", { status: "done" }],
      ["a negative extra_time", { extra_time: -5 }],
    ]);
    expectRefusesOtherTypes(readControlStatus);
  });
});

describe("the bodies of the Assessment Control Service", () => {
  it("read back what was written, for any request and status", () => {
    const text = fc.string({ minLength: 1, maxLength: 8 });
    const some = <TValue>(value: fc.Arbitrary<TValue>) => fc.option(value, { nil: undefined });
    const zoned = fc
      .date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true })
      .map((date) => date.toISOString());
    const requests = fc.record({
      user: fc.record({ issuer: text, subject: text }),
      resourceLink: fc.record({ id: text, title: some(text), description: some(text) }),
      attemptNumber: fc.nat(),
      action: fc.constantFrom(...CONTROL_ACTIONS),
      incidentTime: some(zoned),
      extraTime: some(fc.double({ min: 0, max: 1e4, noNaN: true })),
      incidentSeverity: some(fc.double({ min: 0, max: 1, noNaN: true })),
      reasonCode: some(text),
      reasonMessage: some(text),
    });
    const statuses = fc.record({
      status: fc.constantFrom(...ATTEMPT_STATUSES),
      extraTime: some(fc.double({ min: 0, max: 1e4, noNaN: true })),
    });
    fc.assert(
      fc.property(requests, statuses, (value, status) => {
        expect(readControlRequest(JSON.parse(JSON.stringify(writeControlRequest(value))))).toEqual(value);
        expect(readControlStatus(JSON.parse(JSON.stringify(writeControlStatus(status))))).toEqual(status);
      }),
      FUZZ,
    );
  });

  it("return a value or throw a DataError for any JSON, and for the examples with any value replaced", () => {
    fuzzJson(readControlRequest, [request]);
    fuzzJson(readControlStatus, [{ status: "running", extra_time: 5 }]);
  });
});
