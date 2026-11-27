// Types and runtime validation for the published benchmark data (index.json, summary.json).
// The data comes from another origin, so this module is the trust boundary: it checks every
// field that the page uses. The contract is in the splotlabs/benchmarks repository.

export type Status =
  "ok" | "incorrect" | "unsupported" | "timeout" | "error" | "interrupted" | "not-run";
const statuses: readonly Status[] = [
  "ok",
  "incorrect",
  "unsupported",
  "timeout",
  "error",
  "interrupted",
  "not-run",
];
const buildOrigins = ["source-release", "source-development", "upstream-release-asset"] as const;
export type BuildOrigin = (typeof buildOrigins)[number];

export interface IndexEntry {
  dataset_id: string;
  name: string;
  origin: string;
  complete: boolean;
  workload: string;
  published_utc: string;
  path: string;
  series: { machine_id: string; series_id: string }[];
}
export interface BenchIndex {
  latest_complete: string | null;
  datasets: IndexEntry[];
}

export interface Machine {
  machine_id: string;
  role: string;
  series_id: string;
  run_id: string;
  run_state: string;
  class: string;
  threads: number[];
  measured_utc: { first: string; last: string };
  fingerprint_digest: string;
  fingerprint: {
    arch: string;
    os: { name: string; version: string; kernel: string | null };
    cpu: {
      model: string;
      physical_cores: number | null;
      logical_cores: number | null;
      performance_cores: number | null;
      efficiency_cores: number | null;
      isa: string[];
    };
    memory_bytes: number | null;
  };
  bundle: { path: string; sha256: string; bytes: number };
}
export interface Implementation {
  id: string;
  name: string;
  repository: string;
  commit: string;
  identity: "release" | "development";
  release: { tag: string; version: string; url: string } | null;
  build_origin: BuildOrigin;
  snapshot_sha256: string;
}
export interface Build {
  build_id: string;
  implementation: string;
  machine_id: string;
  class: string;
  binary_sha256: string;
  libraries: unknown[];
  version_output: string | null;
  target: string;
  toolchain: Record<string, string>;
  configuration: {
    summary: string;
    arguments: string[];
    target_cpu: string | null;
    simd: string | null;
    lto: string | null;
    pgo: boolean | null;
  };
}
export interface Case {
  id: string;
  name: string;
  width: number;
  height: number;
  bit_depth: number;
  chroma: string;
  frames: number;
  bytes: number;
  input_sha256: string;
  url: string;
}
export interface Cell {
  machine_id: string;
  case_id: string;
  threads: number;
  implementation: string;
  build_id: string;
  status: Status;
  n_measured: number;
  n_valid: number;
  noisy: boolean;
  frames: number | null;
  wall_ns_median: number | null;
  fps_median: number | null;
  fps_min: number | null;
  fps_max: number | null;
  cpu_ns_median: number | null;
  peak_rss_bytes_median: number | null;
  first_frame_latency_ns: number | null;
  scaling_vs_1t: number | null;
}
export interface Speedup {
  machine_id: string;
  case_id: string;
  threads: number;
  implementation: string;
  baseline: string;
  ratio: number;
}
export interface Aggregate {
  machine_id: string;
  threads: number;
  bit_depth: number;
  implementation: string;
  baseline: string;
  geomean_ratio: number | null;
  n_matched: number;
  n_expected: number;
  excluded: { case_id: string; reason: string }[];
}
export interface Summary {
  dataset_id: string;
  campaign_id: string;
  name: string;
  lock_digest: string;
  origin: string;
  complete: boolean;
  methodology: Record<string, string | number | boolean | null>;
  harness: { repository: string; commit: string; snapshot_sha256: string; class: string };
  aggregation_version: string;
  corpus: { id: string; digest: string; source: string; oracle: string };
  suite: { id: string; cases_expected: number };
  machines: Machine[];
  implementations: Implementation[];
  builds: Build[];
  cases: Case[];
  cells: Cell[];
  speedups: Speedup[];
  aggregates: Aggregate[];
  downloads: { manifest: string; csv: string; lock: string; checksums: string };
  reproduce: { repository: string; harness_commit: string; instructions: string };
}

