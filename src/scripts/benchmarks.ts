// The benchmarks page: loads the published data and draws a summary, then the views that the
// reader opens.
// Every string from the data is set as text. Links from the data must be https.
import { benchmarks } from "../data/site";
import {
  buildOriginText,
  DataError,
  httpsUrl,
  implLabel,
  MAX_BYTES,
  parseIndex,
  parseSummary,
  UnsupportedError,
  type BenchIndex,
  type Build,
  type Case,
  type Cell,
  type Implementation,
  type IndexEntry,
  type Machine,
  type Status,
  type Summary,
} from "./bench-data";

interface View {
  dataset: string;
  machine: string;
  depth: number;
  threads: number;
  baseline: string;
  decoders: string[];
  q: string;
  res: string;
  scale: string;
  /** The views that are open. */
  open: string[];
}
/** The views that start closed. The link of the page keeps the open ones. */
const folds = ["throughput", "speedup", "scaling"];

const statusEl = document.getElementById("bench-status");
const app = document.getElementById("bench-app");
const summaries = new Map<string, Promise<Summary>>();
let base: URL;
let index: BenchIndex;
let current: Summary | null = null;
let view: View;
let entry: IndexEntry;
/** Chart draw functions. A draw function removes itself when its chart left the page. */
const charts = new Set<() => void>();
const redraw = () => charts.forEach((draw) => draw());
let body: { summary: HTMLElement; detail: HTMLElement } | null = null;
type Opt = [string, string];

// ---------- Small DOM helpers. They never parse HTML. ----------

type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> | null = null,
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
function svg(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}
/** A link for an https URL from the data. Any other value is shown as text. */
function ext(url: string, text = url): HTMLElement {
  const safe = httpsUrl(url);
  return safe ? h("a", { href: safe }, text) : h("span", null, text);
}
function kv(rows: [string, Kid][]): HTMLDListElement {
  return h(
    "dl",
    { class: "kv" },
    ...rows.map(([k, v]) => h("div", null, h("dt", null, k), h("dd", null, v))),
  );
}
const code = (text: string) => h("code", null, text);
function copyButton(text: string, what: string): HTMLButtonElement {
  // enhance.ts handles every button[data-copy] on the page.
  const b = h("button", { type: "button", "aria-label": `Copy the ${what}` }, "Copy");
  b.dataset.copy = text;
  return b;
}
function tableWrap(label: string, table: HTMLTableElement): HTMLElement {
  return h("div", { class: "table-wrap", role: "region", "aria-label": label, tabindex: 0 }, table);
}

// ---------- Formats. They change units only; they compute no statistics. ----------

