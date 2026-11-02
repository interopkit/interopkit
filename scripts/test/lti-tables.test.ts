import { describe, expect, it } from "vitest";
import { parseLtiTables } from "../lti-tables.ts";

/** A page with the structure of the portal's Appendices A and B: a heading with an id, then a table of rows with `code` cells. */
const PAGE = `
<h2 id="context-type-vocabulary">Context type vocabulary</h2>
<table>
<tr><th>Type
<th>Name
<tr><td>Course Offering
<td>
<code>http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering</code><br/>
<code>CourseOffering</code> (deprecated) <br/>
<code>urn:lti:context-type:ims/lis/CourseOffering</code> (deprecated)
</table>
<h3 id="lis-vocabulary-for-system-roles">System</h3>
<table>
<tr><td>Core <td><code>http://purl.imsglobal.org/vocab/lis/v2/system/person#Administrator</code>
<tr><td>Note <td>The deprecated <code>http://purl.imsglobal.org/vocab/lis/v2/person#Administrator</code>
</table>
<h3 id="lis-vocabulary-for-institution-roles">Institution</h3>
<table><tr><td><code>http://purl.imsglobal.org/vocab/lis/v2/institution/person#Staff</code></table>
<h3 id="lis-vocabulary-for-context-roles">Context</h3>
<table><tr><td><code>http://purl.imsglobal.org/vocab/lis/v2/membership#Learner</code></table>
<h4 id="context-sub-roles">Sub-roles</h4>
<table>
<tr><th>Principal role<th>Sub-role
<tr><td><code>Learner</code>
<td><code>GuestLearner</code> <br/>
<code>Learner</code>
</table>
<h3 id="lti-vocabulary-for-system-roles">LTI</h3>
<table><tr><td><code>http://purl.imsglobal.org/vocab/lti/system/person#TestUser</code></td><td>A marker</td></table>
<h2 id="lti-user-variables">LTI User Variables</h2>
<table>
<tr><th align=left>Message variable name<th>Value
<tr><td><code>User.id</code><td>The id
<tr><td align=left> <code>User.gradeLevels.*</code>
<td>Grades; for example <code>ldap://</code>
<tr><td>1 A note with <code>male</code> in it
</table>
<h2 id="lis-person-variables">LIS Person Variables</h2>
<table><tr><td><code>User.id</code><td>again</table>
<h2 id="custom-variables">Custom Variables</h2>
<p>No table, and <code>$com.example.Foo.bar</code> in a paragraph.</p>
`;

describe("parseLtiTables", () => {
  it("reads the vocabularies, the sub-roles and the context types with their deprecated names", () => {
    const tables = parseLtiTables(PAGE);
    expect(tables.contextTypes).toEqual([
      {
        uri: "http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering",
        deprecated: ["CourseOffering", "urn:lti:context-type:ims/lis/CourseOffering"],
      },
    ]);
    expect(tables.systemRoles).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/system/person#Administrator"]);
    expect(tables.institutionRoles).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/institution/person#Staff"]);
    expect(tables.contextRoles).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]);
    expect(Object.entries(tables.contextSubRoles)).toEqual([["Learner", ["GuestLearner", "Learner"]]]);
    expect(tables.ltiRoles).toEqual(["http://purl.imsglobal.org/vocab/lti/system/person#TestUser"]);
  });

  it("reads each variable once, from the first cell of a row, and skips notes and sections without a table", () => {
    expect(parseLtiTables(PAGE).variables).toEqual(["User.id", "User.gradeLevels.*"]);
  });

  it("names the section of a table that the page lacks", () => {
    expect(() => parseLtiTables('<h2 id="other">x</h2>')).toThrow("The page has no section context-type-vocabulary.");
  });
});
