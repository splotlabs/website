# Content sources

All product claims and commands on the website come from the product repository
[splotlabs/splot](https://github.com/splotlabs/splot) at commit
`0616c379f300ccca7afbfcab401444de1c5122b4` (2026-11-27).

The website does not fetch upstream content at build time or at runtime. When the
README changes, update the copy by hand and update the commit above.

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

The website does not show the licensing email address. It links to the license section of the
README, which contains the address.