const f1 = new Intl.NumberFormat("en", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f3 = new Intl.NumberFormat("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const f0 = new Intl.NumberFormat("en");
const notMeasured = () => h("span", { class: "muted" }, "not measured");
const notRecorded = () => h("span", { class: "muted" }, "not recorded");
const opt = (v: number | null, fmt: (v: number) => string): Kid =>
  v === null ? notMeasured() : fmt(v);
const fps = (v: number) => f1.format(v);
const ratio = (v: number) => `${f2.format(v)}×`;
const names = new Intl.ListFormat("en");
const statusText: Record<Status, string> = {
  ok: "OK",
  incorrect: "Incorrect output",
  unsupported: "Unsupported",
  timeout: "Timeout",
  error: "Error",
  interrupted: "Interrupted",
  "not-run": "Not run",
};
// The thread budget is the value given to the thread option of each decoder.
const threadText = (t: number) => `${t} requested ${t === 1 ? "thread" : "threads"}`;
const threadShort = (t: number) => `${t} ${t === 1 ? "thread" : "threads"}`;
const cpuText = (m: Machine) => m.fingerprint.cpu.model || "CPU model not known";
const osText = (m: Machine) =>
  [m.fingerprint.os.name || "OS not known", m.fingerprint.os.version ?? "(version not known)"].join(
    " ",
  );
const machineLabel = (m: Machine) =>
  `${cpuText(m)} · ${osText(m)} · ${m.fingerprint.arch} (${m.machine_id})`;
const caseLabel = (c: Case) => `${c.width}×${c.height} · ${c.bit_depth}-bit · ${c.chroma}`;

// ---------- Data loading ----------

class HttpError extends Error {}

/** Fetches and parses JSON. The raw file host sends text/plain, so the type is not checked. */
async function getJson(url: URL, maxBytes: number): Promise<unknown> {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new HttpError(`The server answered HTTP ${res.status} for ${url.pathname}.`);
  const text = await res.text();
  // The string length counts UTF-16 units. That is a lower bound of the size in bytes.
  if (text.length > maxBytes) {
    throw new HttpError(`The file ${url.pathname} is larger than ${maxBytes / 1e6} MB.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`The file ${url.pathname} is not valid JSON.`);
  }
}

function datasetDir(entry: IndexEntry): URL {
  return new URL(entry.path.endsWith("/") ? entry.path : `${entry.path}/`, base);
}

function loadSummary(e: IndexEntry): Promise<Summary> {
  let p = summaries.get(e.dataset_id);
  if (!p) {
    p = getJson(new URL("summary.json", datasetDir(e)), MAX_BYTES.summary).then((raw) =>
      parseSummary(raw, e),
    );
    summaries.set(e.dataset_id, p);
  }
  return p;
}

const cellMaps = new WeakMap<Summary, Map<string, Cell>>();
/** The cell of one machine, stream, thread budget and decoder. The map is built once. */
function cellOf(s: Summary, machine: string, caseId: string, threads: number, impl: string) {
  let map = cellMaps.get(s);
  if (!map) {
    map = new Map(
      s.cells.map((c) => [`${c.machine_id}|${c.case_id}|${c.threads}|${c.implementation}`, c]),
    );
    cellMaps.set(s, map);
  }
  return map.get(`${machine}|${caseId}|${threads}|${impl}`);
}

const depthsOf = (s: Summary) =>
  [...new Set(s.cases.map((c) => c.bit_depth))].sort((a, b) => a - b);
const largest = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), 0);

// ---------- States ----------

function state(kind: string, title: string, detail = "", link = false) {
  if (!statusEl) return;
  statusEl.dataset.state = kind;
  statusEl.hidden = kind === "loaded";
  statusEl.replaceChildren(
    h("p", { class: "bench-state" }, title),
    detail ? h("p", null, detail) : "",
    link ? h("p", null, h("a", { href: new URL("index.json", base).href }, "Dataset index")) : "",
  );
}

function fail(e: unknown) {
  if (e instanceof UnsupportedError) {
    state(
      "unsupported",
      e.cause === "workload"
        ? "This page does not support this kind of data."
        : "This page does not support the data version of this dataset.",
      e.message,
      true,
    );
  } else if (e instanceof DataError || e instanceof HttpError) {
    state("error", "The results could not be loaded.", e.message, true);
  } else {
    state("error", "The results could not be loaded.", "The data request failed.");
  }
}

// ---------- View state and URL ----------

function sanitize(s: Summary, p: URLSearchParams): View {
  const pick = <T>(v: T | null, options: T[], fallback: T) =>
    v !== null && options.includes(v) ? v : fallback;
  const machine = pick(
    p.get("machine"),
    s.machines.map((m) => m.machine_id),
    s.machines[0].machine_id,
  );
  const m = s.machines.find((x) => x.machine_id === machine)!;
  const depths = depthsOf(s);
  const depth = pick(Number(p.get("depth")), depths, depths[0]);
  const impls = s.implementations.map((i) => i.id);
  const asked = p.get("decoders");
  const decoders = asked === null ? impls : asked.split(",").filter((d) => impls.includes(d));
  const resolutions = resolutionsOf(s, depth);
  return {
    dataset: s.dataset_id,
    machine,
    depth,
    threads: pick(Number(p.get("threads")), m.threads, largest(m.threads)),
    baseline: pick(p.get("baseline"), impls, impls[0]),
    decoders,
    q: (p.get("q") ?? "").slice(0, 100),
    res: pick(p.get("res"), resolutions, ""),
    scale: pick(p.get("scale"), impls, decoders[0] ?? impls[0]),
    open: openOf(p),
  };
}

const openOf = (p: URLSearchParams) =>
  folds.filter((f) => (p.get("open") ?? "").split(",").includes(f));

function resolutionsOf(s: Summary, depth: number): string[] {
  const set = s.cases.filter((c) => c.bit_depth === depth).map((c) => `${c.width}x${c.height}`);
  return [...new Set(set)];
}

function toParams(v: View): URLSearchParams {
  return new URLSearchParams({
    dataset: v.dataset,
    machine: v.machine,
    depth: String(v.depth),
    threads: String(v.threads),
    baseline: v.baseline,
    decoders: v.decoders.join(","),
    q: v.q,
    res: v.res,
    scale: v.scale,
    open: v.open.join(","),
  });
}

function writeUrl() {
  const url = new URL(location.href);
  url.search = toParams(view).toString();
  history.replaceState(null, "", url);
}

// ---------- Start ----------

async function start() {
  if (!app || !statusEl) return;
  base = new URL(benchmarks.dataBase);
  state("loading", "Loading the results…");
  try {
    index = parseIndex(await getJson(new URL("index.json", base), MAX_BYTES.index));
  } catch (e) {
    fail(e);
    return;
  }
  if (!index.datasets.length) {
    state("empty", "Results are not published yet.", "The data index lists no dataset.");
    return;
  }
  const params = new URLSearchParams(location.search);
  const wanted = params.get("dataset");
  const known = index.datasets.some((d) => d.dataset_id === wanted);
  // Without a promoted dataset: the newest complete dataset, else the newest dataset.
  const newest = (ds: IndexEntry[]) =>
    ds.reduce((a, b) => (b.published_utc > a.published_utc ? b : a));
  const complete = index.datasets.filter((d) => d.complete);
  const fallback = newest(complete.length ? complete : index.datasets);
  const id = known ? wanted! : (index.latest_complete ?? fallback.dataset_id);
  const notes = [
    wanted && !known
      ? `The dataset "${wanted}" is not in the index. This is the default dataset.`
      : "",
    index.latest_complete === null
      ? `No complete official dataset is marked as current. The default is the newest ${complete.length ? "complete " : ""}dataset.`
      : "",
  ];
  const note = notes.filter(Boolean).join(" ");
  app.addEventListener("click", openTarget);
  let width = 0;
  new ResizeObserver(() => {
    if (app.clientWidth === width) return;
    width = app.clientWidth;
    redraw();
  }).observe(app);
  app.hidden = false;
  await selectDataset(id, params, note);
}

async function selectDataset(id: string, params: URLSearchParams, note = "") {
  entry = index.datasets.find((d) => d.dataset_id === id)!;
  current = null;
  view = { ...view, dataset: id, open: openOf(params) };
  render(note);
  state("loading", "Loading the dataset…");
  let s: Summary;
  try {
    // The index schema allows only decode. Another workload is not loaded as decode data.
    if (entry.workload !== "decode") {
      throw new UnsupportedError(`The dataset has the workload "${entry.workload}".`, "workload");
    }
    s = await loadSummary(entry);
  } catch (e) {
    if (view.dataset !== id) return;
    history.replaceState(null, "", `?${new URLSearchParams({ dataset: id })}`);
    fail(e);
    return;
  }
  if (view.dataset !== id) return; // The reader selected another dataset in the meantime.
  guarded(() => {
    current = s;
    view = sanitize(s, params);
    writeUrl();
    state("loaded", "");
    render(note);
  });
}

/** Runs a render step. Any failure ends in the error state, never in a stuck page. */
function guarded(step: () => void) {
  try {
    step();
  } catch (e) {
    current = null;
    body?.summary.replaceChildren();
    body?.detail.replaceChildren();
    fail(e);
  }
}

/** A link to a closed details element opens it. */
function openTarget(event: Event) {
  const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  const target = a && document.getElementById(a.hash.slice(1));
  if (target instanceof HTMLDetailsElement) target.open = true;
}

// ---------- Rendering ----------

/** Draws the forms and the results. Use update() when the form options stay the same. */
function render(note = "") {
  if (!app) return;
  const active = document.activeElement;
  const focused = active && app.contains(active) ? active.getAttribute("name") : null;
  body = current
    ? { summary: h("div", { class: "bench-body" }), detail: h("div", { class: "bench-body" }) }
    : null;
  app.replaceChildren(
    note ? h("p", { class: "banner", "data-banner": "note" }, note) : "",
    ...(current ? banners(current) : []),
    scopeForm(current),
    body?.summary ?? "",
    current ? explore(current) : "",
    body?.detail ?? "",
  );
  if (focused) {
    const again = `[name="${CSS.escape(focused)}"]`;
    (
      app.querySelector<HTMLElement>(`${again}:checked`) ?? app.querySelector<HTMLElement>(again)
    )?.focus();
  }
  update();
}

/** Draws the results for the current view. Open details stay open. */
function update() {
  if (!app || !body || !current) return;
  const open = [...app.querySelectorAll("details[open]")].map((d) => d.id);
  charts.clear();
  const v = views(current);
  body.summary.replaceChildren(v.summary);
  body.detail.replaceChildren(...v.detail);
  for (const id of open) document.getElementById(id)?.setAttribute("open", "");
  redraw();
}

function field(name: string, label: string, options: Opt[], value: string) {
  const sel = h(
    "select",
    { id: `f-${name}`, name },
    ...options.map(([v, t]) => h("option", { value: v, selected: v === value }, t)),
  );
  return h("div", { class: "field" }, h("label", { for: `f-${name}` }, label), sel);
}

/** One choice of a few values, shown as a row of buttons. */
function choice(name: string, label: string, options: Opt[], value: string) {
  return h(
    "fieldset",
    { class: "field seg", id: `f-${name}` },
    h("legend", null, label),
    h(
      "div",
      null,
      ...options.map(([v, t]) =>
        h(
          "label",
          null,
          h("input", { type: "radio", name, value: v, checked: v === value }),
          h("span", null, t),
        ),
      ),
    ),
  );
}

/** The dataset, the machine, the bit depth and the thread budget: they apply to the whole page. */
function scopeForm(s: Summary | null): HTMLFormElement {
  const datasets = index.datasets.map((d): Opt => [
    d.dataset_id,
    [
      d.name,
      d.published_utc.slice(0, 10),
      d.origin,
      d.complete ? "" : "incomplete",
      d.workload === "decode" ? "" : d.workload,
      d.dataset_id, // Datasets of one campaign can share a name.
    ]
      .filter(Boolean)
      .join(" · "),
  ]);
  const f = h(
    "form",
    { class: "filters", "aria-label": "Dataset, machine and scope" },
    field("dataset", "Dataset", datasets, view.dataset),
  );
  if (s) {
    const m = machineOf(s);
    f.append(
      field(
        "machine",
        "Machine",
        s.machines.map((x): Opt => [x.machine_id, machineLabel(x)]),
        view.machine,
      ),
      choice(
        "depth",
        "Bit depth",
        depthsOf(s).map((d): Opt => [String(d), `${d}-bit`]),
        String(view.depth),
      ),
      choice(
        "threads",
        "Requested threads",
        m.threads.map((t): Opt => [String(t), String(t)]),
        String(view.threads),
      ),
    );
  }
  return listen(f);
}

/** The filters of the views that show each stream. */
function explore(s: Summary): HTMLElement {
  const m = machineOf(s);
  const impls = s.implementations.map((i): Opt => [i.id, implLabel(i)]);
  const f = h(
    "form",
    { class: "filters", "aria-label": "Benchmark filters" },
    field("baseline", "Baseline decoder", impls, view.baseline),
    field(
      "res",
      "Resolution",
      [
        ["", "All resolutions"],
        ...resolutionsOf(s, view.depth).map((r): Opt => [r, r.replace("x", "×")]),
      ],
      view.res,
    ),
    h(
      "div",
      { class: "field" },
      h("label", { for: "f-q" }, "Stream name"),
      h("input", { id: "f-q", name: "q", type: "search", value: view.q, autocomplete: "off" }),
    ),
    m.threads.length > 1 ? field("scale", "Decoder for thread scaling", impls, view.scale) : "",
    h(
      "fieldset",
      { class: "field checks" },
      h("legend", null, "Decoders"),
      ...s.implementations.map((i) =>
        h(
          "label",
          null,
          h("input", {
            type: "checkbox",
            name: "decoders",
            value: i.id,
            checked: view.decoders.includes(i.id),
          }),
          implLabel(i),
        ),
      ),
    ),
  );
  const sec = section("explore", "Every result.", [
    "Open a view to see the numbers of each stream. These filters apply to the views below.",
  ]);
  sec.append(listen(f));
  return sec;
}

function listen(f: HTMLFormElement): HTMLFormElement {
  f.addEventListener("submit", (e) => e.preventDefault());
  let typing = 0;
  f.addEventListener("input", (e) => {
    clearTimeout(typing);
    // The stream search waits for a pause in typing, so a large dataset does not redraw per key.
    if ((e.target as HTMLInputElement).name === "q")
      typing = window.setTimeout(() => onInput(e), 250);
    else onInput(e);
  });
  return f;
}

function onInput(e: Event) {
  if (!app) return;
  const name = (e.target as HTMLInputElement).name;
  // The two forms hold one view together.
  const data = new FormData();
  for (const f of app.querySelectorAll("form")) {
    for (const [k, v] of new FormData(f)) data.append(k, v);
  }
  const p = new URLSearchParams({ open: view.open.join(",") });
  for (const k of ["machine", "depth", "threads", "baseline", "res", "q", "scale"]) {
    const v = data.get(k);
    if (typeof v === "string") p.set(k, v);
  }
  p.set("decoders", data.getAll("decoders").join(","));
  if (name === "dataset") {
    const id = String(data.get("dataset"));
    p.set("dataset", id);
    void selectDataset(id, current ? toParams({ ...view, dataset: id }) : p);
    return;
  }
  const s = current;
  if (!s) return;
  guarded(() => {
    view = sanitize(s, p);
    writeUrl();
    // Machine and bit depth change the options of other fields.
    if (name === "machine" || name === "depth") render();
    else update();
  });
}

const machineOf = (s: Summary) => s.machines.find((m) => m.machine_id === view.machine)!;

function banners(s: Summary): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (s.origin === "synthetic") {
    out.push(
      h(
        "p",
        { class: "banner warn", "data-banner": "origin" },
        h("strong", null, "Synthetic test data. "),
        "These numbers are not measurements of real decoders. Do not use them.",
      ),
    );
  } else if (s.origin !== "official") {
    out.push(
      h(
        "p",
        { class: "banner warn", "data-banner": "origin" },
        h("strong", null, "Not official data. "),
        `The origin of this dataset is "${s.origin}". It is not an official published measurement.`,
      ),
    );
  }
  const cov = s.coverage;
  const unfinished = s.machines.filter((m) => m.run_state !== "complete");
  const missing = cov.roles_expected.filter((r) => !cov.roles_present.includes(r));
  if (!s.complete || unfinished.length || missing.length) {
    const counts = cov.status_counts
      .filter(([, n]) => n > 0)
      .map(([st, n]) => `${n} ${statusText[st].toLowerCase()}`)
      .join(", ");
    out.push(
      h(
        "p",
        { class: "banner", "data-banner": "partial" },
        h("strong", null, "Incomplete dataset. "),
        missing.length
          ? `No results exist for the expected machine roles ${missing.join(", ")}: the dataset has no machine and no cell for them. `
          : "",
        unfinished.map((m) => `${m.machine_id}: run ${m.run_state}. `).join(""),
        `Of ${cov.cells_expected} expected results: ${counts || "none"}. Each missing result shows its status.`,
      ),
    );
  }
  return out;
}

function meta(s: Summary): HTMLElement {
  return kv([
    ["Dataset", s.name],
    ["Dataset id", code(s.dataset_id)],
    ["Published", entry.published_utc],
    ["Methodology", code(s.methodology_id)],
    ["Suite", `${s.suite.id}, ${s.suite.cases_expected} cases expected`],
  ]);
}

// ---------- Views ----------

function views(s: Summary): { summary: HTMLElement; detail: HTMLElement[] } {
  const m = machineOf(s);
  const q = view.q.toLowerCase();
  const cases = s.cases.filter(
    (c) =>
      c.bit_depth === view.depth &&
      (!view.res || `${c.width}x${c.height}` === view.res) &&
      (!q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)),
  );
  const impls = s.implementations.filter((i) => view.decoders.includes(i.id));
  const keys = s.implementations.map((i) => i.id);
  // Six decoders have distinct bar styles. Beyond six the styles repeat; the names identify them.
  const repeats =
    keys.length > 6
      ? " Bar styles repeat after six decoders. The name beside each bar identifies the decoder."
      : "";
  const cell = (caseId: string, impl: string, threads = view.threads) =>
    cellOf(s, m.machine_id, caseId, threads, impl);
  const buildIndex = (b: Build | undefined) => (b ? s.builds.indexOf(b) : -1);
  const buildOf = (impl: string) =>
    s.builds.find((b) => b.implementation === impl && b.machine_id === m.machine_id);
  const label = (impl: string) => implLabel(s.implementations.find((i) => i.id === impl)!);
  const implLink = (impl: string, c?: Cell) => {
    const b = c ? s.builds.find((x) => x.build_id === c.build_id) : buildOf(impl);
    const i = buildIndex(b);
    return i < 0 ? h("span", null, label(impl)) : h("a", { href: `#build-${i}` }, label(impl));
  };
  const scope = `${machineLabel(m)}, ${threadText(view.threads)}, ${view.depth}-bit streams`;
  const empty = !cases.length
    ? "No stream matches the filters."
    : !impls.length
      ? "Select at least one decoder."
      : "";
  const aggregate = (impl: string, baseline: string, threads: number, depth: number) =>
    s.aggregates.find(
      (x) =>
        x.machine_id === m.machine_id &&
        x.threads === threads &&
        x.bit_depth === depth &&
        x.implementation === impl &&
        x.baseline === baseline,
    );
  /** The ratios of one decoder against a baseline at the selected thread budget, by stream. */
  const ratiosOf = (baseline: string) =>
    new Map(
      s.speedups
        .filter(
          (x) =>
            x.machine_id === m.machine_id && x.threads === view.threads && x.baseline === baseline,
        )
        .map((x) => [`${x.case_id}|${x.implementation}`, x.ratio]),
    );
  /** Why a stream has no ratio for a pair of decoders. */
  const why = (caseId: string, impl: string, baseline: string) =>
    [impl, baseline]
      .map((d) => [d, cell(caseId, d)?.status] as const)
      .filter(([, st]) => st !== "ok")
      .map(([d, st]) => `${label(d)}: ${st ? statusText[st] : "no result"}`)
      .join(", ") || "no ratio in the dataset";

  // Summary: the lead decoder against each other decoder. Every number is an aggregate or a
  // speedup of the dataset; the page only compares them with 1.
  const lead = s.implementations.find((i) => i.id === benchmarks.lead) ?? s.implementations[0];
  const rivals = s.implementations.filter((i) => i.id !== lead.id);
  const short = (i: Implementation) => i.name || i.id;
  const depthCases = s.cases.filter((c) => c.bit_depth === view.depth);
  // The headline says "faster" only when, for each pair, every stream of the bit depth matched
  // and the geometric mean, as the page prints it, is above 1.
  const ahead =
    rivals.length > 0 &&
    rivals.every((r) => {
      const a = aggregate(lead.id, r.id, view.threads, view.depth);
      return (
        a !== undefined &&
        a.geomean_ratio !== null &&
        a.n_matched === a.n_expected &&
        Number(a.geomean_ratio.toFixed(2)) > 1
      );
    });
  const rivalNames = names.format(rivals.map(short));
  const summary = h(
    "section",
    { class: "summary", id: "view-summary", "aria-labelledby": "view-summary-h" },
    h(
      "h3",
      { id: "view-summary-h" },
      !rivals.length
        ? `${short(lead)}.`
        : ahead
          ? `${short(lead)} is faster than ${rivalNames}.`
          : `${short(lead)} against ${rivalNames}.`,
    ),
  );
  if (!rivals.length) {
    summary.append(
      h("p", { class: "note" }, "This dataset has one decoder, so it has no comparison."),
    );
  } else {
    summary.append(
      h(
        "p",
        { class: "note" },
        `Geometric mean of the throughput ratio over the ${view.depth}-bit streams that both decoders decoded correctly. ${cpuText(m)}, ${threadText(view.threads)}.`,
      ),
    );
    const leadRatios = new Map(rivals.map((r) => [r.id, ratiosOf(r.id)]));
    const ratioOf = (rival: string, caseId: string) =>
      leadRatios.get(rival)!.get(`${caseId}|${lead.id}`);
    const tiles = h("div", { class: "tiles" });
    for (const r of rivals) {
      const a = aggregate(lead.id, r.id, view.threads, view.depth);
      const tile = h(
        "article",
        { class: "tile" },
        h("p", { class: "eyebrow" }, `${short(lead)} vs ${short(r)}`),
      );
      if (!a) {
        tile.append(h("p", { class: "st" }, "The dataset has no aggregate for this pair."));
      } else if (a.geomean_ratio === null) {
        tile.append(h("p", { class: "st" }, "No stream matched, so there is no geometric mean."));
      } else {
        tile.append(
          h("p", { class: "big" }, ratio(a.geomean_ratio)),
          h("p", { class: "claim" }, `the speed of ${short(r)}`),
        );
      }
      if (a) {
        tile.append(
          h(
            "p",
            { class: "note" },
            `${a.n_matched} of ${a.n_expected} ${view.depth}-bit streams matched.`,
            a.excluded.length
              ? h("a", { href: "#summary-streams" }, " See the streams without a ratio.")
              : null,
          ),
        );
      }
      for (const d of depthsOf(s)) {
        const other = d === view.depth ? null : aggregate(lead.id, r.id, view.threads, d);
        if (other && other.geomean_ratio !== null) {
          tile.append(
            h("p", { class: "note" }, `${d}-bit streams: ${ratio(other.geomean_ratio)}.`),
          );
        }
      }
      const points = depthCases.flatMap((c) => {
        const v = ratioOf(r.id, c.id);
        return v === undefined ? [] : [{ name: c.name, value: v }];
      });
      if (points.length) {
        tile.append(
          spreadChart(points, seriesClass(keys, lead.id), seriesClass(keys, r.id)),
          h(
            "p",
            { class: "note small" },
            `One bar for each stream, sorted by ratio. Above the line, ${short(lead)} gives more frames/s. Below the line, ${short(r)} gives more.`,
          ),
        );
      }
      tiles.append(tile);
    }
    const depths = depthsOf(s);
    const matrix = h(
      "table",
      null,
      h(
        "caption",
        null,
        `Geometric mean of ${label(lead.id)} against each decoder, for each bit depth and requested thread budget. ${machineLabel(m)}.`,
      ),
      thead(["Against", ...m.threads.map(threadText)]),
      h(
        "tbody",
        null,
        ...rivals.flatMap((r) =>
          depths.map((d) =>
            h(
              "tr",
              null,
              h("th", { scope: "row" }, implLink(r.id), h("small", null, `${d}-bit streams`)),
              ...m.threads.map((t) => {
                const a = aggregate(lead.id, r.id, t, d);
                const now = t === view.threads && d === view.depth;
                if (!a || a.geomean_ratio === null) {
                  return h(
                    "td",
                    { class: now ? "now" : undefined },
                    h("span", { class: "st" }, a ? "No stream matched" : "No aggregate"),
                  );
                }
                return h(
                  "td",
                  { class: now ? "num now" : "num" },
                  ratio(a.geomean_ratio),
                  h("small", null, `${a.n_matched} of ${a.n_expected} streams`),
                );
              }),
            ),
          ),
        ),
      ),
    );
    const streams = h(
      "table",
      null,
      h("caption", null, `Throughput ratio of ${label(lead.id)} against each decoder. ${scope}.`),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", { scope: "col" }, "Stream"),
          ...rivals.map((r) => h("th", { scope: "col" }, implLink(r.id))),
        ),
      ),
      h(
        "tbody",
        null,
        ...depthCases.map((c) =>
          h(
            "tr",
            null,
            h("th", { scope: "row" }, c.name),
            ...rivals.map((r) => {
              const v = ratioOf(r.id, c.id);
              return h(
                "td",
                { class: "num" },
                v === undefined
                  ? h("span", { class: "st" }, `Not comparable: ${why(c.id, lead.id, r.id)}`)
                  : ratio(v),
              );
            }),
          ),
        ),
      ),
    );
    summary.append(
      tiles,
      tableWrap("Summary table", matrix),
      h(
        "details",
        { class: "prov", id: "summary-streams" },
        h("summary", null, "The ratio of each stream, as a table"),
        tableWrap("Stream ratio table", streams),
      ),
    );
  }
  summary.append(meta(s));

  // Throughput
  const throughput = fold("throughput", "Throughput", "Frames/s of each stream", [
    `Median frames/s of the valid repetitions. Higher is better. ${scope}.${repeats}`,
  ]);
  if (empty) throughput.append(h("p", null, empty));
  else {
    throughput.append(
      chartBox(
        cases.map((c) => ({
          label: c.name,
          bars: impls.map((i) => ({
            ...bar(i.name || i.id, cell(c.id, i.id), (x) => x.fps_median, fps),
            key: i.id,
          })),
        })),
        keys,
      ),
    );
    const latency = cases.some((c) =>
      impls.some((i) => cell(c.id, i.id)?.first_frame_latency_ns != null),
    );
    const head = [
      "Stream",
      "Decoder",
      "Status",
      "Frames/s",
      "Range",
      "Valid runs",
      "Wall time",
      "CPU time",
      "Peak memory",
    ];
    if (latency) head.push("First-frame latency");
    const table = h("table", null, h("caption", null, `Throughput. ${scope}.`), thead(head));
    for (const c of cases) {
      const body = h("tbody");
      impls.forEach((i, n) => {
        const x = cell(c.id, i.id);
        const row = h("tr");
        if (n === 0) {
          row.append(
            h(
              "th",
              { scope: "rowgroup", rowspan: impls.length },
              c.name,
              h("small", null, caseLabel(c)),
            ),
          );
        }
        row.append(h("td", null, implLink(i.id, x)));
        if (!x || x.status !== "ok") {
          // A result without the status ok has no numbers. Show the status only.
          row.append(
            x
              ? h("td", null, statusCell(x))
              : h("td", null, h("span", { class: "st" }, "No result")),
            h("td", { colspan: head.length - 3 }, notMeasured()),
          );
        } else {
          row.append(
            h("td", null, statusCell(x)),
            h("td", { class: "num" }, opt(x.fps_median, fps)),
            h(
              "td",
              { class: "num" },
              x.fps_min !== null && x.fps_max !== null
                ? `${fps(x.fps_min)}–${fps(x.fps_max)}`
                : notMeasured(),
            ),
            h("td", { class: "num" }, `${x.n_valid} of ${x.n_measured}`),
            h(
              "td",
              { class: "num" },
              opt(x.wall_ns_median, (v) => `${f3.format(v / 1e9)} s`),
            ),
            h(
              "td",
              { class: "num" },
              opt(x.cpu_ns_median, (v) => `${f3.format(v / 1e9)} s`),
            ),
            h(
              "td",
              { class: "num" },
              opt(x.peak_rss_bytes_median, (v) => `${f1.format(v / 2 ** 20)} MiB`),
            ),
          );
          if (latency)
            row.append(
              h(
                "td",
                { class: "num" },
                opt(x.first_frame_latency_ns, (v) => `${f1.format(v / 1e6)} ms`),
              ),
            );
        }
        body.append(row);
      });
      table.append(body);
    }
    throughput.append(tableWrap("Throughput table", table));
  }

  // Speedup
  const others = impls.filter((i) => i.id !== view.baseline);
  const speedup = fold("speedup", "Speedup", "Ratio of each stream against a baseline", [
    `Throughput ratio against the baseline ${label(view.baseline)}. A ratio above 1 means more frames/s than the baseline. A stream has a ratio only when both decoders gave correct, measured results. ${scope}.${repeats}`,
  ]);
  if (empty || !others.length) {
    speedup.append(h("p", null, empty || "Select a decoder other than the baseline."));
  } else {
    const ratios = ratiosOf(view.baseline);
    const caseName = (id: string) => s.cases.find((c) => c.id === id)?.name ?? id;
    speedup.append(
      h("h4", null, `All ${view.depth}-bit streams of the suite`),
      h(
        "ul",
        { class: "aggregates" },
        ...others.map((i) => {
          const a = aggregate(i.id, view.baseline, view.threads, view.depth);
          if (!a) return h("li", null, implLink(i.id), ": the dataset has no aggregate.");
          return h(
            "li",
            null,
            implLink(i.id),
            ": ",
            a.geomean_ratio === null
              ? "no geometric mean, because no stream matched"
              : h("strong", null, `geometric mean ${ratio(a.geomean_ratio)}`),
            `, ${a.n_matched} of ${a.n_expected} streams matched.`,
            a.excluded.length
              ? h(
                  "ul",
                  null,
                  ...a.excluded.map((x) =>
                    h(
                      "li",
                      null,
                      `Excluded: ${caseName(x.case_id)} (${label(x.implementation)}: ${statusText[x.status]})`,
                    ),
                  ),
                )
              : null,
          );
        }),
      ),
      h("h4", null, "Streams that the filters show"),
    );
    speedup.append(
      chartBox(
        cases.map((c) => ({
          label: c.name,
          bars: others.map((i) => {
            const r = ratios.get(`${c.id}|${i.id}`);
            return r === undefined
              ? {
                  label: i.name || i.id,
                  key: i.id,
                  value: null,
                  text: "not comparable",
                  title: `${label(i.id)}: not comparable (${why(c.id, i.id, view.baseline)})`,
                }
              : {
                  label: i.name || i.id,
                  key: i.id,
                  value: r,
                  text: ratio(r),
                  title: `${label(i.id)}: ${ratio(r)} against ${label(view.baseline)}`,
                };
          }),
        })),
        keys,
        1,
      ),
    );
    const table = h(
      "table",
      null,
      h("caption", null, `Speedup against ${label(view.baseline)}. ${scope}.`),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", { scope: "col" }, "Stream"),
          ...others.map((i) => h("th", { scope: "col" }, implLink(i.id))),
        ),
      ),
      h(
        "tbody",
        null,
        ...cases.map((c) =>
          h(
            "tr",
            null,
            h("th", { scope: "row" }, c.name),
            ...others.map((i) => {
              const r = ratios.get(`${c.id}|${i.id}`);
              return h(
                "td",
                { class: "num" },
                r === undefined
                  ? h("span", { class: "st" }, `Not comparable: ${why(c.id, i.id, view.baseline)}`)
                  : ratio(r),
              );
            }),
          ),
        ),
      ),
    );
    speedup.append(tableWrap("Speedup table", table));
  }

  const out: HTMLElement[] = [throughput, speedup];

  // Thread scaling
  if (m.threads.length > 1) {
    const scaling = fold("scaling", "Thread scaling", "Frames/s at each thread budget", [
      `Frames/s of ${label(view.scale)} at each requested thread budget on ${machineLabel(m)}, ${view.depth}-bit streams. The requested threads are the value given to the thread option of the decoder. The factor against 1 thread comes from the dataset.`,
    ]);
    if (!cases.length) scaling.append(h("p", null, "No stream matches the filters."));
    else {
      scaling.append(
        chartBox(
          cases.map((c) => ({
            label: c.name,
            bars: m.threads.map((t) =>
              bar(threadShort(t), cell(c.id, view.scale, t), (x) => x.fps_median, fps),
            ),
          })),
        ),
      );
      const table = h(
        "table",
        null,
        h(
          "caption",
          null,
          `Thread scaling of ${label(view.scale)}. Frames/s, and the factor against 1 thread.`,
        ),
        thead(["Stream", ...m.threads.map(threadText)]),
        h(
          "tbody",
          null,
          ...cases.map((c) =>
            h(
              "tr",
              null,
              h("th", { scope: "row" }, c.name),
              ...m.threads.map((t) => {
                const x = cell(c.id, view.scale, t);
                if (!x) return h("td", null, h("span", { class: "st" }, "No result"));
                if (x.status !== "ok") return h("td", null, statusCell(x));
                return h(
                  "td",
                  { class: "num" },
                  opt(x.fps_median, fps),
                  x.scaling_vs_1t !== null
                    ? h("small", null, `${ratio(x.scaling_vs_1t)} against 1 thread`)
                    : null,
                );
              }),
            ),
          ),
        ),
      );
      scaling.append(tableWrap("Thread scaling table", table));
    }
    out.push(scaling);
  }

  out.push(
    historyView(
      s,
      m,
      impls.map((i) => i.id),
    ),
    provenance(s, m, cases),
    downloads(s),
  );
  return { summary, detail: out };
}

