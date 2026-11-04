import { type Issue, isRecord } from "@interopkit/core/checks";
import type { CaliperEvent } from "../model/index.js";
import { advisedOfEvent } from "./advised-properties.js";
import { CERTIFICATION_ROWS } from "./certification-rows.js";
import { error, warning } from "./finding.js";
import { isNamed, type ProfileEntry } from "./profile-entry.js";
import { classOf, judge, namesOf } from "./profile-fit.js";
import { SPECIFICATION_ROWS } from "./specification-rows.js";

/** Tells which profiles have an event, for the message that asks for the governing profile. */
function profilesOf(type: string): string {
  return namesOf(SPECIFICATION_ROWS.filter((row) => row.event === type).map((row) => row.profile));
}

/**
 * Judges the classes of an entity property that a table recommends: when every entry that the event fits names classes for the
 * property, an entity of another class is a warning. An IRI names no class and is not judged.
 */
function* recommendedClass(
  rows: readonly ProfileEntry[],
  entity: unknown,
  property: "generated" | "target",
  rule: string,
): Generator<Issue> {
  const named = rows.flatMap((row) => row[property]);
  const type = classOf(entity);
  if (type === undefined || !rows.every((row) => row[property].length > 0) || isNamed(type, named)) return;
  yield warning(
    property,
    rule,
    `expected ${namesOf(named)}, which the profile names, found an entity of type ${type}.`,
  );
}

/** What a table recommends beyond the entries that an event fits: the generated entity and the target. */
function* recommendations(rows: readonly ProfileEntry[], event: CaliperEvent): Generator<Issue> {
  if (event.generated === undefined) {
    if (rows.every((row) => row.advised)) {
      const named = namesOf(rows.flatMap((row) => row.generated));
      yield warning(
        "generated",
        "generated-missing",
        `expected ${named}, which the profile advises the action to give.`,
      );
    }
  } else {
    yield* recommendedClass(rows, event.generated, "generated", "generated-class");
  }
  yield* recommendedClass(rows, event.target, "target", "target-class");
}

/**
 * Judges an event against the tables of its profile: the specification's first, and the certification guide's when the
 * specification's does not fit. What neither allows is an error; what only the guide allows is a warning.
 */
function* tableFindings(event: CaliperEvent): Generator<Issue> {
  const strict = judge(SPECIFICATION_ROWS, event);
  if (strict.fits) {
    yield* recommendations(strict.rows, event);
    return;
  }
  const loose = judge(CERTIFICATION_ROWS, event);
  if (loose.fits) {
    const note = "The certification guide allows it and the table of the specification does not";
    yield warning(strict.path, strict.rule, `${strict.message} ${note}.`);
    yield* recommendations(loose.rows, event);
    return;
  }
  yield error(strict.path, strict.rule, strict.message);
}

/**
 * The generic event is for what the profiles do not model: an interaction that a profile's table names is a warning, since the
 * event of that profile says more.
 */
function* generalFindings(event: CaliperEvent): Generator<Issue> {
  if (event.type !== "Event" || (event.profile !== undefined && event.profile !== "GeneralProfile")) return;
  const actor = classOf(event.actor);
  const object = classOf(event.object);
  const modeled = SPECIFICATION_ROWS.find(
    (row) =>
      row.profile !== "GeneralProfile" &&
      row.actions.includes(event.action) &&
      (actor === undefined || isNamed(actor, row.actor)) &&
      (object === undefined || isNamed(object, row.object)),
  );
  if (modeled === undefined) return;
  yield warning(
    "type",
    "general-profile-modeled",
    `expected ${modeled.event}, which ${modeled.profile} has for this action, an actor and an object, found the generic Event.`,
  );
}

/**
 * A media event places the action in the media: the location that it gives as its target has the time of the action. The shape
 * allows no other class as the target of a media event.
 */
function* mediaFindings(event: CaliperEvent): Generator<Issue> {
  const { target } = event;
  if (event.type !== "MediaEvent" || !isRecord(target)) return;
  if (!("currentTime" in target)) {
    yield error(
      "target",
      "media-location-time",
      "missing the property currentTime, which places the action in the media.",
    );
  }
}

/**
 * Lists what the profile rules find in an event whose shape is right: the profile, the tables of the specification and of the
 * certification guide, the recommendations of the profile and its requirement of a location in the media.
 */
export function* eventFindings(event: CaliperEvent): Generator<Issue> {
  if (event.profile === undefined) {
    yield warning(
      "profile",
      "profile-missing",
      `expected the governing profile, ${profilesOf(event.type)} for ${event.type}.`,
    );
  }
  yield* tableFindings(event);
  yield* generalFindings(event);
  yield* advisedOfEvent(event);
  yield* mediaFindings(event);
}
