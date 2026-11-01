import { guardSchema, isRecord, looseRecord, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
import type { OpenApiDocument } from "../model/index.js";

const record = guardSchema(isRecord, "an object");

/** The schema of an OpenAPI 3 document: a version that starts with 3, `info` and `paths`; the rest passes as it is. */
export const openApiSchema: Schema<OpenApiDocument> = looseRecord({
  openapi: v.pipe(
    v.string(),
    v.regex(/^3\.\d+\.\d+/u, (issue) => `expected an OpenAPI version that starts with 3, found ${issue.received}`),
  ),
  info: record,
  paths: record,
});