/** A view that starts closed. Its charts are drawn when the reader opens it. */
function fold(id: string, title: string, hint: string, notes: string[]): HTMLElement {
  const d = h(
    "details",
    { class: "view fold", id: `view-${id}`, open: view.open.includes(id) },
    h("summary", null, h("h3", { id: `view-${id}-h` }, title), h("span", { class: "hint" }, hint)),
    ...notes.map((n) => h("p", { class: "note" }, n)),
  );
  d.addEventListener("toggle", () => {
    // A view that update() draws open is already in the view state and already drawn.
    if (!d.isConnected || d.open === view.open.includes(id)) return;
    view = { ...view, open: folds.filter((f) => (f === id ? d.open : view.open.includes(f))) };
    writeUrl();
    redraw();
  });
  return d;
}

function section(id: string, title: string, notes: string[]): HTMLElement {
  return h(
    "section",
    { class: "view", id: `view-${id}`, "aria-labelledby": `view-${id}-h` },
    h("h3", { id: `view-${id}-h` }, title),
    ...notes.map((n) => h("p", { class: "note" }, n)),
  );
}

const thead = (cols: string[]) =>
  h("thead", null, h("tr", null, ...cols.map((c) => h("th", { scope: "col" }, c))));

function statusCell(x: Cell): HTMLElement {
  if (x.status === "ok") return h("span", null, x.noisy ? "OK, noisy" : "OK");
  return h("span", { class: "st" }, statusText[x.status]);
}

