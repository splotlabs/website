import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { benchmarks } from "../src/data/site";

// The tests never use the real network. Every request outside the local server is aborted,
// and the configured data origin is answered from tests/fixtures/, which the benchmarks harness
// generated (see tests/fixtures/README.md). Like the raw file host, the mock serves JSON as
// text/plain with an open CORS header. States that the harness cannot produce (official data,
// other origins, invalid data) are in-memory changes of the generated files.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

const fixtures = new URL("./fixtures/", import.meta.url);
const origin = "http://127.0.0.1:8787";
const base = benchmarks.dataBase;
const cors = { "access-control-allow-origin": "*" };
const read = (rel: string): Json => JSON.parse(readFileSync(new URL(rel, fixtures), "utf8"));
const indexJson = () => read("main/index.json");
const summary = (id: string) => read(`main/datasets/${id}/summary.json`);

// The generated datasets, in publication order.
const [DS1, DS2, DS3, DS4] = indexJson().datasets.map((d: Json) => d.dataset_id) as string[];
const ARM = "fixture-arm-01";
const X86 = "fixture-x86-01";
const full = `/benchmarks/?dataset=${DS1}`;
const s1 = summary(DS1);
const impl = (id: string, s = s1) => s.implementations.find((i: Json) => i.id === id);
const short = (id: string, s = s1) => impl(id, s).commit.slice(0, 12);
const label = (id: string, s = s1) => {
  const i = impl(id, s);
  return i.release
    ? `${i.name} ${i.release.version} (${short(id, s)})`
    : `${i.name} ${short(id, s)} (development)`;
};
const caseName = (id: string, s = s1) => s.cases.find((c: Json) => c.id === id).name;
const two = (v: number) => `${v.toFixed(2)}×`;

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
});

/** Answers the data origin from tests/fixtures/<scenario>/. */
async function withData(page: Page, scenario = "main") {
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
/** Answers one data file with the given body. Register it after withData. */
async function serve(page: Page, rel: string, body: string) {
  await page.route(`${base}${rel}`, (route) =>
    route.fulfill({ body, contentType: "text/plain; charset=utf-8", headers: cors }),
  );
}
/** Serves a changed copy of a generated summary. */
async function serveSummary(page: Page, change: (s: Json) => void, id = DS1) {
  const s = summary(id);
  change(s);
  await serve(page, `datasets/${id}/summary.json`, JSON.stringify(s));
}
/** Serves a changed copy of the generated index. */
async function serveIndex(page: Page, change: (i: Json) => void) {
  const index = indexJson();
  change(index);
  await serve(page, "index.json", JSON.stringify(index));
}
/** The official path: DS1 becomes official and the promoted complete dataset. */
async function promoteDs1(page: Page) {
  await serveIndex(page, (i) => {
    i.datasets[0].origin = "official";
    i.latest_complete = DS1;
  });
  await serveSummary(page, (s) => (s.origin = "official"));
}

function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  return problems;
}

const status = (page: Page) => page.locator("#bench-status");
const statusLabels: Record<string, string> = {
  ok: "OK",
  incorrect: "Incorrect output",
  unsupported: "Unsupported",
  timeout: "Timeout",
  error: "Error",
  interrupted: "Interrupted",
  "not-run": "Not run",
};
const statusWords: Record<string, string> = {
  ok: "ok",
  incorrect: "incorrect output",
  unsupported: "unsupported",
  timeout: "timeout",
  error: "error",
  interrupted: "interrupted",
  "not-run": "not run",
};

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
  await expect(page.getByRole("link", { name: /^Methodology/ })).toHaveAttribute(
    "href",
    "https://github.com/splotlabs/benchmarks/blob/main/docs/METHODOLOGY.md",
  );
  await expect(page.getByRole("link", { name: "Reproduce a run" })).toHaveAttribute(
    "href",
    "https://github.com/splotlabs/benchmarks/blob/main/docs/REPRODUCE.md",
  );
  await page.waitForLoadState("networkidle");
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

test("without latest_complete, the newest complete dataset is the default", async ({ page }) => {
  await withData(page);
  await page.goto("/benchmarks/");
  // The generated index has no promoted dataset. DS4 is newer, but it is partial.
  await expect(page.locator("#f-dataset")).toHaveValue(DS3);
  await expect(page.locator('[data-banner="note"]')).toContainText(
    "No complete official dataset is marked as current. The default is the newest complete dataset.",
  );
  await expect(page.locator('[data-banner="partial"]')).toHaveCount(0);
});

test("without any complete dataset, the newest dataset is the default", async ({ page }) => {
  await withData(page);
  await serveIndex(page, (i) => i.datasets.forEach((d: Json) => (d.complete = false)));
  await page.goto("/benchmarks/");
  await expect(page.locator("#f-dataset")).toHaveValue(DS4);
  await expect(page.locator('[data-banner="note"]')).toContainText(
    "The default is the newest dataset.",
  );
});

