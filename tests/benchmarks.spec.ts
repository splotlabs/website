import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { benchmarks } from "../src/data/site";

// The tests never use the real network. Every request outside the local server is aborted,
// and the configured data origin is answered from the synthetic fixtures in tests/fixtures/.
// Like the real raw file host, the mock serves JSON as text/plain with an open CORS header.
const fixtures = new URL("./fixtures/", import.meta.url);
const origin = "http://127.0.0.1:8787";
const base = benchmarks.dataBase;
const full = "/benchmarks/?dataset=ds-f1f1f1f1f1f10003";
const summary = (id: string) =>
  JSON.parse(readFileSync(new URL(`main/datasets/${id}/summary.json`, fixtures), "utf8"));
const commits = Object.fromEntries(
  summary("ds-f1f1f1f1f1f10003").implementations.map((i: { id: string; commit: string }) => [
    i.id,
    i.commit,
  ]),
) as Record<string, string>;
const cors = { "access-control-allow-origin": "*" };

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
});

/** Answers the data origin from tests/fixtures/<scenario>/. */
async function withData(page: Page, scenario: string) {
  await page.route(`${base}**`, async (route) => {
    const rel = route.request().url().slice(base.length);
    const file = fileURLToPath(new URL(`${scenario}/${rel}`, fixtures));
    if (!rel.includes("..") && existsSync(file) && statSync(file).isFile()) {
      await route.fulfill({ path: file, contentType: "text/plain; charset=utf-8", headers: cors });
    } else {
      await route.fulfill({ status: 404, body: "404: Not Found", headers: cors });
    }
  });
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const full3 = "ds-f1f1f1f1f1f10003";

/** Answers one data file with a changed copy of a fixture. Register after withData. */
async function serve(page: Page, rel: string, body: string) {
  await page.route(`${base}${rel}`, (route) =>
    route.fulfill({ body, contentType: "text/plain; charset=utf-8", headers: cors }),
  );
}
async function serveSummary(page: Page, change: (s: Json) => void, id = full3) {
  const s = summary(id);
  change(s);
  await serve(page, `datasets/${id}/summary.json`, JSON.stringify(s));
}
const mainIndex = () =>
  JSON.parse(readFileSync(new URL("main/index.json", fixtures), "utf8")) as Json;

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  return problems;
}

const status = (page: Page) => page.locator("#bench-status");

test("production: an empty index shows that results are not published", async ({ page }) => {
  const problems = watchProblems(page);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await withData(page, "empty");
  const response = await page.goto("/benchmarks/");
  expect(response?.status()).toBe(200);
  await expect(status(page).locator(".bench-state")).toHaveText("Results are not published yet.");
  await expect(page.locator("#bench-app")).toBeHidden();
  await expect(page.locator(".pill")).toContainText("Pre-alpha");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://splotlabs.io/benchmarks/",
  );
  await expect(page.getByRole("link", { name: "Benchmark harness" })).toHaveAttribute(
    "href",
    benchmarks.repo,
  );
  await page.waitForLoadState("networkidle");
  // Page assets, and one data request: the index.
  for (const url of requests.map((u) => new URL(u)).filter((u) => u.origin === origin)) {
    expect(url.pathname).toMatch(/^\/(benchmarks\/|_astro\/[^/]+|favicon\.svg)$/);
  }
  expect(requests.filter((u) => !u.startsWith(origin))).toEqual([`${base}index.json`]);
  expect(problems).toEqual([]);
});

test("connect-src names exactly the data base", async ({ request }) => {
  const csp = (await request.get("/benchmarks/")).headers()["content-security-policy"];
  const connect = csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find((d) => d[0] === "connect-src")!
    .slice(1);
  const url = new URL(base);
  expect(url.protocol).toBe("https:");
  expect(url.pathname.endsWith("/")).toBe(true);
  expect(connect).toEqual(["'self'", base]);
});

test("the CSP allows the data base and blocks other paths of the host", async ({ page }) => {
  await withData(page, "empty");
  await page.goto("/benchmarks/");
  await expect(status(page).locator(".bench-state")).toHaveText("Results are not published yet.");
  const result = await page.evaluate(async (dataBase) => {
    const blocked: string[] = [];
    document.addEventListener("securitypolicyviolation", (e) => blocked.push(e.blockedURI));
    const allowed = (await fetch(`${dataBase}index.json`)).ok;
    const sibling = new URL("../other/index.json", dataBase).href;
    const rejected = await fetch(sibling).then(
      () => false,
      () => true,
    );
    await new Promise((r) => setTimeout(r, 100));
    return { allowed, rejected, blocked, sibling };
  }, base);
  expect(result.allowed).toBe(true);
  expect(result.rejected).toBe(true);
  expect(result.blocked).toContain(result.sibling);
});