// ---------- SVG bar chart. The table next to it carries the same data. ----------

interface Bar {
  label: string;
  value: number | null;
  text: string;
  title: string;
  /** The color key: a decoder id. */
  key?: string;
}
interface Group {
  label: string;
  bars: Bar[];
}

function bar(
  label: string,
  x: Cell | undefined,
  get: (c: Cell) => number | null,
  fmt: (v: number) => string,
): Bar {
  if (!x)
    return { label, value: null, text: "no result", title: `${label}: no result in the dataset` };
  const v = get(x);
  if (x.status !== "ok") {
    const t = statusText[x.status];
    return { label, value: null, text: t, title: `${label}: ${t}` };
  }
  if (v === null)
    return { label, value: null, text: "not measured", title: `${label}: not measured` };
  return { label, value: v, text: fmt(v), title: `${label}: ${fmt(v)}` };
}

/**
 * Decoders keep one style each: three colors, then the same colors dashed. Neighbours always
 * differ in color; from the seventh decoder on the styles repeat, and the name beside each bar
 * (and a note in the view text) identifies the decoder. Other series are neutral.
 */
function seriesClass(keys: string[], key: string | undefined): string {
  const n = key === undefined ? -1 : keys.indexOf(key);
  return n < 0 ? "sn" : `s${n % 3}${Math.floor(n / 3) % 2 ? " alt" : ""}`;
}