test("a partial dataset names the missing role and the status counts", async ({ page }) => {
  const problems = watchProblems(page);
  await withData(page);
  await page.goto(`/benchmarks/?dataset=${DS4}`);
  const banner = page.locator('[data-banner="partial"]');
  const cov = summary(DS4).coverage;
  const missing = cov.roles_expected.filter((r: string) => !cov.roles_present.includes(r));
  await expect(banner).toContainText(
    `No results exist for the expected machine roles ${missing.join(", ")}`,
  );
  await expect(banner).toContainText(`Of ${cov.cells_expected} expected results:`);
  for (const [st, n] of Object.entries(cov.status_counts)) {
    if (n) await expect(banner).toContainText(`${n} ${statusWords[st]}`);
  }
  await expect(banner).toContainText(`${X86}: run interrupted.`);
  await expect(page.locator("#f-machine option")).toHaveCount(1);
  await expect(
    page.locator("#view-throughput tbody td", { hasText: "Interrupted" }).first(),
  ).toBeVisible();
  expect(problems).toEqual([]);
});

test("official data: the promoted dataset is the default, without a banner", async ({ page }) => {
  await withData(page);
  await promoteDs1(page);
  await page.goto("/benchmarks/");
  await expect(page.locator("#f-dataset")).toHaveValue(DS1);
  await expect(page.locator("#view-throughput")).toBeVisible();
  await expect(page.locator('[data-banner="origin"]')).toHaveCount(0);
  await expect(page.locator('[data-banner="note"]')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`dataset=${DS1}`));
  await page.locator("#f-dataset").selectOption(DS2);
  await expect(page.locator('[data-banner="origin"]')).toContainText("Synthetic test data.");
});

test("loaded view: filters and URL state", async ({ page }) => {
  const problems = watchProblems(page);
  await withData(page);
  await page.goto(full);
  await expect(page.locator("#f-dataset")).toHaveValue(DS1);
  await expect(page.locator('[data-banner="origin"]')).toContainText("Synthetic test data.");
  await expect(page.locator("#f-machine option")).toHaveText(
    s1.machines.map(
      (m: Json) =>
        `${m.fingerprint.cpu.model} · ${m.fingerprint.os.name} ${m.fingerprint.os.version} · ${m.fingerprint.arch} (${m.machine_id})`,
    ),
  );
  await page.locator("#f-machine").selectOption(X86);
  await page.locator("#f-depth").selectOption("10");
  await page.locator("#f-threads").selectOption("4");
  await page.locator("#f-q").fill("720");
  await expect(page.locator("#f-q")).toBeFocused();
  const groups = page.locator("#view-throughput tbody th");
  await expect(groups).toHaveCount(1);
  await expect(groups.first()).toContainText(caseName("example-720p-10bit"));
  await expect(page).toHaveURL(/q=720/);
  const query = Object.fromEntries(new URL(page.url()).searchParams);
  expect(query).toMatchObject({ dataset: DS1, machine: X86, depth: "10", threads: "4", q: "720" });

  // The same link reproduces the view.
  await page.goto(page.url());
  await expect(page.locator("#f-machine")).toHaveValue(X86);
  await expect(page.locator("#f-depth")).toHaveValue("10");
  await expect(page.locator("#f-threads")).toHaveValue("4");
  await expect(page.locator("#f-q")).toHaveValue("720");
  await expect(groups).toHaveCount(1);

  await page.getByRole("checkbox", { name: label("fixture-c") }).uncheck();
  await expect(page).toHaveURL(/decoders=fixture-a%2Cfixture-b/);
  await expect(page.locator("#view-throughput tbody tr")).toHaveCount(2);
  expect(problems).toEqual([]);
});