test("loaded view: default dataset, filters and URL state", async ({ page }) => {
  const problems = watchProblems(page);
  await withData(page, "main");
  await page.goto("/benchmarks/");
  // latest_complete is the default. Its origin is official, so it has no origin banner.
  await expect(page.locator("#f-dataset")).toHaveValue("ds-f1f1f1f1f1f10004");
  await expect(page.locator("#view-throughput")).toBeVisible();
  await expect(page.locator('[data-banner="origin"]')).toHaveCount(0);
  await expect(page).toHaveURL(/dataset=ds-f1f1f1f1f1f10004/);

  await page.locator("#f-dataset").selectOption("ds-f1f1f1f1f1f10003");
  await expect(page.locator('[data-banner="origin"]')).toContainText("Synthetic test data.");
  await expect(page.locator("#f-machine option")).toHaveText([
    "Fixture ARM CPU · FixtureOS 1.0 · aarch64 (fixture-arm-01)",
    "Fixture x86 CPU · FixtureOS 1.0 · x86_64 (fixture-x86-01)",
  ]);
  await page.locator("#f-machine").selectOption("fixture-x86-01");
  await page.locator("#f-depth").selectOption("10");
  await page.locator("#f-threads").selectOption("8");
  await page.locator("#f-q").fill("1280");
  await expect(page.locator("#f-q")).toBeFocused();
  const rows = page.locator("#view-throughput tbody th");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("fixture_1280x720_10bit_420_130f.ivf");
  const query = new URL(page.url()).searchParams;
  expect(Object.fromEntries(query)).toMatchObject({
    dataset: "ds-f1f1f1f1f1f10003",
    machine: "fixture-x86-01",
    depth: "10",
    threads: "8",
    q: "1280",
  });

  // The same link reproduces the view.
  await page.goto(page.url());
  await expect(page.locator("#f-machine")).toHaveValue("fixture-x86-01");
  await expect(page.locator("#f-depth")).toHaveValue("10");
  await expect(page.locator("#f-threads")).toHaveValue("8");
  await expect(page.locator("#f-q")).toHaveValue("1280");
  await expect(rows).toHaveCount(1);

  // A decoder can be removed from the view.
  await page.getByRole("checkbox", { name: /^fixture-c/ }).uncheck();
  await expect(page).toHaveURL(/decoders=fixture-a%2Cfixture-b/);
  await expect(page.locator("#view-throughput tbody tr")).toHaveCount(2);
  expect(problems).toEqual([]);
});

test("baseline change uses the speedups and aggregates of the dataset", async ({ page }) => {
  await withData(page, "main");
  await page.goto(`${full}&machine=fixture-arm-01&threads=1&depth=10&baseline=fixture-c`);
  const speedup = page.locator("#view-speedup");
  await expect(speedup.locator("thead th")).toHaveText(["Stream", /^fixture-a/, /^fixture-b/]);
  await page.locator("#f-baseline").selectOption("fixture-b");
  await expect(page).toHaveURL(/baseline=fixture-b/);
  await expect(speedup.locator("thead th")).toHaveText(["Stream", /^fixture-a/, /^fixture-c/]);
  const first = speedup.locator(".aggregates > li").first();
  await expect(first).toContainText("geometric mean 1.25×, 1 of 2 streams matched.");
  await expect(first).toContainText(
    "Excluded: fixture_1920x1080_10bit_420_130f.ivf (fixture-b: unsupported)",
  );
  await expect(speedup.locator("tbody tr").first()).toContainText(
    `Not comparable: fixture-b 1.2.3 (${commits["fixture-b"].slice(0, 12)}): Unsupported`,
  );
  await expect(speedup.locator("tbody tr").nth(1)).toContainText("1.25×");
});

