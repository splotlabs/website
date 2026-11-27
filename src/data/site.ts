// Product facts and commands come from the splot README.
// See docs/CONTENT-SOURCES.md before you change them.
export const repo = "https://github.com/splotlabs/splot";
export const websiteRepo = "https://github.com/splotlabs/website";

export const links = {
  readme: `${repo}#readme`,
  embed: `${repo}#embed-in-a-few-lines`,
  developers: `${repo}/blob/main/docs/README.md`,
  issues: `${repo}/issues`,
  license: `${repo}/blob/main/LICENSE.md`,
  licensing: `${repo}#license`,
  websiteLicense: `${websiteRepo}/blob/main/LICENSE.md`,
  spec: "https://av2.aomedia.org/v1.0.0/index.html",
  rustup: "https://rustup.rs",
};

export const nav = [
  { href: "/#workflow", label: "Workflow" },
  { href: "/#capabilities", label: "Capabilities" },
  { href: "/#install", label: "Install" },
  { href: "/#status", label: "Status" },
  { href: "/benchmarks/", label: "Benchmarks" },
];

export const workflow = [
  { name: "Encode", note: "make it", cmd: "splot encode clip.y4m -o clip.ivf" },
  { name: "Validate", note: "prove it", cmd: "splot validate clip.ivf" },
  { name: "Decode", note: "watch it", cmd: "splot decode clip.ivf -o - | ffplay -" },
];

export const install = [
  { cmd: "git clone https://github.com/splotlabs/splot && cd splot" },
  { cmd: "cargo install --path crates/splot-cli --locked" },
  { cmd: "splot --help" },
];

export const encodeOptions = [
  { want: "Constant quality", use: "--crf 20" },
  { want: "A target bitrate", use: "--bitrate 2000" },
  { want: "More speed", use: "--preset 10" },
  { want: "Low latency", use: "--low-delay" },
  { want: "Natural film look", use: "--film-grain" },
  { want: "More cores in parallel", use: "--tiles 2x2 --threads 8" },
];

export const cApi = [
  "splot_open",
  "splot_send_data",
  "splot_get_picture",
  "splot_wait_picture",
  "splot_flush",
  "splot_drain",
  "splot_close",
];

// The benchmarks page reads the published datasets of the benchmarks harness.
// See "Benchmark data origin" in docs/DEPLOYMENT.md before you change dataBase:
// connect-src in public/_headers must name the same URL.
export const benchmarks = {
  // The directory that contains index.json, with a final "/".
  dataBase: "https://raw.githubusercontent.com/splotlabs/benchmarks/main/published/",
  repo: "https://github.com/splotlabs/benchmarks",
  epic: "https://github.com/splotlabs/splot/issues/2046",
};