/**
 * One bar for each stream, sorted by ratio, around the line of ratio 1. The table of stream
 * ratios in the summary carries the same data.
 */
function spreadChart(
  points: { name: string; value: number }[],
  above: string,
  below: string,
): HTMLElement {
  const box = h("div", { class: "chart spread" });
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const draw = () => {
    if (!box.isConnected) {
      charts.delete(draw);
      return;
    }
    const w = Math.floor(box.clientWidth);
    if (!w) return;
    const labelW = 52;
    const top = 10;
    const plotH = 120;
    const lo = Math.min(1, sorted[0].value);
    const hi = Math.max(1, sorted[sorted.length - 1].value);
    const y = (v: number) => top + ((hi - v) / (hi - lo || 1)) * plotH;
    const step = Math.min(34, (w - labelW) / sorted.length);
    const root = svg("svg", {
      viewBox: `0 0 ${w} ${top + plotH + 10}`,
      width: w,
      height: top + plotH + 10,
      "aria-hidden": "true",
      focusable: "false",
    });
    sorted.forEach((p, i) => {
      const g = svg("g", { class: `row ${p.value >= 1 ? above : below}` });
      g.append(svg("title", {}, `${p.name}: ${ratio(p.value)}`));
      g.append(
        svg("rect", {
          x: labelW + i * step,
          y: Math.min(y(1), y(p.value)),
          width: Math.max(1, step - (step > 4 ? 2 : 0)),
          height: Math.max(2, Math.abs(y(p.value) - y(1))),
          rx: 2,
          class: "fill",
        }),
      );
      root.append(g);
    });
    root.append(
      svg("line", {
        x1: labelW,
        x2: labelW + sorted.length * step,
        y1: y(1),
        y2: y(1),
        class: "ref",
      }),
    );
    // The line of ratio 1, and the two ends of the range when they have room for a label.
    for (const v of [1, hi, lo]) {
      if (v === 1 || Math.abs(y(v) - y(1)) >= 14) {
        root.append(
          svg("text", { x: labelW - 8, y: y(v) + 4, class: "lbl", "text-anchor": "end" }, ratio(v)),
        );
      }
    }
    box.replaceChildren(root);
  };
  charts.add(draw);
  return box;
}

