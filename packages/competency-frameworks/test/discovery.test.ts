import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import type { OpenApiDocument } from "../src/index.js";
import { localizeOpenApi } from "../src/provider/index.js";
import { DISCOVERY } from "./provider-fixture.js";

const SERVER = "https://case.example.org/ims/case/v1p1";

describe("localizeOpenApi", () => {
  it("sets the servers to the one address of the provider, and keeps the rest", () => {
    const localized = localizeOpenApi(DISCOVERY, { serverUrl: SERVER });
    expect(localized.servers).toStrictEqual([{ url: SERVER }]);
    expect({ ...localized, servers: undefined }).toStrictEqual({ ...DISCOVERY, servers: undefined });
  });

  it("adds servers to a document that has none", () => {
    const { servers: _servers, ...bare } = DISCOVERY;
    expect(localizeOpenApi(bare as OpenApiDocument, { serverUrl: SERVER })).toHaveProperty("servers", [
      { url: SERVER },
    ]);
  });

  it("returns a copy that shares nothing with the document, and leaves the document as it was", () => {
    const document: OpenApiDocument = JSON.parse(
      JSON.stringify({ ...DISCOVERY, paths: { "/CFDocuments": { get: { tags: ["a"] } } } }),
    );
    const before = structuredClone(document);
    const localized = localizeOpenApi(document, { serverUrl: SERVER });
    expect(document).toStrictEqual(before);
    expect(localized.paths).not.toBe(document.paths);
    expect(localized.info).not.toBe(document.info);
    (localized.paths["/CFDocuments"] as { get: { tags: string[] } }).get.tags.push("b");
    expect(document).toStrictEqual(before);
  });

  it.each([
    ["https://case.example.org/ims/case/v1p1"],
    ["http://localhost:8080/ims/case/v1p1"],
    ["https://example.org/base/path/ims/case/v1p1"],
    ["https://example.org/ims/case/v1p0"],
  ])("takes the address %s", (serverUrl) => {
    expect(localizeOpenApi(DISCOVERY, { serverUrl }).servers).toStrictEqual([{ url: serverUrl }]);
  });

  it.each([
    ["only the host", "https://case.example.org"],
    ["the host and a slash", "https://case.example.org/"],
    ["a slash at the end", "https://case.example.org/ims/case/v1p1/"],
    ["another root", "https://case.example.org/ims/case/v2p0"],
    ["a path that does not end with the root", "https://case.example.org/ims/case/v1p1/CFDocuments"],
    ["a query", "https://case.example.org/ims/case/v1p1?x=1"],
    ["a fragment", "https://case.example.org/ims/case/v1p1#x"],
    ["a scheme that is not http", "ftp://case.example.org/ims/case/v1p1"],
    ["no scheme", "case.example.org/ims/case/v1p1"],
    ["a relative path", "/ims/case/v1p1"],
    ["white space", "https://case.example.org/ims /case/v1p1"],
    ["no host", "https:///ims/case/v1p1"],
  ])("refuses an address with %s, and says what it must be", (_, serverUrl) => {
    expect(() => localizeOpenApi(DISCOVERY, { serverUrl })).toThrow(
      /^The options is invalid at serverUrl: expected an http or https address that ends with \/ims\/case\/v1p1, such as "https:\/\/case\.example\.org\/ims\/case\/v1p1", found /u,
    );
  });

  it.each([
    ["no address", "{}", 'The options is invalid: missing the property "serverUrl".'],
    [
      "an address that is a number",
      '{"serverUrl":5}',
      "The options is invalid at serverUrl: expected a string, found 5.",
    ],
    [
      "a property it does not know",
      '{"serverUrl":"https://case.example.org/ims/case/v1p1","host":"x"}',
      "The options is invalid",
    ],
    ["null", "null", "The options is invalid: expected an object, found null."],
  ])("refuses options with %s", (_, json, message) => {
    expect(() => localizeOpenApi(DISCOVERY, JSON.parse(json))).toThrow(message);
  });

  it.each([
    ["null", "null", "The OpenAPI document is invalid: expected an object, found null."],
    ["an array", "[]", "The OpenAPI document is invalid: expected an object, found an array."],
    [
      "a document with no paths",
      '{"openapi":"3.0.0","info":{}}',
      'The OpenAPI document is invalid: missing the property "paths".',
    ],
    ["a document of OpenAPI 2", '{"openapi":"2.0","info":{},"paths":{}}', "The OpenAPI document is invalid at openapi"],
    [
      "a document whose version is a number",
      '{"openapi":3,"info":{},"paths":{}}',
      "The OpenAPI document is invalid at openapi",
    ],
    [
      "a document whose info is a list",
      '{"openapi":"3.0.0","info":[],"paths":{}}',
      "The OpenAPI document is invalid at info",
    ],
  ])("refuses %s for the document", (_, json, message) => {
    expect(() => localizeOpenApi(JSON.parse(json), { serverUrl: SERVER })).toThrow(message);
  });

  it("refuses a document that is not JSON, and says where", () => {
    const document: OpenApiDocument = { ...DISCOVERY, components: { when: new Date(0) } };
    expect(() => localizeOpenApi(document, { serverUrl: SERVER })).toThrow(DataError);
    expect(() => localizeOpenApi(document, { serverUrl: SERVER })).toThrow(/components\.when/u);
  });

  it("refuses a document that nests deeper than any real one", () => {
    let nested: unknown = "leaf";
    for (let level = 0; level < 100; level += 1) nested = { level: nested };
    expect(() => localizeOpenApi({ ...DISCOVERY, components: nested }, { serverUrl: SERVER })).toThrow(
      /nests more than 64 levels/u,
    );
  });

  it.each(["__proto__", "constructor", "prototype"])("refuses a member named %s, and changes no prototype", (name) => {
    const document: OpenApiDocument = { ...DISCOVERY, components: JSON.parse(`{"${name}":{"polluted":true}}`) };
    expect(() => localizeOpenApi(document, { serverUrl: SERVER })).toThrow(`components.${name} is refused`);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