test("a failed cell is a labelled status, not a zero bar", async ({ page }) => {
  await withData(page, "main");
  await page.goto(`${full}&machine=fixture-arm-01&threads=1&depth=10`);
  const view = page.locator("#view-throughput");
  const row = view.locator("tbody tr", { hasText: /fixture-b 1\.2\.3/ }).first();
  await expect(row.locator("td").nth(1)).toHaveText("Unsupported");
  await expect(row.locator("td").nth(2)).toHaveText("not measured");
  await expect(view.locator(".chart text.st")).toHaveText(["Unsupported"]);
  // Two streams and three decoders, one of them failed: five bars.
  await expect(view.locator(".chart rect.fill")).toHaveCount(5);
  // First-frame latency is null on this machine, so the column is absent.
  await expect(view.locator("thead th", { hasText: "First-frame latency" })).toHaveCount(0);

  await page.locator("#f-machine").selectOption("fixture-x86-01");
  await expect(view.locator("thead th", { hasText: "First-frame latency" })).toHaveCount(1);
  await expect(view.locator("tbody td", { hasText: "12.0 ms" }).first()).toBeVisible();
  await expect(view.locator("tbody td", { hasText: "Incorrect output" })).toHaveCount(1);
});

test("thread scaling shows each thread budget", async ({ page }) => {
  await withData(page, "main");
  await page.goto(`${full}&machine=fixture-arm-01&depth=8&scale=fixture-a`);
  const view = page.locator("#view-scaling");
  await expect(view.locator("thead th")).toHaveText([
    "Stream",
    "1 requested thread",
    "4 requested threads",
  ]);
  await expect(view.locator("tbody tr").first()).toContainText("3.50× against 1 thread");
});

test("partial and synthetic datasets carry banners", async ({ page }) => {
  await withData(page, "main");
  await page.goto("/benchmarks/?dataset=ds-f1f1f1f1f1f10002&machine=fixture-arm-01&threads=4");
  await expect(page.locator('[data-banner="partial"]')).toContainText("Incomplete dataset.");
  await expect(page.locator('[data-banner="partial"]')).toContainText(
    "fixture-arm-01: run interrupted.",
  );
  await expect(page.locator('[data-banner="origin"]')).toContainText("Synthetic test data.");
  await expect(
    page.locator("#view-throughput tbody td", { hasText: "Not run" }).first(),
  ).toBeVisible();
});

test("unsupported data versions and kinds have their own state", async ({ page }) => {
  await withData(page, "main");
  await page.goto("/benchmarks/?dataset=ds-f1f1f1f1f1f10005");
  await expect(status(page)).toHaveAttribute("data-state", "unsupported");
  await expect(status(page)).toContainText("splotbench.summary/2");
  await page.locator("#f-dataset").selectOption("ds-f1f1f1f1f1f10006");
  await expect(status(page)).toContainText('the workload kind "encode"');
  // The reader can go back to a supported dataset.
  await page.locator("#f-dataset").selectOption("ds-f1f1f1f1f1f10003");
  await expect(status(page)).toBeHidden();
  await expect(page.locator("#view-throughput")).toBeVisible();
});

test("an unsupported index version has its own state", async ({ page }) => {
  await withData(page, "future");
  await page.goto("/benchmarks/");
  await expect(status(page)).toHaveAttribute("data-state", "unsupported");
  await expect(status(page)).toContainText("splotbench.index/2");
});

for (const [name, reply, message] of [
  ["HTTP 500", { status: 500, body: "Server error" }, "HTTP 500"],
  ["invalid JSON", { status: 200, body: "{ not json" }, "is not valid JSON"],
] as const) {
  test(`a failed index fetch (${name}) shows the error state and the method`, async ({ page }) => {
    await page.route(`${base}index.json`, (route) => route.fulfill({ ...reply, headers: cors }));
    await page.goto("/benchmarks/");
    await expect(status(page)).toHaveAttribute("data-state", "error");
    await expect(status(page)).toContainText("The results could not be loaded.");
    await expect(status(page)).toContainText(message);
    await expect(page.locator("#method h3")).toHaveCount(4);
  });
}

test("a missing file and invalid data show the error state", async ({ page }) => {
  await withData(page, "missing");
  await page.goto("/benchmarks/");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText("HTTP 404");

  await withData(page, "main");
  await page.goto("/benchmarks/?dataset=ds-f1f1f1f1f1f10007");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText('summary.cells[0].status has the unknown value "fast"');
  await expect(page.locator("#view-throughput")).toHaveCount(0);
});