/** keys: bar keys that keep one color in every chart (the decoder ids). */
function chartBox(groups: Group[], keys: string[] = [], ref?: number): HTMLElement {
  const box = h("div", { class: "chart" });
  const draw = () => {
    if (!box.isConnected) {
      charts.delete(draw);
      return;
    }
    // A chart inside closed details is not drawn. It is drawn when the reader opens the details.
    const w = box.closest("details:not([open])") ? 0 : Math.floor(box.clientWidth);
    if (!w) return;
    const char = 7.2; // Approximate width of a 12 px character.
    const fit = (t: string, px: number) => {
      const n = Math.max(4, Math.floor(px / char));
      return t.length > n ? `${t.slice(0, n - 1)}…` : t;
    };
    const labelW = Math.min(180, Math.max(84, Math.round(w * 0.3)));
    const valueW = 92;
    const barW = Math.max(40, w - labelW - valueW);
    const values = groups.flatMap((g) => g.bars.map((b) => b.value ?? 0));
    const max = largest([ref ?? 0, ...values]) || 1;
    const x = (v: number) => labelW + (v / max) * barW;
    const top = ref ? 18 : 0;
    const rowH = 24;
    const groupH = (g: Group) => 22 + g.bars.length * rowH + 14;
    const height = top + groups.reduce((sum, g) => sum + groupH(g), 0);
    const root = svg("svg", {
      viewBox: `0 0 ${w} ${height}`,
      width: w,
      height,
      "aria-hidden": "true",
      focusable: "false",
    });
    let y = top;
    for (const g of groups) {
      const label = svg("text", { x: 0, y: y + 15, class: "grp" }, fit(g.label, w));
      label.append(svg("title", {}, g.label));
      root.append(label);
      y += 22;
      g.bars.forEach((b) => {
        const row = svg("g", { class: `row ${seriesClass(keys, b.key)}` });
        row.append(svg("title", {}, b.title));
        row.append(
          svg(
            "text",
            { x: labelW - 8, y: y + 16, class: "lbl", "text-anchor": "end" },
            fit(b.label, labelW - 8),
          ),
        );
        if (b.value === null) {
          row.append(svg("text", { x: labelW, y: y + 16, class: "st" }, b.text));
        } else {
          const end = x(b.value);
          row.append(
            svg("rect", {
              x: labelW,
              y: y + 4,
              width: Math.max(1, end - labelW),
              height: rowH - 8,
              rx: 3,
              class: "fill",
            }),
          );
          row.append(svg("text", { x: end + 6, y: y + 16, class: "val" }, b.text));
        }
        root.append(row);
        y += rowH;
      });
      y += 14;
    }
    if (ref) {
      root.append(svg("line", { x1: x(ref), x2: x(ref), y1: 14, y2: height, class: "ref" }));
      root.append(
        svg("text", { x: x(ref), y: 11, class: "lbl", "text-anchor": "middle" }, ratio(ref)),
      );
    }
    box.replaceChildren(root);
  };
  charts.add(draw);
  return box;
}

