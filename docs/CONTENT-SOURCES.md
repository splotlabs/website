# Content sources

All product claims and commands on the website come from the product repository
[splotlabs/splot](https://github.com/splotlabs/splot) at commit
`0616c379f300ccca7afbfcab401444de1c5122b4` (2026-11-27).

The website does not fetch upstream content at build time. At runtime, only the benchmarks page
fetches content: the published datasets in the `published/` directory of
[splotlabs/benchmarks](https://github.com/splotlabs/benchmarks), read through
`raw.githubusercontent.com` (`benchmarks.dataBase` in `src/data/site.ts`). When the README changes, update the copy by hand and
update the commit above.

Status values:

- **Documented**: the upstream file says it. The website team did not test it.
- **Checked**: the website team ran it and saw the result.

| Website content                                                                                                          | Upstream file and section                                   | Status                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Wordmark `splot`, gradient `#5ee7ff` 0 → `#a78bfa` 0.45 → `#ff7ab6` 1 (left to right)                                    | `docs/assets/hero.svg`, `#word`                             | Checked against the SVG markup                                  |
| Background `#05050a`, text `#f5f5f7`, muted text `#a1a1aa`                                                               | `docs/assets/hero.svg`                                      | Checked against the SVG markup                                  |
| Glow colors `#6d5dfc`, `#ff5fa2`, `#22d3ee`; drift 14 s / 18 s / 16 s; no motion with reduced-motion                     | `docs/assets/hero.svg`                                      | Checked against the SVG markup                                  |
| System font stack                                                                                                        | `docs/assets/hero.svg`, `<style>`                           | Checked against the SVG markup                                  |
| "AV2. Encode it. Decode it. Trust it."                                                                                   | `docs/assets/hero.svg`; `README.md` image alt text          | Documented                                                      |
| "An encoder, a decoder and a validator for the next-generation video codec. One binary. Safe Rust. Built from the spec." | `README.md`, introduction                                   | Documented                                                      |
| "AV2 spec v1.0.0"                                                                                                        | `README.md`, badges                                         | Documented                                                      |
| "Pre-alpha"                                                                                                              | `README.md`, "Where it stands."                             | Documented                                                      |
| The three commands (`encode`, `validate`, `decode … \| ffplay -`) and "That is the whole loop…"                          | `README.md`, "Three commands. Your first AV2 video."        | Documented                                                      |
| License: PolyForm Noncommercial 1.0.0, holder Bartosz Tomczyk                                                            | `LICENSE.md`, required notice                               | Documented                                                      |
| Encode text, the six options, and the `ffmpeg … \| splot encode` command                                                 | `README.md`, "Encode. Beautifully."                         | Documented                                                      |
| Decode text and the `mpv` and Y4M commands                                                                               | `README.md`, "Watch. Instantly." and "Decode. Every frame." | Documented                                                      |
| Validate text, `--json`, `splot explain …`, stable exit codes                                                            | `README.md`, "Validate. With proof."                        | Documented                                                      |
| Embed text, crate names, the seven C functions, `cargo build --release -p splot-capi`                                    | `README.md`, "Embed. In a few lines."                       | Documented                                                      |
| Install commands, rustup, the CPU requirements note                                                                      | `README.md`, "Install. From source."                        | Documented                                                      |
| "The project reports that the encoder, decoder and validator work end to end…"                                           | `README.md`, "Where it stands."                             | Documented. The website states it as a report from the project. |
| "Uses outside its permissions, including typical commercial deployments, require a separate agreement…"                  | `LICENSE.md`, license body; `README.md`, "License."         | Documented. README wording as revised in splot PR 1791          |
| `public/favicon.svg`, `src/brand/og.svg`, `public/og.png`                                                                | Adapted from `docs/assets/hero.svg`                         | Checked against the SVG markup                                  |

## Benchmarks page

The benchmarks page (`src/pages/benchmarks.astro`) makes no performance claim. It shows numbers
only from a published dataset, without change, and it computes no statistics. While the
published index lists no dataset, the page shows "Results are not published yet." The test fixtures
in `tests/fixtures/` are synthetic data that the benchmarks harness generated at commit
`206eb6294206218a639137f1422eadf72647c39b` (`tests/make_viewer_fixtures.py`). They are not in the
build output.

Sources: the Epic [splotlabs/splot#2046](https://github.com/splotlabs/splot/issues/2046) and
the task [splotlabs/website#7](https://github.com/splotlabs/website/issues/7), read on
2026-11-27, and the data contract `splotbench.index/1` and `splotbench.summary/1` for the
[splotlabs/benchmarks](https://github.com/splotlabs/benchmarks) harness (task
[splotlabs/splot#2049](https://github.com/splotlabs/splot/issues/2049)), as the harness at commit
`206eb6294206218a639137f1422eadf72647c39b` writes it. When the contract changes, regenerate the
test fixtures (see `tests/fixtures/README.md`) and record the new commit here.

| Website content                                                                                                                                                                                                                                                                              | Source                                                                                                                                                  | Status                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| "Results are not published yet."                                                                                                                                                                                                                                                             | Epic #2046, "Measurement and presentation contract"; shown when `published/index.json` lists no dataset                                                 | Checked with a mocked empty index                                   |
| One wall-clock timing boundary around the decoder command line; the timed pass decodes, applies film grain and writes no output (`output_policy: decode-discard`); output checked in a separate untimed pass; measured cases one at a time on each machine                                   | Epic #2046, "Supported execution environments" and "Measurement and presentation contract"; harness methodology `decode-discard`                        | Documented                                                          |
| One physical machine per result; ARM and x86 never combined; 8-bit and 10-bit never mixed in one aggregate; speedups only from matched correct streams, with coverage; no zero bars                                                                                                          | Epic #2046, "Measurement and presentation contract"; task #7, "Interaction and comparison views"                                                        | Documented. The page code follows it; tested with fixtures          |
| Source repository and full commit; release only when verified; build origin, configuration, binary SHA-256 and machine; a local build of release source is not an official binary                                                                                                            | Epic #2046, "Exact provenance contract"; data contract, `implementations` and `builds`                                                                  | Documented                                                          |
| Harness, methodology and repeat steps in the benchmarks repository; links "Benchmark harness", "Methodology" (`docs/METHODOLOGY.md`) and "Reproduce a run" (`docs/REPRODUCE.md`) on `main` of splotlabs/benchmarks; raw bundles, CSV, campaign lock, manifest and checksums for each dataset | Epic #2046, "Owner decisions and scope"; splotlabs/benchmarks `docs/METHODOLOGY.md` and `docs/REPRODUCE.md`; data contract, `downloads` and `reproduce` | Documented                                                          |
| Labels, statuses, banners, units and field names in the interactive views; "requested threads" is the value given to the thread option of each decoder                                                                                                                                       | Data contract `splotbench.index/1` and `splotbench.summary/1`                                                                                           | Documented. Tested with synthetic fixtures only, not with real data |

The website does not show the licensing email address. It links to the license section of the
README, which contains the address.
