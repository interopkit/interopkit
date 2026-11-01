import { describe, expect, it } from "vitest";
import type { InteractionType } from "../src/index.js";
import { patternProblem, singleActivityIssues } from "../src/read/internal.js";

describe("the response patterns of the interaction types", () => {
  // The patterns that the standard prints in its examples, and the forms of its table of interaction types.
  it.each<[InteractionType, string]>([
    ["true-false", "true"],
    ["true-false", "false"],
    ["choice", "golf[,]tetris"],
    ["choice", "golf"],
    ["choice", ""],
    ["sequencing", ""],
    ["matching", ""],
    ["performance", ""],
    ["fill-in", ""],
    ["fill-in", "Bob's your uncle"],
    ["fill-in", "{case_matters=true}{order_matters=false}Bob[,]{lang=en}Ann"],
    ["fill-in", "Bob[,]{lang=fr-CA}Ann[,]"],
    ["long-fill-in", "{case_matters=false}{lang=en}To store and provide access to learning experiences."],
    ["likert", "likert_3"],
    ["matching", "ben[.]3[,]chris[.]2[,]troy[.]4[,]freddie[.]1"],
    ["matching", "ben[.]3[,]ben[.]4"],
    ["performance", "pong[.]1:[,]dg[.]:10[,]lunch[.]"],
    ["performance", "{order_matters=false}pong[.]1[,]dg[.]2"],
    ["performance", "{lang=en}pong[.]text"],
    ["sequencing", "tim[,]mike[,]ells[,]ben"],
    ["numeric", "4[:]"],
    ["numeric", "[:]4"],
    ["numeric", "1.5[:]4"],
    ["numeric", "-3[:]-1"],
    ["numeric", "7"],
    ["numeric", "[:]"],
    ["other", "(35.937432,-86.868896)"],
    ["other", ""],
  ])("accept the pattern of %s: %j", (type, pattern) => {
    expect(patternProblem(type, pattern)).toBeUndefined();
  });

  it.each<[InteractionType, string, string]>([
    ["true-false", "True", 'expected true or false, found "True"'],
    ["true-false", "", 'expected true or false, found ""'],
    ["choice", "[,]golf", "an item id is empty"],
    ["sequencing", "a[,][,]b", "an item id is empty"],
    ["likert", "a[,]b", "expected one item id, with no [,]"],
    ["likert", "", "the item id is empty"],
    ["matching", "ben", 'a pair is a source and a target joined by [.], found "ben"'],
    ["matching", "a[.]b[.]c", 'a pair is a source and a target joined by [.], found "a[.]b[.]c"'],
    ["matching", "[.]b", "the source of a pair is empty"],
    ["matching", "a[.]", "the target of a pair is empty"],
    ["performance", "pong", 'a step is an id and a response joined by [.], found "pong"'],
    ["performance", "[.]1", "the id of a step is empty"],
    ["numeric", "five", '"five" is not a number'],
    ["numeric", "1[:]x", '"x" is not a number'],
    ["numeric", "1[:]2[:]3", "a range has one [:]"],
    ["numeric", "1,5", '"1,5" is not a number'],
    ["fill-in", "{case_matters=maybe}x", "the parameter case_matters is true or false, found maybe"],
    ["fill-in", "{order_matters=1}x", "the parameter order_matters is true or false, found 1"],
    ["fill-in", "{color=red}x", "the parameter color is not one of case_matters, order_matters and lang"],
    ["fill-in", "{lang=en_US}x", "the parameter lang is a language tag, found en_US"],
    ["fill-in", "x[,]{case_matters=true}y", "the parameter case_matters belongs at the start of the first response"],
    ["long-fill-in", "{order_matters=x}y", "the parameter order_matters is true or false, found x"],
    [
      "performance",
      "{case_matters=true}a[.]1",
      "the parameter case_matters does not apply to a performance interaction",
    ],
    [
      "performance",
      "a[.]1[,]{order_matters=false}b[.]2",
      "the parameter order_matters belongs at the start of the first response",
    ],
  ])("name what is wrong with the pattern of %s: %j", (type, pattern, problem) => {
    expect(patternProblem(type, pattern)).toBe(problem);
  });

  it("leave the text of a choice alone when it looks like a parameter, since only the types with responses take them", () => {
    expect(patternProblem("choice", "{lang=x}a")).toBeUndefined();
  });
});

describe("the Activities of a context that a provider wrote as one", () => {
  it("are found in the input, and nothing is found in a value that is not an object", () => {
    expect(singleActivityIssues(null, "")).toStrictEqual([]);
    expect(singleActivityIssues("text", "")).toStrictEqual([]);
    expect(singleActivityIssues([], "")).toStrictEqual([]);
    expect(singleActivityIssues({ context: 5 }, "")).toStrictEqual([]);
    expect(singleActivityIssues({ context: { contextActivities: { parent: [{}] } } }, "")).toStrictEqual([]);
  });
});