/** The data breaks the contract. */
export class DataError extends Error {}
/** The data is valid for a version or workload kind that this page does not support. */
export class UnsupportedError extends Error {}

type Json = Record<string, unknown>;

function obj(v: unknown, at: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new DataError(`${at} is not an object.`);
  }
  return v as Json;
}
function str(o: Json, k: string, at: string): string {
  const v = o[k];
  if (typeof v !== "string" || v === "") throw new DataError(`${at}.${k} is not a string.`);
  return v;
}
function optStr(o: Json, k: string, at: string): string | null {
  return o[k] === null ? null : str(o, k, at);
}
function num(o: Json, k: string, at: string): number {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new DataError(`${at}.${k} is not a number.`);
  }
  return v;
}
function optNum(o: Json, k: string, at: string): number | null {
  return o[k] === null ? null : num(o, k, at);
}
function int(o: Json, k: string, at: string): number {
  const v = num(o, k, at);
  if (!Number.isInteger(v) || v < 0) throw new DataError(`${at}.${k} is not a count.`);
  return v;
}
function bool(o: Json, k: string, at: string): boolean {
  if (typeof o[k] !== "boolean") throw new DataError(`${at}.${k} is not true or false.`);
  return o[k] as boolean;
}
function list<T>(o: Json, k: string, at: string, each: (v: unknown, at: string) => T): T[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new DataError(`${at}.${k} is not a list.`);
  return v.map((item, i) => each(item, `${at}.${k}[${i}]`));
}
function oneOf<T extends string>(o: Json, k: string, at: string, values: readonly T[]): T {
  const v = str(o, k, at);
  if (!(values as readonly string[]).includes(v)) {
    throw new DataError(`${at}.${k} has the unknown value "${v}".`);
  }
  return v as T;
}
function pattern(o: Json, k: string, at: string, re: RegExp): string {
  const v = str(o, k, at);
  if (!re.test(v)) throw new DataError(`${at}.${k} has an incorrect form.`);
  return v;
}
const commit = /^[0-9a-f]{40}$/;
const sha256 = /^sha256:[0-9a-f]{64}$/;
// A relative path inside the dataset: no scheme, no query, no "..", no leading "/".
const relative = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/?$/;
const strings = (v: unknown, at: string) => {
  if (typeof v !== "string") throw new DataError(`${at} is not a string.`);
  return v;
};

/** Checks the schema id and returns nothing, or throws. */
function schema(o: Json, name: string) {
  const id = str(o, "schema", name);
  const m = /^splotbench\.([a-z]+)\/(\d+)$/.exec(id);
  if (!m || m[1] !== name) throw new DataError(`${name}.schema "${id}" is not a ${name} schema.`);
  if (m[2] !== "1") throw new UnsupportedError(`The ${name} uses the data version "${id}".`);
}

export function parseIndex(raw: unknown): BenchIndex {
  const o = obj(raw, "index");
  schema(o, "index");
  const datasets = list(o, "datasets", "index", (v, at) => {
    const d = obj(v, at);
    return {
      dataset_id: str(d, "dataset_id", at),
      name: str(d, "name", at),
      origin: str(d, "origin", at),
      complete: bool(d, "complete", at),
      workload: str(d, "workload", at),
      published_utc: str(d, "published_utc", at),
      path: pattern(d, "path", at, relative),
      series: list(d, "series", at, (s, sat) => {
        const so = obj(s, sat);
        return { machine_id: str(so, "machine_id", sat), series_id: str(so, "series_id", sat) };
      }),
    };
  });
  const latest = optStr(o, "latest_complete", "index");
  if (latest !== null && !datasets.some((d) => d.dataset_id === latest)) {
    throw new DataError(`index.latest_complete "${latest}" is not in index.datasets.`);
  }
  return { latest_complete: latest, datasets };
}