// ---------- History, loaded when the reader opens it ----------

function historyView(s: Summary, m: Machine, impls: string[]): HTMLElement {
  const entries = index.datasets
    .filter(
      (d) =>
        d.origin === s.origin &&
        d.workload === "decode" &&
        d.series.some((x) => x.machine_id === m.machine_id && x.series_id === m.series_id),
    )
    .sort((a, b) => a.published_utc.localeCompare(b.published_utc));
  const cases = s.cases.filter((c) => c.bit_depth === view.depth);
  const caseSel = h(
    "select",
    { id: "f-history-case" },
    ...cases.map((c) => h("option", { value: c.id }, c.name)),
  );
  const out = h("div", { class: "history-out" });
  const details = h(
    "details",
    { class: "prov", id: "bench-history" },
    h("summary", null, "History of this machine series"),
    h(
      "p",
      { class: "note" },
      "Datasets of the same series: the same corpus, methodology, build policy, suite, measurement settings and machine. The decoder commits can differ between datasets. Each value shows its build.",
    ),
    h("div", { class: "field" }, h("label", { for: "f-history-case" }, "Stream"), caseSel),
    out,
  );
  const show = async () => {
    const c = caseSel.value;
    if (entries.length < 2) {
      out.replaceChildren(h("p", null, "This series has no other dataset."));
      return;
    }
    out.replaceChildren(h("p", { role: "status" }, "Loading the history…"));
    const rows = await Promise.all(
      entries.map((e) =>
        loadSummary(e).then(
          (sum) => ({ e, sum, error: "" }),
          (err: unknown) => ({
            e,
            sum: null,
            error: err instanceof Error ? err.message : "Not loaded.",
          }),
        ),
      ),
    );
    if (caseSel.value !== c || !details.open) return;
    const found = (sum: Summary, impl: string) => cellOf(sum, m.machine_id, c, view.threads, impl);
    const nameOf = (impl: string) => s.implementations.find((i) => i.id === impl)?.name || impl;
    const labelIn = (sum: Summary, impl: string) => {
      const i = sum.implementations.find((x) => x.id === impl);
      return i ? implLabel(i) : impl;
    };
    out.replaceChildren(
      chartBox(
        rows.flatMap(({ e, sum }) =>
          sum
            ? [
                {
                  label: `${e.name} · ${e.published_utc.slice(0, 10)}`,
                  bars: impls.map((impl) => ({
                    ...bar(nameOf(impl), found(sum, impl), (x) => x.fps_median, fps),
                    key: impl,
                  })),
                },
              ]
            : [],
        ),
        s.implementations.map((i) => i.id),
      ),
      tableWrap(
        "History table",
        h(
          "table",
          null,
          h(
            "caption",
            null,
            `Frames/s over time. ${machineLabel(m)}, ${threadText(view.threads)}.`,
          ),
          thead(["Dataset", ...impls.map(nameOf)]),
          h(
            "tbody",
            null,
            ...rows.map(({ e, sum, error }) =>
              h(
                "tr",
                null,
                h(
                  "th",
                  { scope: "row" },
                  e.name,
                  h("small", null, `${e.published_utc} · ${e.dataset_id}`),
                ),
                ...(sum
                  ? impls.map((impl) => {
                      const x = found(sum, impl);
                      if (!x) {
                        return h("td", null, h("span", { class: "st" }, "Not in this dataset"));
                      }
                      return h(
                        "td",
                        { class: "num" },
                        x.status === "ok" ? opt(x.fps_median, fps) : statusCell(x),
                        h("small", null, labelIn(sum, impl)),
                      );
                    })
                  : [h("td", { colspan: impls.length }, h("span", { class: "st" }, error))]),
              ),
            ),
          ),
        ),
      ),
    );
    redraw();
  };
  const run = () =>
    show().catch(() =>
      out.replaceChildren(h("p", { class: "st" }, "The history could not be shown.")),
    );
  details.addEventListener("toggle", () => details.open && void run());
  caseSel.addEventListener("change", () => void run());
  const sec = section("history", "History", []);
  sec.append(details);
  return sec;
}

// ---------- Provenance and downloads ----------

