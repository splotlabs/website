import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { benchmarks } from "../src/data/site";

// The production build has no data origin. The tests load synthetic fixtures through a
// same-origin path: the page accepts a test start hook only for a same-origin path.
const fixtures = new URL("./fixtures/", import.meta.url);
const origin = "http://127.0.0.1:8787";
const full = "/benchmarks/?dataset=ds-f1f1f1f1f1f10003";
const summary = (id: string) =>
  JSON.parse(readFileSync(new URL(`main/datasets/${id}/summary.json`, fixtures), "utf8"));
const commits = Object.fromEntries(
  summary("ds-f1f1f1f1f1f10003").implementations.map((i: { id: string; commit: string }) => [
    i.id,
    i.commit,
  ]),
) as Record<string, string>;

async function withData(page: Page, scenario = "main") {
  await page.addInitScript((base) => {
    (window as { __SPLOT_BENCH_DATA_BASE__?: string }).__SPLOT_BENCH_DATA_BASE__ = base;
  }, `/__bench__/${scenario}/`);
  await page.route("**/__bench__/**", async (route) => {
    const rel = new URL(route.request().url()).pathname.slice("/__bench__/".length);
    const file = fileURLToPath(new URL(rel, fixtures));
    if (!rel.includes("..") && existsSync(file) && statSync(file).isFile()) {
      await route.fulfill({ path: file, contentType: "application/json" });
    } else {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
}

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  return problems;
}

const status = (page: Page) => page.locator("#bench-status");

test("production: results are not published and no data is requested", async ({ page }) => {
  const problems = watchProblems(page);
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  const response = await page.goto("/benchmarks/");
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
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
  for (const url of requests.map((u) => new URL(u))) {
    expect(url.origin).toBe(origin);
    expect(url.pathname).toMatch(/^\/(benchmarks\/|_astro\/[^/]+|favicon\.svg)$/);
  }
  expect(problems).toEqual([]);
});

test("the data origin is allowed by the served connect-src", async ({ request }) => {
  const csp = (await request.get("/benchmarks/")).headers()["content-security-policy"];
  const connect = csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find((d) => d[0] === "connect-src")!
    .slice(1);
  if (benchmarks.dataBase === null) {
    expect(connect).toEqual(["'self'"]);
    return;
  }
  const url = new URL(benchmarks.dataBase);
  expect(url.protocol).toBe("https:");
  expect(url.pathname.endsWith("/")).toBe(true);
  expect(connect).toContain(url.origin);
});

test("the start hook accepts only a same-origin path", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  for (const hook of ["//example.com/data/", "/\\example.com/data/", "https://example.com/"]) {
    await page.addInitScript((base) => {
      (window as { __SPLOT_BENCH_DATA_BASE__?: string }).__SPLOT_BENCH_DATA_BASE__ = base;
    }, hook);
    await page.goto("/benchmarks/");
    await expect(status(page).locator(".bench-state")).toHaveText("Results are not published yet.");
  }
  expect(requests.filter((u) => !u.startsWith(origin))).toEqual([]);
});

test("loaded view: default dataset, filters and URL state", async ({ page }) => {
  const problems = watchProblems(page);
  await withData(page);
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
  await withData(page);
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
    "Not comparable: fixture-b: unsupported",
  );
  await expect(speedup.locator("tbody tr").nth(1)).toContainText("1.25×");
});

test("a failed cell is a labelled status, not a zero bar", async ({ page }) => {
  await withData(page);
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
  await withData(page);
  await page.goto(`${full}&machine=fixture-arm-01&depth=8&scale=fixture-a`);
  const view = page.locator("#view-scaling");
  await expect(view.locator("thead th")).toHaveText(["Stream", "1 thread", "4 threads"]);
  await expect(view.locator("tbody tr").first()).toContainText("3.50× against 1 thread");
});

test("partial and synthetic datasets carry banners", async ({ page }) => {
  await withData(page);
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
  await withData(page);
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

test("an empty index shows that results are not published", async ({ page }) => {
  await withData(page, "empty");
  await page.goto("/benchmarks/");
  await expect(status(page).locator(".bench-state")).toHaveText("Results are not published yet.");
});

test("load errors and invalid data show the error state", async ({ page }) => {
  await withData(page, "missing");
  await page.goto("/benchmarks/");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText("HTTP 404");

  await withData(page);
  await page.goto("/benchmarks/?dataset=ds-f1f1f1f1f1f10007");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText('summary.cells[0].status has the unknown value "fast"');
  await expect(page.locator("#view-throughput")).toHaveCount(0);
});

test("downloads resolve from the dataset metadata", async ({ page }) => {
  await withData(page);
  await page.goto(full);
  const dir = `${origin}/__bench__/main/datasets/ds-f1f1f1f1f1f10003/`;
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
  await withData(page);
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
  await withData(page);
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
  await withData(page);
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
  await expect(page.locator(".bench-state")).toHaveText("Results are not published yet.");
  await expect(page.locator("#method h3")).toHaveCount(4);
  await expect(page.getByRole("link", { name: "Benchmark harness" })).toBeVisible();
  await context.close();
});

for (const loaded of [false, true]) {
  const name = loaded ? "loaded" : "production";
  for (const width of [320, 390, 768, 1440]) {
    test(`benchmarks ${name}: no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      if (loaded) await withData(page);
      await page.goto(loaded ? `${full}&machine=fixture-x86-01` : "/benchmarks/");
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
      if (loaded) await withData(page);
      await page.goto(loaded ? `${full}&machine=fixture-x86-01` : "/benchmarks/");
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