export function parseSummary(raw: unknown, expectedId: string): Summary {
  const o = obj(raw, "summary");
  schema(o, "summary");
  const kind = str(obj(o.workload, "summary.workload"), "kind", "summary.workload");
  if (kind !== "decode") throw new UnsupportedError(`The dataset has the workload kind "${kind}".`);
  const at = "summary";
  const dataset_id = str(o, "dataset_id", at);
  if (dataset_id !== expectedId) {
    throw new DataError(`summary.dataset_id "${dataset_id}" is not "${expectedId}".`);
  }
  const throughput = obj(
    obj(o.metrics, "summary.metrics").throughput,
    "summary.metrics.throughput",
  );
  if (throughput.unit !== "frames/s") {
    throw new UnsupportedError("The throughput unit is not frames/s.");
  }

  const m = obj(o.methodology, "summary.methodology");
  str(m, "id", "summary.methodology");
  const methodology: Summary["methodology"] = {};
  for (const [k, v] of Object.entries(m)) {
    if (v !== null && !["string", "number", "boolean"].includes(typeof v)) {
      throw new DataError(`summary.methodology.${k} is not a single value.`);
    }
    methodology[k] = v as string | number | boolean | null;
  }

  const agg = obj(o.aggregation, "summary.aggregation");
  const h = obj(agg.harness, "summary.aggregation.harness");
  const hat = "summary.aggregation.harness";
  const corpus = obj(o.corpus, "summary.corpus");
  const suite = obj(o.suite, "summary.suite");
  const dl = obj(o.downloads, "summary.downloads");
  const rp = obj(o.reproduce, "summary.reproduce");

  const machines = list(o, "machines", at, (v, mat): Machine => {
    const x = obj(v, mat);
    const fp = obj(x.fingerprint, `${mat}.fingerprint`);
    const os = obj(fp.os, `${mat}.fingerprint.os`);
    const cpu = obj(fp.cpu, `${mat}.fingerprint.cpu`);
    const time = obj(x.measured_utc, `${mat}.measured_utc`);
    const bundle = obj(x.bundle, `${mat}.bundle`);
    const cat = `${mat}.fingerprint.cpu`;
    return {
      machine_id: str(x, "machine_id", mat),
      role: str(x, "role", mat),
      series_id: str(x, "series_id", mat),
      run_id: str(x, "run_id", mat),
      run_state: str(x, "run_state", mat),
      class: str(x, "class", mat),
      threads: list(x, "threads", mat, (t, tat) => int({ t }, "t", tat)),
      measured_utc: {
        first: str(time, "first", `${mat}.measured_utc`),
        last: str(time, "last", `${mat}.measured_utc`),
      },
      fingerprint_digest: pattern(x, "fingerprint_digest", mat, sha256),
      fingerprint: {
        arch: str(fp, "arch", `${mat}.fingerprint`),
        os: {
          name: str(os, "name", `${mat}.fingerprint.os`),
          version: str(os, "version", `${mat}.fingerprint.os`),
          kernel: optStr(os, "kernel", `${mat}.fingerprint.os`),
        },
        cpu: {
          model: str(cpu, "model", cat),
          physical_cores: optNum(cpu, "physical_cores", cat),
          logical_cores: optNum(cpu, "logical_cores", cat),
          performance_cores: optNum(cpu, "performance_cores", cat),
          efficiency_cores: optNum(cpu, "efficiency_cores", cat),
          isa: list(cpu, "isa", cat, strings),
        },
        memory_bytes: optNum(fp, "memory_bytes", `${mat}.fingerprint`),
      },
      bundle: {
        path: pattern(bundle, "path", `${mat}.bundle`, relative),
        sha256: pattern(bundle, "sha256", `${mat}.bundle`, sha256),
        bytes: int(bundle, "bytes", `${mat}.bundle`),
      },
    };
  });

  const implementations = list(o, "implementations", at, (v, iat): Implementation => {
    const x = obj(v, iat);
    const identity = oneOf(x, "identity", iat, ["release", "development"] as const);
    let release: Implementation["release"] = null;
    if (identity === "release") {
      const r = obj(x.release, `${iat}.release`);
      const rat = `${iat}.release`;
      release = {
        tag: str(r, "tag", rat),
        version: str(r, "version", rat),
        url: str(r, "url", rat),
      };
    } else if (x.release !== null) {
      throw new DataError(`${iat}.release must be null for a development identity.`);
    }
    return {
      id: str(x, "id", iat),
      name: str(x, "name", iat),
      repository: str(x, "repository", iat),
      commit: pattern(x, "commit", iat, commit),
      identity,
      release,
      build_origin: oneOf(x, "build_origin", iat, buildOrigins),
      snapshot_sha256: pattern(x, "snapshot_sha256", iat, sha256),
    };
  });

  const builds = list(o, "builds", at, (v, bat): Build => {
    const x = obj(v, bat);
    const tc = obj(x.toolchain, `${bat}.toolchain`);
    const c = obj(x.configuration, `${bat}.configuration`);
    const cat = `${bat}.configuration`;
    const toolchain: Record<string, string> = {};
    for (const k of Object.keys(tc)) toolchain[k] = str(tc, k, `${bat}.toolchain`);
    if (c.pgo !== null) bool(c, "pgo", cat);
    return {
      build_id: str(x, "build_id", bat),
      implementation: str(x, "implementation", bat),
      machine_id: str(x, "machine_id", bat),
      class: str(x, "class", bat),
      binary_sha256: pattern(x, "binary_sha256", bat, sha256),
      libraries: list(x, "libraries", bat, (l) => l),
      version_output: optStr(x, "version_output", bat),
      target: str(x, "target", bat),
      toolchain,
      configuration: {
        summary: str(c, "summary", cat),
        arguments: list(c, "arguments", cat, strings),
        target_cpu: optStr(c, "target_cpu", cat),
        simd: optStr(c, "simd", cat),
        lto: optStr(c, "lto", cat),
        pgo: c.pgo as boolean | null,
      },
    };
  });

  const cases = list(o, "cases", at, (v, cat): Case => {
    const x = obj(v, cat);
    return {
      id: str(x, "id", cat),
      name: str(x, "name", cat),
      width: int(x, "width", cat),
      height: int(x, "height", cat),
      bit_depth: int(x, "bit_depth", cat),
      chroma: str(x, "chroma", cat),
      frames: int(x, "frames", cat),
      bytes: int(x, "bytes", cat),
      input_sha256: pattern(x, "input_sha256", cat, sha256),
      url: str(x, "url", cat),
    };
  });

  const cells = list(o, "cells", at, (v, cat): Cell => {
    const x = obj(v, cat);
    return {
      machine_id: str(x, "machine_id", cat),
      case_id: str(x, "case_id", cat),
      threads: int(x, "threads", cat),
      implementation: str(x, "implementation", cat),
      build_id: str(x, "build_id", cat),
      status: oneOf(x, "status", cat, statuses),
      n_measured: int(x, "n_measured", cat),
      n_valid: int(x, "n_valid", cat),
      noisy: bool(x, "noisy", cat),
      frames: optNum(x, "frames", cat),
      wall_ns_median: optNum(x, "wall_ns_median", cat),
      fps_median: optNum(x, "fps_median", cat),
      fps_min: optNum(x, "fps_min", cat),
      fps_max: optNum(x, "fps_max", cat),
      cpu_ns_median: optNum(x, "cpu_ns_median", cat),
      peak_rss_bytes_median: optNum(x, "peak_rss_bytes_median", cat),
      first_frame_latency_ns: optNum(x, "first_frame_latency_ns", cat),
      scaling_vs_1t: optNum(x, "scaling_vs_1t", cat),
    };
  });

  const speedups = list(o, "speedups", at, (v, sat): Speedup => {
    const x = obj(v, sat);
    return {
      machine_id: str(x, "machine_id", sat),
      case_id: str(x, "case_id", sat),
      threads: int(x, "threads", sat),
      implementation: str(x, "implementation", sat),
      baseline: str(x, "baseline", sat),
      ratio: num(x, "ratio", sat),
    };
  });

  const aggregates = list(o, "aggregates", at, (v, aat): Aggregate => {
    const x = obj(v, aat);
    return {
      machine_id: str(x, "machine_id", aat),
      threads: int(x, "threads", aat),
      bit_depth: int(x, "bit_depth", aat),
      implementation: str(x, "implementation", aat),
      baseline: str(x, "baseline", aat),
      geomean_ratio: optNum(x, "geomean_ratio", aat),
      n_matched: int(x, "n_matched", aat),
      n_expected: int(x, "n_expected", aat),
      excluded: list(x, "excluded", aat, (e, eat) => {
        const eo = obj(e, eat);
        return { case_id: str(eo, "case_id", eat), reason: str(eo, "reason", eat) };
      }),
    };
  });

  const summary: Summary = {
    dataset_id,
    campaign_id: str(o, "campaign_id", at),
    name: str(o, "name", at),
    lock_digest: pattern(o, "lock_digest", at, sha256),
    origin: str(o, "origin", at),
    complete: bool(o, "complete", at),
    methodology,
    harness: {
      repository: str(h, "repository", hat),
      commit: pattern(h, "commit", hat, commit),
      snapshot_sha256: pattern(h, "snapshot_sha256", hat, sha256),
      class: str(h, "class", hat),
    },
    aggregation_version: str(agg, "version", "summary.aggregation"),
    corpus: {
      id: str(corpus, "id", "summary.corpus"),
      digest: pattern(corpus, "digest", "summary.corpus", sha256),
      source: str(corpus, "source", "summary.corpus"),
      oracle: str(corpus, "oracle", "summary.corpus"),
    },
    suite: {
      id: str(suite, "id", "summary.suite"),
      cases_expected: int(suite, "cases_expected", "summary.suite"),
    },
    machines,
    implementations,
    builds,
    cases,
    cells,
    speedups,
    aggregates,
    downloads: {
      manifest: pattern(dl, "manifest", "summary.downloads", relative),
      csv: pattern(dl, "csv", "summary.downloads", relative),
      lock: pattern(dl, "lock", "summary.downloads", relative),
      checksums: pattern(dl, "checksums", "summary.downloads", relative),
    },
    reproduce: {
      repository: str(rp, "repository", "summary.reproduce"),
      harness_commit: pattern(rp, "harness_commit", "summary.reproduce", commit),
      instructions: str(rp, "instructions", "summary.reproduce"),
    },
  };
  checkReferences(summary);
  return summary;
}

