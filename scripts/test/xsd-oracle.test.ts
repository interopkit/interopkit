import { afterAll, describe, expect, it } from "vitest";
import { createXsdOracle } from "../xsd-oracle.ts";

const XSD = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:t" xmlns="urn:t" elementFormDefault="qualified">
  <xs:element name="a"><xs:complexType><xs:sequence><xs:element name="b" type="xs:decimal"/></xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const oracle = createXsdOracle(XSD);
afterAll(() => oracle.close());

describe("the oracle of a schema", () => {
  it("finds a document valid by the schema", () => {
    expect(oracle.verdict('<a xmlns="urn:t"><b> 0.5 </b></a>')).toStrictEqual({ valid: true });
  });

  it("refuses a document that the schema does not take, with the first message of libxml2", () => {
    const verdict = oracle.verdict('<a xmlns="urn:t"><b>x</b></a>');
    expect(verdict.valid).toBe(false);
    expect(!verdict.valid && verdict.message).toContain("Element '{urn:t}b'");
  });

  it("refuses a document that is not well-formed", () => {
    const verdict = oracle.verdict("<a");
    expect(verdict.valid).toBe(false);
    expect(!verdict.valid && verdict.message).toMatch(/^not well-formed: /u);
  });

  it("judges documents until it is closed, and throws for a schema that does not compile", () => {
    expect(oracle.verdict('<a xmlns="urn:t"><b>1</b></a>')).toStrictEqual({ valid: true });
    expect(() => createXsdOracle("<xs:schema")).toThrow();
  });
});