test("baseline change uses the speedups and aggregates of the dataset", async ({ page }) => {
  await withData(page);
  await page.goto(`${full}&machine=${ARM}&threads=1&depth=10&baseline=fixture-a`);
  const speedup = page.locator("#view-speedup");
  await expect(speedup.locator("thead th")).toHaveText([
    "Stream",
    label("fixture-b"),
    label("fixture-c"),
  ]);
  await page.locator("#f-baseline").selectOption("fixture-c");
  await expect(page).toHaveURL(/baseline=fixture-c/);
  await expect(speedup.locator("thead th")).toHaveText([
    "Stream",
    label("fixture-a"),
    label("fixture-b"),
  ]);

  const agg = s1.aggregates.find(
    (a: Json) =>
      a.machine_id === ARM &&
      a.threads === 1 &&
      a.bit_depth === 10 &&
      a.implementation === "fixture-a" &&
      a.baseline === "fixture-c",
  );
  const first = speedup.locator(".aggregates > li").first();
  await expect(first).toContainText(
    `geometric mean ${two(agg.geomean_ratio)}, ${agg.n_matched} of ${agg.n_expected} streams matched.`,
  );
  for (const x of agg.excluded) {
    await expect(first).toContainText(
      `Excluded: ${caseName(x.case_id)} (${label(x.implementation)}: ${statusLabels[x.status]})`,
    );
  }
  const failed = s1.cells.find(
    (c: Json) => c.machine_id === ARM && c.threads === 1 && c.status === "unsupported",
  );
  const row = speedup.locator("tbody tr", { hasText: caseName(failed.case_id) });
  await expect(row).toContainText(`Not comparable: ${label(failed.implementation)}: Unsupported`);
  const ratio = s1.speedups.find(
    (r: Json) =>
      r.machine_id === ARM &&
      r.threads === 1 &&
      r.case_id === "example-1080p-10bit" &&
      r.implementation === "fixture-a" &&
      r.baseline === "fixture-c",
  ).ratio;
  await expect(
    speedup.locator("tbody tr", { hasText: caseName("example-1080p-10bit") }),
  ).toContainText(two(ratio));
});

test("a failed cell is a labelled status, not a zero bar", async ({ page }) => {
  await withData(page);
  await page.goto(`${full}&machine=${ARM}&threads=1&depth=10`);
  const view = page.locator("#view-throughput");
  const body = view.locator("tbody", { hasText: caseName("example-720p-10bit") });
  const row = body.locator("tr", { hasText: label("fixture-c") });
  await expect(row.locator("td").nth(1)).toHaveText("Unsupported");
  await expect(row.locator("td").nth(2)).toHaveText("not measured");
  await expect(row.locator("td")).toHaveCount(3);
  await expect(view.locator(".chart text.st")).toHaveText(["Unsupported"]);
  // Chart rows name the decoder. The full label with the commit is in the table.
  await expect(view.locator(".chart text.lbl").first()).toHaveText(impl("fixture-a").name);
  const ok = s1.cells.filter(
    (c: Json) =>
      c.machine_id === ARM && c.threads === 1 && c.status === "ok" && c.case_id.endsWith("10bit"),
  );
  await expect(view.locator(".chart rect.fill")).toHaveCount(ok.length);
  await expect(view.locator("thead th", { hasText: "First-frame latency" })).toHaveCount(0);

  await page.locator("#f-threads").selectOption("4");
  await expect(view.locator("tbody td", { hasText: "Incorrect output" })).toHaveCount(1);
  // CPU time is null on the x86 machine.
  await page.locator("#f-machine").selectOption(X86);
  await expect(view.locator("tbody tr").first().locator("td").nth(6)).toHaveText("not measured");
});

test("first-frame latency is shown only when it has a value", async ({ page }) => {
  await withData(page);
  const ns = 12_500_000;
  await serveSummary(page, (s) => {
    s.cells.find(
      (c: Json) => c.machine_id === X86 && c.status === "ok" && c.threads === 1,
    ).first_frame_latency_ns = ns;
  });
  await page.goto(`${full}&machine=${X86}&threads=1`);
  const view = page.locator("#view-throughput");
  await expect(view.locator("thead th", { hasText: "First-frame latency" })).toHaveCount(1);
  await expect(view.locator("tbody td", { hasText: `${(ns / 1e6).toFixed(1)} ms` })).toHaveCount(1);
});

test("thread scaling shows each requested thread budget", async ({ page }) => {
  await withData(page);
  await page.goto(`${full}&machine=${ARM}&depth=8&scale=fixture-a`);
  const view = page.locator("#view-scaling");
  await expect(view.locator("thead th")).toHaveText([
    "Stream",
    "1 requested thread",
    "4 requested threads",
  ]);
  const cell = s1.cells.find(
    (c: Json) =>
      c.machine_id === ARM &&
      c.case_id === "example-1080p-8bit" &&
      c.threads === 4 &&
      c.implementation === "fixture-a",
  );
  await expect(view.locator("tbody tr", { hasText: caseName("example-1080p-8bit") })).toContainText(
    `${two(cell.scaling_vs_1t)} against 1 thread`,
  );
});

