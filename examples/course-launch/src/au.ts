import type { Fetch } from "@interopkit/core";
import { type AuResume, type AuSession, type Recorded, startAuSession } from "@interopkit/course-launch/au";

/**
 * Opens an assignable unit from its launch URL, as its page does first: the session, or the reason the LMS gave for none.
 *
 * @param url - The address the page was opened with.
 * @param fetch - The `fetch` of the page.
 * @param resume - What the page kept before a reload.
 */
export async function openUnit(url: string, fetch: Fetch, resume?: AuResume): Promise<AuSession | string> {
  const started = await startAuSession(url, { fetch, ...(resume === undefined ? {} : { resume }) });
  return "session" in started ? started.session : started.refusal;
}

/** What a lesson sent: each statement as the session recorded, skipped or refused it, and where the page goes next. */
export interface Lesson {
  readonly recorded: readonly Recorded[];
  readonly returnUrl: string | undefined;
}

/**
 * Plays a lesson that a learner reads to the end and then takes a quiz of: initialized, completed, passed or failed by the
 * mastery score of the launch, and terminated. A unit in Browse or Review sends initialized and terminated alone, since the
 * session skips the rest.
 *
 * @param session - The session of the unit.
 * @param scaled - The scaled score of the quiz.
 */
export async function playLesson(session: AuSession, scaled: number): Promise<Lesson> {
  const recorded = [await session.initialize(), await session.complete()];
  recorded.push(
    session.launchData.masteryScore === undefined
      ? await session.pass({ scaled })
      : await session.judge({ scaled, raw: Math.round(scaled * 10), min: 0, max: 10 }),
  );
  const { returnUrl } = await session.terminate();
  return { recorded, returnUrl };
}
