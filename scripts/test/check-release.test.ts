import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Bump,
  historyInFirstReleases,
  type PackageManifest,
  readRepository,
  releasedBumps,
  unpublishable,
  wrongFirstReleases,
} from "../check-release.ts";

const PUBLIC: PackageManifest = { name: "@interopkit/core", version: "0.0.0", publishConfig: { access: "public" } };

describe("releasedBumps", () => {
  it("names each package of the header of a changeset once, with the greatest bump among the changesets", () => {
    const first = '---\n"@interopkit/core": minor\n"@interopkit/learning-records": patch\n---\n\nNotes.\n';
    const second = "---\n'@interopkit/core': major\n'@interopkit/learning-records': minor\n---\n\nMore.\n";
    const third = '---\n"@interopkit/core": patch\n---\n\nLess.\n';
    expect([...releasedBumps([first, second, third])]).toStrictEqual([
      ["@interopkit/core", "major"],
      ["@interopkit/learning-records", "minor"],
    ]);
  });

  it("ignores a changeset without a header and a line of the notes that looks like an entry", () => {
    expect([...releasedBumps(["Only notes.\n", '---\n---\n\n"x": major\n'])]).toStrictEqual([]);
  });
});

describe("unpublishable", () => {
  it("accepts a public package with public access", () => {
    expect(unpublishable(["@interopkit/core"], [PUBLIC])).toStrictEqual([]);
  });

  it("names a private package, which changeset publish skips without an error", () => {
    const core = { name: "@interopkit/core", private: true, publishConfig: { access: "public" } };
    expect(unpublishable(["@interopkit/core"], [core])).toStrictEqual([
      '@interopkit/core is in a changeset but is private, so `changeset publish` skips it; remove "private".',
    ]);
  });

  it("names a package without public access and one that is not a package of the repository", () => {
    expect(unpublishable(["@interopkit/core", "@interopkit/lost"], [{ name: "@interopkit/core" }])).toStrictEqual([
      '@interopkit/core is in a changeset but has no publishConfig.access "public"; add it.',
      "@interopkit/lost is in a changeset but is not a package of packages/.",
    ]);
  });
});

describe("wrongFirstReleases", () => {
  it("accepts major for a package at 0.0.0, and any bump for a package that has been released", () => {
    const bumps = new Map<string, Bump>([
      ["@interopkit/core", "major"],
      ["@interopkit/learning-records", "minor"],
    ]);
    const released = { name: "@interopkit/learning-records", version: "1.0.0" };
    expect(wrongFirstReleases(bumps, [PUBLIC, released])).toStrictEqual([]);
  });

  it("names a package never released that a minor or a patch would release below the first major", () => {
    const bumps = new Map<string, Bump>([
      ["@interopkit/core", "minor"],
      ["@interopkit/learning-records", "patch"],
    ]);
    const player = { name: "@interopkit/learning-records", version: "0.0.0" };
    expect(wrongFirstReleases(bumps, [PUBLIC, player])).toStrictEqual([
      "@interopkit/core is at 0.0.0 and its changesets give it minor; the first release takes major, which is 1.0.0.",
      "@interopkit/learning-records is at 0.0.0 and its changesets give it patch; the first release takes major, which is 1.0.0.",
    ]);
  });
});

describe("historyInFirstReleases", () => {
  const released = { name: "@interopkit/learning-records", version: "1.0.0" };

  it("names a changeset of a package never released that tells a change against an earlier state", () => {
    const changesets = new Map([
      ["names.md", '---\n"@interopkit/core": major\n---\n\n`readView` (was `viewFromJson`) reads a view.\n'],
      ["surface.md", '---\n"@interopkit/core": major\n---\n\n`single` is no longer exported.\n'],
    ]);
    expect(historyInFirstReleases(changesets, [PUBLIC])).toStrictEqual([
      'names.md says "(was `" of a package that has never been released; state what the first release is.',
      'surface.md says "no longer" of a package that has never been released; state what the first release is.',
    ]);
  });

  it("accepts the notes of a first release that state what it is, and history in the notes of a later release", () => {
    const changesets = new Map([
      ["first.md", '---\n"@interopkit/core": major\n---\n\n`readView` reads a view, before any session.\n'],
      [
        "later.md",
        '---\n"@interopkit/learning-records": minor\n---\n\n`mount` is renamed `mountDelivery`; `mount` is no longer exported.\n',
      ],
    ]);
    expect(historyInFirstReleases(changesets, [PUBLIC, released])).toStrictEqual([]);
  });
});

describe("the changesets of the repository", () => {
  it("release only packages that are published, and a package that is not yet released as 1.0.0, with notes free of history", () => {
    const { changesets, manifests } = readRepository(join(import.meta.dirname, "../.."));
    const bumps = releasedBumps([...changesets.values()]);
    expect([...bumps.keys()]).toContain("@interopkit/core");
    expect(unpublishable(bumps.keys(), manifests)).toStrictEqual([]);
    expect(wrongFirstReleases(bumps, manifests)).toStrictEqual([]);
    expect(historyInFirstReleases(changesets, manifests)).toStrictEqual([]);
  });
});
