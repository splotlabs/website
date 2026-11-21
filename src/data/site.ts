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
  "splot_drain",
  "splot_close",
];