/** A provenance row: label, value and how the value is shown. */
/** A null or empty value is a fact that the harness did not record. */
type Row = [string, string | null, ("text" | "code" | "link")?];

function provBlock(id: string, title: string, rows: Row[], what: string): HTMLElement {
  const value = ([, v, kind]: Row): Kid =>
    !v ? notRecorded() : kind === "link" ? ext(v) : kind === "code" ? code(v) : v;
  return h(
    "details",
    { class: "prov", id },
    h("summary", null, title),
    kv(rows.map((r) => [r[0], value(r)])),
    copyButton(rows.map(([k, v]) => `${k}: ${v || "not recorded"}`).join("\n"), what),
  );
}

function provenance(s: Summary, m: Machine, cases: Case[]): HTMLElement {
  const shown = new Set([...view.decoders, view.baseline]);
  const sec = section("provenance", "Provenance", [
    "The exact source, build and binary of each decoder on this machine, the machine, the streams and the measurement settings.",
  ]);
  s.builds.forEach((b, n) => {
    if (b.machine_id !== m.machine_id || !shown.has(b.implementation)) return;
    const i = s.implementations.find((x) => x.id === b.implementation)!;
    const c = b.configuration;
    const rows: Row[] = [
      ["Decoder", i.name],
      ["Repository", i.repository, "link"],
      ["Commit", i.commit, "code"],
      ["Identity", i.identity === "release" ? "Verified release" : "Development commit"],
      ["Release", i.release ? `${i.release.version} (tag ${i.release.tag})` : "none"],
      ["Release page", i.release ? i.release.url : "none", i.release ? "link" : "text"],
      ["Build origin", buildOriginText[i.build_origin]],
      ["Source snapshot", i.snapshot_sha256, "code"],
      ["Build id", b.build_id, "code"],
      ["Build class", b.class],
      ["Binary SHA-256", b.binary_sha256, "code"],
      ["Libraries", b.libraries.map((l) => JSON.stringify(l)).join("; ") || "none"],
      ["Target", b.target],
      ["Toolchain", b.toolchain.map(([k, v]) => `${k}: ${v}`).join("; ")],
      ["Configuration", c.summary],
      ["Build command", c.arguments.join(" "), "code"],
      ["Target CPU", c.target_cpu],
      ["SIMD", c.simd],
      ["LTO", c.lto],
      ["PGO", c.pgo === null ? "not recorded" : c.pgo ? "yes" : "no"],
      ["Version output (raw text, not a release proof)", b.version_output, "code"],
      ["Machine", machineLabel(m)],
      ["Dataset", s.dataset_id, "code"],
    ];
    sec.append(provBlock(`build-${n}`, implLabel(i), rows, `provenance of ${implLabel(i)}`));
  });

  const fp = m.fingerprint;
  const cores = [
    fp.cpu.physical_cores !== null && `${fp.cpu.physical_cores} physical`,
    fp.cpu.logical_cores !== null && `${fp.cpu.logical_cores} logical`,
    fp.cpu.performance_cores !== null && `${fp.cpu.performance_cores} performance`,
    fp.cpu.efficiency_cores !== null && `${fp.cpu.efficiency_cores} efficiency`,
  ].filter(Boolean);
  const machineRows: Row[] = [
    ["Machine id", m.machine_id, "code"],
    ["Role", m.role],
    ["CPU", fp.cpu.model],
    ["Cores", cores.join(", ") || "not recorded"],
    ["ISA", fp.cpu.isa.join(", ") || "not recorded"],
    ["Architecture", fp.arch],
    ["Operating system", osText(m)],
    ["Kernel", fp.os.kernel],
    ["Memory", fp.memory_bytes === null ? "not recorded" : `${f0.format(fp.memory_bytes)} bytes`],
    ["Power settings", fp.power],
    ["CPU affinity", fp.affinity],
    ["Requested thread budgets", m.threads.join(", ")],
    ["Run id", m.run_id, "code"],
    ["Run state", m.run_state],
    ["Run class", m.class],
    [
      "Measured (UTC)",
      m.measured_utc.first && m.measured_utc.last
        ? `${m.measured_utc.first} to ${m.measured_utc.last}`
        : "not measured",
    ],
    ["Series id", m.series_id, "code"],
    ["Host fingerprint digest", m.fingerprint_digest, "code"],
  ];
  const streamRows = cases.flatMap((c): Row[] => [
    [c.name, `${caseLabel(c)} · ${c.frames} frames · ${f0.format(c.bytes)} bytes`],
    [`${c.name}: film grain`, c.film_grain === null ? "not known" : c.film_grain ? "yes" : "no"],
    [`${c.name}: input SHA-256`, c.input_sha256, "code"],
    [`${c.name}: source`, c.url, "link"],
  ]);
  const setRows: Row[] = [
    ["Dataset id", s.dataset_id, "code"],
    ["Campaign id", s.campaign_id, "code"],
    ["Campaign lock digest", s.lock_digest, "code"],
    ...s.methodology.map(([k, v]): Row => [`Methodology: ${k}`, String(v)]),
    ["Corpus", s.corpus.id],
    ["Corpus digest", s.corpus.digest, "code"],
    ["Corpus source", s.corpus.source, "link"],
    ["Reference output", s.corpus.oracle],
    ["Suite", `${s.suite.id}, ${s.suite.cases_expected} cases expected`],
    ["Aggregation", s.aggregation_version],
    ["Harness repository", s.harness.repository, "link"],
    ["Harness commit", s.harness.commit, "code"],
    ["Harness snapshot", s.harness.snapshot_sha256, "code"],
    ["Harness class", s.harness.class],
  ];
  sec.append(
    provBlock("machine-details", `Machine: ${machineLabel(m)}`, machineRows, "machine details"),
    provBlock("streams-details", "Streams that the filters show", streamRows, "stream details"),
    provBlock(
      "settings-details",
      "Corpus and measurement settings",
      setRows,
      "corpus and measurement settings",
    ),
  );
  return sec;
}

function downloads(s: Summary): HTMLElement {
  const dir = datasetDir(entry);
  const file = (path: string, text: string, note?: string) =>
    h(
      "li",
      null,
      h("a", { href: new URL(path, dir).href }, text),
      note ? h("small", null, note) : null,
    );
  const sec = section("downloads", "Downloads", ["The raw evidence of this dataset."]);
  sec.append(
    h(
      "ul",
      { class: "files" },
      ...s.machines.map((m) =>
        file(
          m.bundle.path,
          `Raw bundle: ${m.machine_id} (${m.role})`,
          `${f0.format(m.bundle.bytes)} bytes · ${m.bundle.sha256}`,
        ),
      ),
      file(s.downloads.csv, "Summary as CSV"),
      file(s.downloads.lock, "Campaign lock"),
      file(s.downloads.manifest, "Manifest"),
      file(s.downloads.checksums, "Checksums (SHA-256)"),
      h("li", null, ext(s.reproduce.instructions, "Reproduction instructions")),
      h(
        "li",
        null,
        ext(s.reproduce.repository, "Benchmark harness"),
        h("small", null, `commit ${s.reproduce.harness_commit}`),
      ),
    ),
  );
  return sec;
}

void start();
