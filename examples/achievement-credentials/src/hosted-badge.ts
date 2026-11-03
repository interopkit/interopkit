import { buildJsonResponse } from "@interopkit/core/http";
import type { Handler } from "./network.ts";

/** The address of the assertion that the guild hosts. */
export const HOSTED_ASSERTION = "https://badges.example.org/assertions/1";

/** The three documents of an Open Badges 2.0 badge that a guild hosts: the assertion, its BadgeClass and the issuer. */
const DOCUMENTS: Readonly<Record<string, unknown>> = {
  "/assertions/1": {
    "@context": "https://w3id.org/openbadges/v2",
    id: HOSTED_ASSERTION,
    type: "Assertion",
    recipient: { type: "email", hashed: false, identity: "welder@example.org" },
    badge: "https://badges.example.org/badges/welding",
    verification: { type: "HostedBadge" },
    issuedOn: "2025-11-02T09:00:00Z",
  },
  "/badges/welding": {
    "@context": "https://w3id.org/openbadges/v2",
    id: "https://badges.example.org/badges/welding",
    type: "BadgeClass",
    name: "Welding",
    description: "Welds a joint to the standard of the guild.",
    image: "https://badges.example.org/badges/welding.png",
    criteria: { narrative: "Pass the practical test." },
    issuer: "https://badges.example.org/issuer",
  },
  "/issuer": {
    "@context": "https://w3id.org/openbadges/v2",
    id: "https://badges.example.org/issuer",
    type: "Issuer",
    name: "Example Guild",
    url: "https://badges.example.org",
    email: "badges@example.org",
  },
};

/** Serves an Open Badges 2.0 badge as a guild hosts it. Open Badges 2.0 is read and verified, and never issued. */
export const hostedBadge: Handler = async (request) => {
  const document = DOCUMENTS[new URL(request.url).pathname];
  return document === undefined ? { status: 404, headers: {}, body: "" } : buildJsonResponse(200, document);
};