test("downloads resolve from the dataset metadata", async ({ page }) => {
  await withData(page, "main");
  await page.goto(full);
  const dir = `${base}datasets/ds-f1f1f1f1f1f10003/`;
  const files = page.locator("#view-downloads");
  const expected: [string | RegExp, string][] = [
    ...summary("ds-f1f1f1f1f1f10003").machines.map(
      (m: { machine_id: string; role: string; bundle: { path: string } }): [string, string] => [
        `Raw bundle: ${m.machine_id} (${m.role})`,
        `${dir}${m.bundle.path}`,
      ],
    ),
    ["Summary as CSV", `${dir}summary.csv`],
    ["Campaign lock", `${dir}lock.json`],
    ["Manifest", `${dir}manifest.json`],
    ["Checksums (SHA-256)", `${dir}SHA256SUMS`],
    ["Reproduction instructions", "https://example.com/fixtures/benchmarks/METHODOLOGY.md"],
  ];
  for (const [name, href] of expected) {
    await expect(files.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  }
  // A link that is not https is shown as text, not as a link.
  await expect(page.locator('#view-provenance a[href^="file:"]')).toHaveCount(0);
  await expect(page.locator("#settings-details")).toContainText("file:///fixtures/corpus");
});

test("provenance: labels, details and copy", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await withData(page, "main");
  await page.goto(`${full}&machine=fixture-arm-01&threads=1&depth=8`);
  const a = `fixture-a ${commits["fixture-a"].slice(0, 12)} (development)`;
  const b = `fixture-b 1.2.3 (${commits["fixture-b"].slice(0, 12)})`;
  const checks = page.locator(".checks label");
  await expect(checks).toHaveText([a, b, /^fixture-c 2\.0\.0/]);
  // The stale version output is never the label.
  await expect(checks.first()).not.toContainText("1.0.0");

  await page.locator("#view-throughput tbody").first().getByRole("link", { name: b }).click();
  const details = page.locator("details.prov[open]", {
    has: page.locator("summary", { hasText: b }),
  });
  await expect(details).toBeVisible();
  await expect(details).toContainText(commits["fixture-b"]);
  await expect(details).toContainText(
    "Built by the harness from the release source. Not an upstream binary.",
  );
  await expect(details.getByRole("link", { name: /releases\/v1\.2\.3$/ })).toBeVisible();
  const sha = summary("ds-f1f1f1f1f1f10003").builds.find(
    (x: { implementation: string; machine_id: string }) =>
      x.implementation === "fixture-b" && x.machine_id === "fixture-arm-01",
  ).binary_sha256;
  await expect(details).toContainText(sha);
  await details.getByRole("button", { name: `Copy the provenance of ${b}` }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`Commit: ${commits["fixture-b"]}`);
  expect(copied).toContain(`Binary SHA-256: ${sha}`);
  expect(copied).toContain("Machine: Fixture ARM CPU");

  const c = page.locator("details.prov", {
    has: page.locator("summary", { hasText: /^fixture-c/ }),
  });
  await c.locator("summary").click();
  await expect(c).toContainText("Official binary from the upstream release.");
  const devDetails = page.locator("details.prov", { has: page.locator("summary", { hasText: a }) });
  await devDetails.locator("summary").click();
  await expect(devDetails).toContainText("Development commit");
  await expect(devDetails).toContainText("fixture-a 1.0.0");
  await page.locator("#machine-details summary").click();
  await expect(page.locator("#machine-details")).toContainText("neon");
  await page.locator("#settings-details summary").click();
  await expect(page.locator("#settings-details")).toContainText("process-wall");
});

test("history is loaded only when it is opened", async ({ page }) => {
  await withData(page, "main");
  const loaded: string[] = [];
  page.on("request", (r) => r.url().includes("summary.json") && loaded.push(r.url()));
  await page.goto(`${full}&machine=fixture-arm-01&threads=1&depth=8`);
  await expect(page.locator("#view-throughput")).toBeVisible();
  expect(loaded).toHaveLength(1);
  await page.locator("#bench-history summary").click();
  const rows = page.locator("#bench-history tbody tr");
  const older = summary("ds-f1f1f1f1f1f10001").implementations[0].commit.slice(0, 12);
  await expect(rows.filter({ hasText: "fixture-older" })).toContainText(
    `fixture-a ${older} (development)`,
  );
  await expect(rows.filter({ hasText: "fixture-full" })).toHaveCount(1);
  // Only datasets of the same series and origin: the official dataset is not in the list.
  await expect(rows.filter({ hasText: "fixture-official" })).toHaveCount(0);
  expect(loaded.length).toBeGreaterThan(1);
});