test("unsupported data versions and kinds have their own state", async ({ page }) => {
  await withData(page);
  await serveSummary(page, (s) => (s.schema = "splotbench.summary/2"), DS2);
  await serveSummary(page, (s) => (s.workload.kind = "encode"), DS3);
  await page.goto(`/benchmarks/?dataset=${DS2}`);
  await expect(status(page)).toHaveAttribute("data-state", "unsupported");
  await expect(status(page)).toContainText("splotbench.summary/2");
  await expect(status(page)).toContainText(
    "This page does not support the data version of this dataset.",
  );
  await page.locator("#f-dataset").selectOption(DS3);
  await expect(status(page)).toContainText('the workload kind "encode"');
  await expect(status(page)).toContainText("This page does not support this kind of data.");
  await expect(status(page).getByRole("link", { name: "Dataset index" })).toHaveAttribute(
    "href",
    `${base}index.json`,
  );
  await expect(status(page)).not.toContainText("downloads");
  await page.locator("#f-dataset").selectOption(DS1);
  await expect(status(page)).toBeHidden();
  await expect(page.locator("#view-throughput")).toBeVisible();
});

test("an unsupported index version has its own state", async ({ page }) => {
  await withData(page);
  await serveIndex(page, (i) => (i.schema = "splotbench.index/2"));
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

test("a missing file shows the error state", async ({ page }) => {
  await withData(page, "missing");
  await page.goto("/benchmarks/");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText("HTTP 404");
});

test("downloads resolve from the dataset metadata", async ({ page }) => {
  await withData(page);
  await serveSummary(page, (s) => (s.corpus.source = "file:///fixtures/corpus"));
  await page.goto(full);
  const dir = `${base}datasets/${DS1}/`;
  const files = page.locator("#view-downloads");
  const expected: [string, string][] = [
    ...s1.machines.map((m: Json): [string, string] => [
      `Raw bundle: ${m.machine_id} (${m.role})`,
      `${dir}${m.bundle.path}`,
    ]),
    ["Summary as CSV", `${dir}${s1.downloads.csv}`],
    ["Campaign lock", `${dir}${s1.downloads.lock}`],
    ["Manifest", `${dir}${s1.downloads.manifest}`],
    ["Checksums (SHA-256)", `${dir}${s1.downloads.checksums}`],
    ["Reproduction instructions", s1.reproduce.instructions],
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
  // The generator builds every decoder from source. An upstream release asset is an edit.
  await serveSummary(page, (s) => (impl("fixture-c", s).build_origin = "upstream-release-asset"));
  await page.goto(`${full}&machine=${ARM}&threads=1&depth=8`);
  const a = label("fixture-a");
  const b = label("fixture-b");
  const checks = page.locator(".checks label");
  await expect(checks).toHaveText([a, b, label("fixture-c")]);
  const buildA = s1.builds.find((x: Json) => x.implementation === "fixture-a");
  await expect(checks.first()).not.toContainText(buildA.version_output);

  await page.locator("#view-throughput tbody").first().getByRole("link", { name: b }).click();
  const details = page.locator("details.prov[open]", {
    has: page.locator("summary", { hasText: b }),
  });
  await expect(details).toBeVisible();
  await expect(details).toContainText(impl("fixture-b").commit);
  await expect(details).toContainText(
    "Built by the harness from the release source. Not an upstream binary.",
  );
  await expect(details.getByRole("link", { name: impl("fixture-b").release.url })).toBeVisible();
  const sha = s1.builds.find(
    (x: Json) => x.implementation === "fixture-b" && x.machine_id === ARM,
  ).binary_sha256;
  await expect(details).toContainText(sha);
  await details.getByRole("button", { name: `Copy the provenance of ${b}` }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`Commit: ${impl("fixture-b").commit}`);
  expect(copied).toContain(`Binary SHA-256: ${sha}`);
  expect(copied).toContain("Machine: Fixture ARM CPU");

  const c = page.locator("details.prov", {
    has: page.locator("summary", { hasText: label("fixture-c") }),
  });
  await c.locator("summary").click();
  await expect(c).toContainText("Official binary from the upstream release.");
  const dev = page.locator("details.prov", { has: page.locator("summary", { hasText: a }) });
  await dev.locator("summary").click();
  await expect(dev).toContainText("Development commit");
  await expect(dev).toContainText(buildA.version_output);
  await page.locator("#machine-details summary").click();
  await expect(page.locator("#machine-details")).toContainText("neon");
  await page.locator("#settings-details summary").click();
  await expect(page.locator("#settings-details")).toContainText("decode-discard");
});

test("history connects only datasets with the same series", async ({ page }) => {
  await withData(page);
  const loaded: string[] = [];
  page.on("request", (r) => r.url().includes("summary.json") && loaded.push(r.url()));
  await page.goto(`${full}&machine=${X86}&threads=1&depth=8`);
  await expect(page.locator("#view-throughput")).toBeVisible();
  expect(loaded).toHaveLength(1);
  await page.locator("#bench-history summary").click();
  const rows = page.locator("#bench-history tbody tr");
  // DS3 measured the x86 machine with another fingerprint: another series.
  const x86 = indexJson()
    .datasets.filter((d: Json) =>
      d.series.some((x: Json) => x.machine_id === X86 && x.series_id === s1.machines[1].series_id),
    )
    .map((d: Json) => d.dataset_id);
  expect(x86).toEqual([DS1, DS2, DS4]);
  await expect(rows).toHaveCount(x86.length);
  for (const id of x86) await expect(rows.filter({ hasText: id })).toHaveCount(1);
  await expect(rows.filter({ hasText: DS3 })).toHaveCount(0);
  const s2 = summary(DS2);
  await expect(rows.filter({ hasText: DS2 })).toContainText(label("fixture-b", s2));
  expect(loaded.length).toBeGreaterThan(1);

  // The ARM machine kept its fingerprint, so DS3 is in its series.
  await page.locator("#f-machine").selectOption(ARM);
  await page.locator("#bench-history summary").click();
  await expect(rows.filter({ hasText: DS3 })).toHaveCount(1);
});

test("every generated dataset loads without console errors or CSP violations", async ({ page }) => {
  const problems = watchProblems(page);
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await withData(page);
  for (const id of [DS1, DS2, DS3, DS4]) {
    await page.goto(`/benchmarks/?dataset=${id}`);
    await expect(page.locator("#view-throughput .chart svg")).toBeVisible();
    await page.locator("#bench-history summary").click();
    await expect(page.locator("#bench-history tbody tr").first()).toBeVisible();
    await page.evaluate(() =>
      document.querySelectorAll("details.prov").forEach((d) => d.setAttribute("open", "")),
    );
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(page.locator("#view-throughput .chart svg")).toHaveAttribute("width", /\d+/);
  expect(problems).toEqual([]);
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

test("latest_complete must name a complete official dataset", async ({ page }) => {
  await withData(page);
  await serveIndex(page, (i) => (i.latest_complete = DS2)); // synthetic
  await page.goto("/benchmarks/");
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText("does not name a complete official dataset");
});

test('origin "local" shows the "Not official data" banner', async ({ page }) => {
  await withData(page);
  await serveIndex(page, (i) => (i.datasets[0].origin = "local"));
  await serveSummary(page, (s) => (s.origin = "local"));
  await page.goto(full);
  const banner = page.locator('[data-banner="origin"]');
  await expect(banner).toContainText("Not official data.");
  await expect(banner).toContainText('"local"');
  // The banner is above the filter panel.
  expect(
    await banner.evaluate(
      (b) => !!(b.compareDocumentPosition(document.querySelector(".filters")!) & 4),
    ),
  ).toBe(true);
});

test("a summary that differs from its index entry is invalid data", async ({ page }) => {
  await withData(page);
  await serveSummary(page, (s) => (s.origin = "local"));
  await page.goto(full);
  await expect(status(page)).toHaveAttribute("data-state", "error");
  await expect(status(page)).toContainText("differs from the index entry");
});

const invalid: [string, (s: Json) => void, string][] = [
  [
    "a failed cell with a frame rate",
    (s) => (s.cells.find((c: Json) => c.status !== "ok").fps_median = 100),
    "and the metric fps_median",
  ],
  ["an unknown cell status", (s) => (s.cells[0].status = "fast"), 'the unknown value "fast"'],
  [
    "a release identity without a release",
    (s) => (impl("fixture-b", s).release = null),
    'release must be set exactly when the identity is "release"',
  ],
  [
    "a development identity with a release build origin",
    (s) => (impl("fixture-a", s).build_origin = "source-release"),
    "does not match the identity",
  ],
  [
    "a release identity built from development source",
    (s) => (impl("fixture-b", s).build_origin = "source-development"),
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
    "an exclusion that names an unknown implementation",
    (s) => (s.aggregates.find((a: Json) => a.excluded.length).excluded[0].implementation = "x"),
    'unknown implementation "x"',
  ],
  [
    "status counts without one status",
    (s) => delete s.coverage.status_counts.error,
    "summary.coverage.status_counts.error is not a number.",
  ],
  [
    "an oversized list",
    (s) => (s.machines[0].threads = Array.from({ length: 17 }, (_, i) => i + 1)),
    "has more than 16 entries",
  ],
];
for (const [name, change, message] of invalid) {
  test(`invalid data: ${name}`, async ({ page }) => {
    await withData(page);
    await serveSummary(page, change);
    await page.goto(full);
    await expect(status(page)).toHaveAttribute("data-state", "error");
    await expect(status(page)).toContainText(message);
    await expect(page.locator("#view-throughput")).toHaveCount(0);
  });
}

test("a real CPU feature list loads; an absurd one is refused", async ({ page }) => {
  // A current x86-64 CPU reports well over 100 feature flags (the first published dataset has 138).
  const problems = watchProblems(page);
  await withData(page);
  await serveSummary(page, (s) => {
    s.machines[0].fingerprint.cpu.isa = Array.from({ length: 300 }, (_, i) => `flag${i}`);
  });
  await page.goto(full);
  await expect(page.locator("#view-throughput")).toBeVisible();
  await expect(status(page)).not.toContainText("could not be loaded");
  expect(problems).toEqual([]);

  await serveSummary(page, (s) => {
    s.machines[0].fingerprint.cpu.isa = Array.from({ length: 2000 }, (_, i) => `flag${i}`);
  });
  await page.goto(full);
  await expect(status(page)).toContainText("fingerprint.cpu.isa has more than 1024 entries.");
});

test("oversized index list and oversized file are refused", async ({ page }) => {
  await withData(page);
  await serveIndex(page, (i) => {
    i.datasets = Array.from({ length: 1001 }, (_, n) => ({
      ...i.datasets[0],
      dataset_id: `ds-${String(n).padStart(16, "0")}`,
    }));
  });
  await page.goto("/benchmarks/");
  await expect(status(page)).toContainText("index.datasets has more than 1000 entries.");

  await withData(page);
  await serve(page, `datasets/${DS1}/summary.json`, `{${" ".repeat(5_000_001)}}`);
  await page.goto(full);
  await expect(status(page)).toContainText("is larger than 5 MB.");
});

test("a release URL that is not https is shown as text", async ({ page }) => {
  await withData(page);
  await serveSummary(page, (s) => (impl("fixture-b", s).release.url = "http://example.com/v1"));
  await page.goto(`${full}&machine=${ARM}`);
  const b = page.locator("details.prov", {
    has: page.locator("summary", { hasText: label("fixture-b") }),
  });
  await b.locator("summary").click();
  await expect(b).toContainText("http://example.com/v1");
  await expect(b.locator('a[href^="http:"]')).toHaveCount(0);
});

test("stream details show the input identity", async ({ page }) => {
  await withData(page);
  await page.goto(`${full}&depth=8&q=720`);
  const d = page.locator("#streams-details");
  await d.locator("summary").click();
  const c = s1.cases.find((x: Json) => x.id === "example-720p-8bit");
  await expect(d).toContainText(c.input_sha256);
  await expect(d).toContainText(`${c.frames} frames`);
  await expect(d.getByRole("link", { name: c.url })).toHaveAttribute("href", c.url);
});

test("the filters work with the keyboard", async ({ page }) => {
  await withData(page);
  await page.goto(`${full}&machine=${ARM}&depth=8`);
  const rows = page.locator("#view-throughput tbody tr");
  await expect(rows).toHaveCount(6);
  await page.locator("#f-q").focus();
  await page.keyboard.type("720");
  await expect(page.locator("#view-throughput tbody")).toHaveCount(1);
  await expect(page.locator("#f-q")).toBeFocused();
  const box = page.getByRole("checkbox", { name: label("fixture-c") });
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

for (const loaded of [false, true]) {
  const name = loaded ? "loaded" : "production";
  const open = async (page: Page) => {
    await withData(page, loaded ? "main" : "empty");
    await page.goto(loaded ? `${full}&machine=${X86}` : "/benchmarks/");
    if (!loaded) {
      await expect(status(page)).toHaveAttribute("data-state", "empty");
      return;
    }
    await expect(page.locator("#view-throughput .chart svg")).toBeVisible();
    for (const s of await page.locator("details.prov summary").all()) await s.click();
    await expect(page.locator("#bench-history tbody tr").first()).toBeVisible();
  };
  for (const width of [320, 390, 768, 1440]) {
    test(`benchmarks ${name}: no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBe(0);
    });
  }
  for (const width of [390, 1440]) {
    test(`benchmarks ${name}: axe finds no violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
}

// Fields that splotlabs/benchmarks allows as null: schemas/summary.schema.json and the
// definitions it uses in schemas/common.schema.json. "*" is every element of a list. The
// release object itself is nullable too, but only together with a development identity, so it
// is covered by the identity tests.
const nullable = [
  "machines.*.measured_utc.first",
  "machines.*.measured_utc.last",
  "machines.*.fingerprint.os.version",
  "machines.*.fingerprint.os.kernel",
  "machines.*.fingerprint.cpu.model",
  "machines.*.fingerprint.cpu.physical_cores",
  "machines.*.fingerprint.cpu.logical_cores",
  "machines.*.fingerprint.cpu.performance_cores",
  "machines.*.fingerprint.cpu.efficiency_cores",
  "machines.*.fingerprint.memory_bytes",
  "machines.*.fingerprint.python",
  "machines.*.fingerprint.power",
  "machines.*.fingerprint.affinity",
  "implementations.*.release.url",
  "builds.*.version_output",
  "cases.*.film_grain",
  "cells.*.build_id",
  "cells.*.frames",
  "cells.*.wall_ns_median",
  "cells.*.fps_median",
  "cells.*.fps_min",
  "cells.*.fps_max",
  "cells.*.fps_mad",
  "cells.*.cpu_ns_median",
  "cells.*.peak_rss_bytes_median",
  "cells.*.first_frame_latency_ns",
  "cells.*.scaling_vs_1t",
  "aggregates.*.geomean_ratio",
  "aggregation.harness.commit",
];
// The same for schemas/index.schema.json, which the page reads but does not show.
const nullableIndex = ["datasets.*.measured_utc.first", "datasets.*.measured_utc.last"];

function setNull(node: Json, path: string[]) {
  const [key, ...rest] = path;
  if (node === null || typeof node !== "object") return;
  if (key === "*") return node.forEach((x: Json) => setNull(x, rest));
  if (!rest.length) node[key] = null;
  else setNull(node[key], rest);
}

for (const id of [DS1, DS2, DS3, DS4]) {
  test(`every schema-nullable field may be null: ${id}`, async ({ page }) => {
    const problems = watchProblems(page);
    await withData(page);
    let body = "";
    await page.route(`${base}datasets/${id}/summary.json`, (route) =>
      route.fulfill({ body, contentType: "text/plain; charset=utf-8", headers: cors }),
    );
    const index = indexJson();
    for (const path of nullableIndex) setNull(index, path.split("."));
    await serve(page, "index.json", JSON.stringify(index));
    for (const path of nullable) {
      const s = summary(id);
      setNull(s, path.split("."));
      body = JSON.stringify(s);
      await page.goto(`/benchmarks/?dataset=${id}`);
      await expect(page.locator("#view-throughput"), path).toBeVisible();
      // Provenance details only: the history would start requests that the next page load cancels.
      await page.evaluate(() =>
        document
          .querySelectorAll("details.prov:not(#bench-history)")
          .forEach((d) => d.setAttribute("open", "")),
      );
      const text = await page.locator("#bench-app").innerText();
      expect(text, path).not.toMatch(/\b(null|undefined|NaN)\b/);
    }
    // Fast navigation cancels requests for the page's own assets (for example the favicon).
    // A failed request to the data origin still counts.
    expect(problems.filter((p) => !p.startsWith(`failed: ${origin}/`))).toEqual([]);
  });
}

test("null facts are shown as not known or not recorded", async ({ page }) => {
  await withData(page);
  await serveSummary(page, (s) => {
    for (const m of s.machines) {
      m.fingerprint.cpu.model = null;
      m.fingerprint.os.version = null;
      m.measured_utc = { first: null, last: null };
    }
    impl("fixture-b", s).release.url = null;
    s.aggregation.harness.commit = null;
  });
  await page.goto(`${full}&machine=${ARM}`);
  await expect(page.locator("#f-machine option").first()).toHaveText(
    `CPU model not known · FixtureOS (version not known) · aarch64 (${ARM})`,
  );
  await page.evaluate(() =>
    document.querySelectorAll("details.prov").forEach((d) => d.setAttribute("open", "")),
  );
  const row = (box: string, key: string) =>
    page.locator(`${box} .kv div`, {
      has: page.locator("dt", { hasText: new RegExp(`^${key}$`) }),
    });
  await expect(row("#machine-details", "CPU").locator("dd")).toHaveText("not recorded");
  await expect(row("#machine-details", "Measured \\(UTC\\)").locator("dd")).toHaveText(
    "not measured",
  );
  await expect(row("#settings-details", "Harness commit").locator("dd")).toHaveText("not recorded");
  const b = page.locator("details.prov", {
    has: page.locator("summary", { hasText: label("fixture-b") }),
  });
  await expect(row(`#${await b.getAttribute("id")}`, "Release page").locator("dd")).toHaveText(
    "not recorded",
  );
});

test("other enum values of the schema are shown", async ({ page }) => {
  const problems = watchProblems(page);
  await withData(page);
  await serveSummary(page, (s) => {
    s.machines[0].run_state = "in-progress";
    s.machines[0].class = "verified";
    s.builds[0].class = "development";
    s.cases[0].chroma = "4:0:0";
    s.cases[0].bit_depth = 12;
  });
  await page.goto(`${full}&machine=${ARM}`);
  await expect(page.locator('[data-banner="partial"]')).toContainText(`${ARM}: run in-progress.`);
  await expect(page.locator("#f-depth option")).toHaveText(["8-bit", "10-bit", "12-bit"]);
  await page.locator("#f-depth").selectOption("12");
  await expect(page.locator("#view-throughput tbody th").first()).toContainText("4:0:0");
  expect(problems).toEqual([]);
});

const unsupported: [string, (s: Json) => void, string][] = [
  ["another methodology", (s) => (s.methodology.id = "decode-cli-wall/2"), "decode-cli-wall/2"],
  ["another output policy", (s) => (s.methodology.output_policy = "raw"), "output_policy"],
  ["another aggregation", (s) => (s.aggregation.version = "summary/2"), "summary/2"],
  ["another metric unit", (s) => (s.metrics.peak_rss.unit = "KiB"), "peak_rss is not bytes"],
];
for (const [name, change, message] of unsupported) {
  test(`unsupported data: ${name}`, async ({ page }) => {
    await withData(page);
    await serveSummary(page, change);
    await page.goto(full);
    await expect(status(page)).toHaveAttribute("data-state", "unsupported");
    await expect(status(page)).toContainText(message);
  });
}

test("an index entry with another workload is not loaded", async ({ page }) => {
  await withData(page);
  await serveIndex(page, (i) => (i.datasets[1].workload = "encode"));
  const loaded: string[] = [];
  page.on("request", (r) => r.url().includes(`${DS2}/summary.json`) && loaded.push(r.url()));
  await page.goto(`/benchmarks/?dataset=${DS2}`);
  await expect(status(page)).toHaveAttribute("data-state", "unsupported");
  await expect(status(page)).toContainText('the workload "encode"');
  await expect(status(page)).toContainText("This page does not support this kind of data.");
  expect(loaded).toEqual([]);
});

test("relative paths follow the schema and stay inside the dataset", async ({ page }) => {
  await withData(page);
  await serveSummary(page, (s) => (s.machines[0].bundle.path = "bundles/run+1.tar.gz"));
  await page.goto(full);
  await expect(
    page.locator("#view-downloads").getByRole("link", { name: `Raw bundle: ${ARM} (arm64)` }),
  ).toHaveAttribute("href", `${base}datasets/${DS1}/bundles/run+1.tar.gz`);
  for (const path of ["%2e%2e/%2e%2e/x", "https://example.com/x", "/x", "a/../../x"]) {
    await serveSummary(page, (s) => (s.machines[0].bundle.path = path));
    await page.goto(full);
    await expect(status(page), path).toHaveAttribute("data-state", "error");
  }
});

test("stream details show film grain", async ({ page }) => {
  await withData(page);
  await page.goto(`${full}&depth=8&q=720`);
  const c = s1.cases.find((x: Json) => x.id === "example-720p-8bit");
  const expected = c.film_grain === null ? "not known" : c.film_grain ? "yes" : "no";
  await page.locator("#streams-details summary").click();
  await expect(
    page.locator("#streams-details .kv div", { hasText: `${c.name}: film grain` }).locator("dd"),
  ).toHaveText(expected);
});

test("thread budgets are neutral; more than three decoders stay distinguishable", async ({
  page,
}) => {
  await withData(page);
  await serveSummary(page, (s) => {
    // Four copies of fixture-a: seven decoders in all.
    const builds = s.builds.filter((b: Json) => b.implementation === "fixture-a");
    const cells = s.cells.filter((x: Json) => x.implementation === "fixture-a");
    for (const x of ["d", "e", "f", "g"]) {
      const id = (b: string) => `${b.slice(0, -4)}${x.repeat(4).replace(/[^a-f]/g, "0")}`;
      const decoder = `fixture-${x}`;
      s.implementations.push({ ...impl("fixture-a", s), id: decoder, name: `Fixture ${x}` });
      for (const b of builds)
        s.builds.push({ ...b, implementation: decoder, build_id: id(b.build_id) });
      for (const c of cells)
        s.cells.push({ ...c, implementation: decoder, build_id: id(c.build_id) });
    }
  });
  await page.goto(`${full}&machine=${ARM}&depth=8`);
  const scaling = page.locator("#view-scaling .chart");
  await expect(scaling.locator("g.row.sn").first()).toBeVisible();
  await expect(scaling.locator("g.row.s0, g.row.s1, g.row.s2")).toHaveCount(0);
  const throughput = page.locator("#view-throughput .chart");
  await expect(throughput.locator("g.row.s0.alt").first()).toBeVisible();
  await expect(throughput.locator("text.lbl", { hasText: "Fixture d" }).first()).toBeVisible();
  await expect(page.locator("#view-throughput .note")).toContainText(
    "Bar styles repeat after six decoders. The name beside each bar identifies the decoder.",
  );
});

test("the history header names the decoders", async ({ page }) => {
  await withData(page);
  await page.goto(`${full}&machine=${X86}`);
  await page.locator("#bench-history summary").click();
  await expect(page.locator("#bench-history thead th")).toHaveText([
    "Dataset",
    ...["fixture-a", "fixture-b", "fixture-c"].map((x) => impl(x).name),
  ]);
});