function checkReferences(s: Summary) {
  if (!s.machines.length || !s.implementations.length || !s.cases.length) {
    throw new DataError("summary has no machine, no implementation or no case.");
  }
  s.machines.forEach((m, i) => {
    if (!m.threads.length) throw new DataError(`summary.machines[${i}].threads is empty.`);
  });
  const machines = new Set(s.machines.map((m) => m.machine_id));
  const impls = new Set(s.implementations.map((x) => x.id));
  const cases = new Set(s.cases.map((c) => c.id));
  const builds = new Map(s.builds.map((b) => [b.build_id, b]));
  const need = (set: Set<string>, v: string, what: string, at: string) => {
    if (!set.has(v)) throw new DataError(`${at} names the unknown ${what} "${v}".`);
  };
  s.builds.forEach((b, i) => {
    need(machines, b.machine_id, "machine", `summary.builds[${i}]`);
    need(impls, b.implementation, "implementation", `summary.builds[${i}]`);
  });
  s.cells.forEach((c, i) => {
    const at = `summary.cells[${i}]`;
    need(machines, c.machine_id, "machine", at);
    need(cases, c.case_id, "case", at);
    need(impls, c.implementation, "implementation", at);
    const b = builds.get(c.build_id);
    if (!b || b.implementation !== c.implementation || b.machine_id !== c.machine_id) {
      throw new DataError(`${at} names a build that does not match its machine and decoder.`);
    }
  });
  [...s.speedups, ...s.aggregates].forEach((x, i) => {
    const at = `summary speedup or aggregate ${i}`;
    need(machines, x.machine_id, "machine", at);
    need(impls, x.implementation, "implementation", at);
    need(impls, x.baseline, "implementation", at);
  });
  s.speedups.forEach((x, i) => need(cases, x.case_id, "case", `summary.speedups[${i}]`));
}

/** An https link from the data, or null. Other schemes are shown as text only. */
export function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export const shortCommit = (c: string) => c.slice(0, 12);

/** The compact label of the contract. The build version output is never the label. */
export function implLabel(i: Implementation): string {
  return i.identity === "release" && i.release
    ? `${i.name} ${i.release.version} (${shortCommit(i.commit)})`
    : `${i.name} ${shortCommit(i.commit)} (development)`;
}

export const buildOriginText: Record<BuildOrigin, string> = {
  "source-release": "Built by the harness from the release source. Not an upstream binary.",
  "source-development": "Built by the harness from development source.",
  "upstream-release-asset": "Official binary from the upstream release.",
};