test("no console errors or CSP violations in the loaded view", async ({ page }) => {
  const problems = watchProblems(page);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await withData(page, "main");
  await page.goto(full);
  await expect(page.locator("#view-throughput .chart svg")).toBeVisible();
  await page.locator("#f-machine").selectOption("fixture-x86-01");
  await page.locator("#bench-history summary").click();
  await expect(page.locator("#bench-history tbody tr").first()).toBeVisible();
  for (const s of await page.locator("details.prov summary").all()) await s.click();
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator("#view-throughput .chart svg")).toHaveAttribute("width", /\d+/);
  // The broken and future datasets of the series report their own errors in the table.
  expect(problems.filter((p) => !p.includes("404"))).toEqual([]);
});

test("the benchmarks page is usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/benchmarks/");
  await expect(page.locator("h1")).toHaveText("AV2 decoder benchmarks.");
  await expect(page.locator(".bench-state")).toHaveText("The interactive results need JavaScript.");
  await expect(page.getByRole("link", { name: "the dataset index" })).toHaveAttribute(
    "href",
    `${base}index.json`,
  );
  await expect(page.locator("#method h3")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Benchmark harness" })).toBeVisible();
  await context.close();
});

for (const loaded of [false, true]) {
  const name = loaded ? "loaded" : "production";
  for (const width of [320, 390, 768, 1440]) {
    test(`benchmarks ${name}: no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await withData(page, loaded ? "main" : "empty");
      await page.goto(loaded ? `${full}&machine=fixture-x86-01` : "/benchmarks/");
      if (!loaded) await expect(status(page)).toHaveAttribute("data-state", "empty");
      if (loaded) {
        await expect(page.locator("#view-throughput .chart svg")).toBeVisible();
        for (const s of await page.locator("details.prov summary").all()) await s.click();
        await expect(page.locator("#bench-history tbody tr").first()).toBeVisible();
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    });
  }
  for (const width of [390, 1440]) {
    test(`benchmarks ${name}: axe finds no violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await withData(page, loaded ? "main" : "empty");
      await page.goto(loaded ? `${full}&machine=fixture-x86-01` : "/benchmarks/");
      if (!loaded) await expect(status(page)).toHaveAttribute("data-state", "empty");
      if (loaded) {
        await expect(page.locator("#view-throughput .chart svg")).toBeVisible();
        for (const s of await page.locator("details.prov summary").all()) await s.click();
        await expect(page.locator("#bench-history tbody tr").first()).toBeVisible();
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
}

test("without latest_complete, the newest dataset is the default, with a notice", async ({
  page,
}) => {
  await withData(page, "main");
  const index = mainIndex();
  index.latest_complete = null;
  index.datasets.reverse();
  await serve(page, "index.json", JSON.stringify(index));
  await page.goto("/benchmarks/");
  await expect(page.locator("#f-dataset")).toHaveValue("ds-f1f1f1f1f1f10004");
  await expect(page.locator('[data-banner="note"]')).toContainText(
    "No complete official dataset is marked as current.",
  );
  await expect(page.locator("#view-throughput")).toBeVisible();
});

test("latest_complete must name a complete official dataset", async ({ page }) => {
  await withData(page, "main");
  const index = mainIndex();
  index.latest_complete = full3; // synthetic
  await serve(page, "index.json", JSON.stringify(index));
  await page.goto("/benchmarks/");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText("does not name a complete official dataset");
});

test('origin "local" shows the "Not official data" banner', async ({ page }) => {
  await withData(page, "main");
  await serveSummary(page, (s) => (s.origin = "local"));
  await page.goto(full);
  await expect(page.locator('[data-banner="origin"]')).toContainText("Not official data.");
  await expect(page.locator('[data-banner="origin"]')).toContainText('"local"');
});

const invalid: [string, (s: Json) => void, string][] = [
  [
    "a failed cell with a frame rate",
    (s) => (s.cells.find((c: Json) => c.status !== "ok").fps_median = 100),
    "and the metric fps_median",
  ],
  [
    "a release identity without a release",
    (s) => (s.implementations[1].release = null),
    'release must be set exactly when the identity is "release"',
  ],
  [
    "a development identity with a release build origin",
    (s) => (s.implementations[0].build_origin = "source-release"),
    "does not match the identity",
  ],
  [
    "a release identity built from development source",
    (s) => (s.implementations[1].build_origin = "source-development"),
    "does not match the identity",
  ],
  ["a cell with an unknown build", (s) => (s.cells[0].build_id = "bld-0000000000000000"), "build"],
  [
    "a cell with an unknown case",
    (s) => (s.cells[0].case_id = "no-case"),
    'unknown case "no-case"',
  ],
  [
    "a cell with an unknown machine",
    (s) => (s.cells[0].machine_id = "no-machine"),
    'unknown machine "no-machine"',
  ],
  [
    "a cell with an unknown implementation",
    (s) => (s.cells[0].implementation = "no-decoder"),
    'unknown implementation "no-decoder"',
  ],
  [
    "a duplicate case id",
    (s) => (s.cases[1].id = s.cases[0].id),
    "summary.cases has the duplicate entry",
  ],
  [
    "a cell with a thread budget its machine does not list",
    (s) => (s.cells[0].threads = 3),
    "thread budget that its machine does not list",
  ],
  [
    "an oversized list",
    (s) => (s.machines[0].threads = Array.from({ length: 17 }, (_, i) => i + 1)),
    "has more than 16 entries",
  ],
];
for (const [name, change, message] of invalid) {
  test(`invalid data: ${name}`, async ({ page }) => {
    await withData(page, "main");
    await serveSummary(page, change);
    await page.goto(full);
    await expect(status(page)).toHaveAttribute("data-state", "error");
    await expect(status(page)).toContainText(message);
    await expect(page.locator("#view-throughput")).toHaveCount(0);
  });
}

test("oversized index list and oversized file are refused", async ({ page }) => {
  await withData(page, "main");
  const index = mainIndex();
  index.latest_complete = null;
  index.datasets = Array.from({ length: 1001 }, (_, i) => ({
    ...index.datasets[1],
    dataset_id: `ds-${String(i).padStart(16, "0")}`,
  }));
  await serve(page, "index.json", JSON.stringify(index));
  await page.goto("/benchmarks/");
  await expect(status(page)).toContainText("index.datasets has more than 1000 entries.");

  await withData(page, "main");
  await serve(page, `datasets/${full3}/summary.json`, `{${" ".repeat(5_000_001)}}`);
  await page.goto(full);
  await expect(status(page)).toContainText("is larger than 5 MB.");
});

test("an expected machine role without results is named", async ({ page }) => {
  await withData(page, "main");
  await serveSummary(page, (s) => {
    const arm = "fixture-arm-01";
    s.machines = s.machines.filter((m: Json) => m.machine_id !== arm);
    for (const k of ["builds", "cells", "speedups", "aggregates"]) {
      s[k] = s[k].filter((x: Json) => x.machine_id !== arm);
    }
    s.complete = false;
    s.coverage.roles_present = ["x86-64"];
  });
  await page.goto(full);
  const banner = page.locator('[data-banner="partial"]');
  await expect(banner).toContainText("No results exist for the expected machine roles arm64");
  await expect(banner).toContainText("Of 48 expected results: 43 ok");
  await expect(page.locator("#f-machine option")).toHaveCount(1);
});

test("a release URL that is not https is shown as text", async ({ page }) => {
  await withData(page, "main");
  await serveSummary(page, (s) => (s.implementations[1].release.url = "http://example.com/v1"));
  await page.goto(`${full}&machine=fixture-arm-01`);
  const b = page.locator("details.prov", {
    has: page.locator("summary", { hasText: /^fixture-b/ }),
  });
  await b.locator("summary").click();
  await expect(b).toContainText("http://example.com/v1");
  await expect(b.locator('a[href^="http:"]')).toHaveCount(0);
});

test("stream details show the input identity", async ({ page }) => {
  await withData(page, "main");
  await page.goto(`${full}&depth=8&q=1280`);
  const d = page.locator("#streams-details");
  await d.locator("summary").click();
  const c = summary(full3).cases.find((x: Json) => x.id === "fixture-720p-8bit");
  await expect(d).toContainText(c.input_sha256);
  await expect(d).toContainText("130 frames");
  await expect(d.getByRole("link", { name: c.url })).toHaveAttribute("href", c.url);
});

test("the filters work with the keyboard", async ({ page }) => {
  await withData(page, "main");
  await page.goto(`${full}&machine=fixture-arm-01&depth=8`);
  const rows = page.locator("#view-throughput tbody tr");
  await expect(rows).toHaveCount(6);
  await page.locator("#f-q").focus();
  await page.keyboard.type("1280");
  await expect(page.locator("#view-throughput tbody")).toHaveCount(1);
  await expect(page.locator("#f-q")).toBeFocused();
  const box = page.getByRole("checkbox", { name: /^fixture-c/ });
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).not.toBeChecked();
  await expect(rows).toHaveCount(2);
  await page.locator("#machine-details summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#machine-details")).toHaveAttribute("open", "");
  const region = page.getByRole("region", { name: "Throughput table" });
  await region.focus();
  await expect(region).toBeFocused();
});
