import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  downloadSchemas,
  EXTRACTIONS,
  extractPortalPage,
  loadList,
  mapConcurrently,
  pinSchemas,
  requireSchemas,
  schemaDirectory,
  sha256,
} from "../schemas.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "interopkit-schemas-"));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("the list", () => {
  it("pins every file to an https address, a file name that no other file has and a SHA-256", () => {
    const names = new Set<string>();
    for (const { url, file, extract, sha256: hash } of loadList(join(import.meta.dirname, "../.."))) {
      expect(url.startsWith("https://")).toBe(true);
      expect(extract === undefined || EXTRACTIONS.includes(extract)).toBe(true);
      // Contexts of different standards end in the same segment (`v1`, `context.json`), so a name is its own.
      expect(file).toMatch(/^[A-Za-z0-9._-]+$/u);
      expect(names.has(file)).toBe(false);
      names.add(file);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("sha256", () => {
  it("hashes bytes as lowercase hexadecimal", () => {
    expect(sha256(new TextEncoder().encode("a"))).toBe(
      "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    );
  });
});

describe("mapConcurrently", () => {
  it("returns the results in the order of the items, however the runs finish", async () => {
    const results = await mapConcurrently([5, 4, 3, 2, 1, 0], async (item) => {
      await Promise.resolve();
      return item * 2;
    });
    expect(results).toStrictEqual([10, 8, 6, 4, 2, 0]);
  });
});

describe("downloadSchemas", () => {
  const A = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

  /** A root with a list of one file, and a `fetch` that answers every address with the given text. */
  function setUp(
    name: string,
    hash: string,
    answer: string,
    extract?: (typeof EXTRACTIONS)[number],
  ): { readonly root: string; readonly requests: string[] } {
    const root = join(directory, name);
    mkdirSync(join(root, "scripts"), { recursive: true });
    const list = [
      {
        url: "https://spec.example/ctx/a.json",
        file: "a.json",
        ...(extract === undefined ? {} : { extract }),
        sha256: hash,
      },
    ];
    writeFileSync(join(root, "scripts/schemas.lock.json"), JSON.stringify(list));
    const requests: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      requests.push(url);
      return Promise.resolve(new Response(answer));
    });
    return { root, requests };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads nothing when the list is empty", async () => {
    const root = join(directory, "empty");
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/schemas.lock.json"), "[]");
    expect(await downloadSchemas(root)).toStrictEqual([]);
  });

  it("writes a file whose bytes have the pinned hash, and downloads it only once", async () => {
    const { root, requests } = setUp("pinned", A, "a");
    expect(await downloadSchemas(root)).toStrictEqual(["a.json"]);
    expect(readFileSync(join(schemaDirectory(root), "a.json"), "utf8")).toBe("a");
    expect(await downloadSchemas(root)).toStrictEqual([]);
    expect(requests).toHaveLength(1);
  });

  it("pins a page by the hash of its extraction, writes the extraction, and accepts a fetch that differs only in navigation", async () => {
    const first = portalPage("implementation_guide", "first", "may");
    const pinned = sha256(new TextEncoder().encode(extractPortalPage(first)));
    const { root } = setUp("extracted", pinned, portalPage("implementation_guide2", "second", "may"), "portal-page");
    expect(await downloadSchemas(root)).toStrictEqual(["a.json"]);
    expect(readFileSync(join(schemaDirectory(root), "a.json"), "utf8")).toBe(extractPortalPage(first));
    expect(await downloadSchemas(root)).toStrictEqual([]);
  });

  it("refuses a page whose specification changed, whatever its navigation, and writes nothing", async () => {
    const pinned = sha256(
      new TextEncoder().encode(extractPortalPage(portalPage("implementation_guide", "first", "may"))),
    );
    const { root } = setUp("rewritten", pinned, portalPage("implementation_guide", "first", "must"), "portal-page");
    await expect(downloadSchemas(root)).rejects.toThrow(/has the SHA-256 [0-9a-f]{64}, not the pinned [0-9a-f]{64}/u);
    expect(existsSync(join(schemaDirectory(root), "a.json"))).toBe(false);
  });

  it("writes into the list the hash of the extraction of a page, and the hash of the bytes of any other file", async () => {
    const page = portalPage("implementation_guide", "first", "may");
    const { root } = setUp("pin", "0".repeat(64), page, "portal-page");
    await pinSchemas(root);
    const [pinned] = loadList(root);
    expect(pinned).toStrictEqual({
      url: "https://spec.example/ctx/a.json",
      file: "a.json",
      extract: "portal-page",
      sha256: sha256(new TextEncoder().encode(extractPortalPage(page))),
    });
    const { root: plain } = setUp("pin-plain", "0".repeat(64), "a");
    await pinSchemas(plain);
    expect(loadList(plain)[0]?.sha256).toBe(A);
  });

  it("writes nothing and names both hashes when the bytes differ from the pinned ones", async () => {
    const { root } = setUp("changed", A, "b");
    await expect(downloadSchemas(root)).rejects.toThrow(/has the SHA-256 3e23e816.*, not the pinned ca978112/s);
    expect(existsSync(join(schemaDirectory(root), "a.json"))).toBe(false);
  });
});

/**
 * A page of the open portal: a sidebar around the document in an outer `main`, and the specification in the inner one, with a
 * breadcrumb, a table, an example and the scripts, classes and links that the site changes. `guide` is where the sidebar's
 * link to a guide points, `build` the identifier of style that the build of the site writes, and `word` a word of the text.
 */
function portalPage(guide: string, build: string, word: string): string {
  return `<!DOCTYPE html><html><head><title>LTI Core</title><style>.a[data-astro-cid-${build}]{color:red}</style></head>
<body><main><aside><nav><a href="/lti/guides/${guide}/sections/abstract" class="doc-nav-link">Guide</a></nav></aside>
<script type="module">window.build = "${build}";</script>
<main class="flex-1 min-w-0" data-astro-cid-${build}><nav aria-label="Breadcrumb"><a href="/" data-astro-reload>Home</a></nav>
<h2 id="roles" class="heading" data-astro-cid-${build}>Roles</h2>
<table data-astro-cid-${build}><tr><td><code><a href="https://purl.example/${guide}#Administrator">Administrator</a></code></td><td>${word}</td></tr></table>
<pre class="astro-code" style="background:#fff"><span style="color:#000">{</span>
  "label": "Quiz"
}</pre><svg><path d="M0 0"/></svg><!-- built ${build} -->
</main></main></body></html>`;
}

describe("extractPortalPage", () => {
  const specification = portalPage("implementation_guide", "first", "may");

  it("gives the same text for two pages that differ only in navigation, links, classes, styles and scripts", () => {
    const other = portalPage("implementation_guide2", "second", "may");
    expect(specification).not.toBe(other);
    expect(extractPortalPage(other)).toBe(extractPortalPage(specification));
    expect(sha256(new TextEncoder().encode(extractPortalPage(other)))).toBe(
      sha256(new TextEncoder().encode(extractPortalPage(specification))),
    );
  });

  it("gives another text, and so another hash, when a word of the specification changes", () => {
    const changed = portalPage("implementation_guide", "first", "must");
    expect(extractPortalPage(changed)).not.toBe(extractPortalPage(specification));
    const heading = specification.replace(">Roles<", ">Duties<");
    expect(extractPortalPage(heading)).not.toBe(extractPortalPage(specification));
    const example = specification.replace('"label": "Quiz"', '"label": "Test"');
    expect(extractPortalPage(example)).not.toBe(extractPortalPage(specification));
  });

  it("keeps the identifiers of the headings, the tables, and the lines of an example", () => {
    const text = extractPortalPage(specification);
    expect(text).toContain('<h2 id="roles">Roles</h2>');
    expect(text).toContain("<table><tr><td><code><a>Administrator</a></code></td><td>may</td></tr></table>");
    expect(text).toContain('<pre><span>{</span>\n  "label": "Quiz"\n}</pre>');
  });

  it("leaves out the sidebar, the breadcrumb, the scripts, the styles, the drawings and the comments", () => {
    const text = extractPortalPage(specification);
    for (const left of ["Guide", "Home", "window.build", "color:red", "<svg", "built", "<main", "doc-nav-link"]) {
      expect(text, left).not.toContain(left);
    }
  });

  it("refuses a page that has no main element", () => {
    expect(() => extractPortalPage("<html><body><p>Moved</p></body></html>")).toThrow(
      "The page has no main element, which holds the specification.",
    );
  });
});

describe("requireSchemas", () => {
  it("returns the schema directory below the root when it exists", () => {
    mkdirSync(join(directory, ".cache/schemas"), { recursive: true });
    expect(requireSchemas(directory)).toBe(join(directory, ".cache/schemas"));
  });

  it("says how to download the schemas when the directory is missing", () => {
    const root = join(directory, "none");
    expect(() => requireSchemas(root)).toThrow(
      `The schemas are not downloaded to ${schemaDirectory(root)}: run pnpm schemas first.`,
    );
  });
});
