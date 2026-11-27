# Design

The website is the splot README identity, expanded into a product page. The owner approved this
direction on 2026-11-20.

## Principles

1. **Brand first.** The lowercase `splot` wordmark, the dark background and the cyan, violet and
   pink gradient come from `docs/assets/hero.svg` in the splot repository. Do not replace them.
2. **Product presentation.** Short headings, large type, generous space, one idea for each section.
3. **App-like finish.** Command panels, compact navigation, and controls with clear hover, pressed
   and focus states. Each control does a real thing. Nothing simulates the tool.
4. **Restraint.** The gradient is for the wordmark. The three brand colors label things. The glows
   stay in the background of the first screen.

## Tokens

| Token                 | Value                                                    | Use                                                         |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| `--bg`                | `#05050a`                                                | Page background                                             |
| `--text`              | `#f5f5f7`                                                | Text, primary button                                        |
| `--muted`             | `#a1a1aa`                                                | Secondary text                                              |
| `--cyan`              | `#5ee7ff`                                                | Gradient start, Encode label, focus ring                    |
| `--violet`            | `#a78bfa`                                                | Gradient middle (45%), Validate label                       |
| `--pink`              | `#ff7ab6`                                                | Gradient end, Decode label, status dot                      |
| `--wordmark`          | `linear-gradient(90deg, cyan 0%, violet 45%, pink 100%)` | Wordmark only                                               |
| `--glow-a/b/c`        | `#6d5dfc`, `#ff5fa2`, `#22d3ee`                          | Background glows only                                       |
| `--surface`, `--line` | white at 4% and 10%                                      | Panels and borders                                          |
| `--radius`            | `20px`                                                   | Panels and cards. Controls use 10–16 px. Buttons are pills. |

## Type

System font stack from the SVG. Monospace stack for commands.

| Element  | Size                                    | Weight |
| -------- | --------------------------------------- | ------ |
| Wordmark | 88–200 px, letter-spacing −0.043em      | 700    |
| `h1`     | 28–48 px                                | 600    |
| `h2`     | 30–52 px. The second sentence is muted. | 600    |
| `h3`     | 22–28 px                                | 600    |
| Body     | 17 px, line-height 1.55                 | 400    |
| Commands | 14–15 px monospace                      | 400    |

## Layout

- Content width 68rem. Command panels 50rem. The gutter is 16–32 px.
- Sections have vertical padding of 48–96 px. Sections do not have a forced height.
- The capability grid has two columns. It has one column below 736 px.
- Commands wrap. The page does not scroll horizontally.

## Components

- **Navigation bar:** sticky, blurred, 16 px radius. Below 736 px, the links move into a
  `<details>` menu that operates without JavaScript.
- **Buttons:** primary (light pill) and quiet (translucent pill). There is one primary action for
  each screen.
- **Command panel:** a header with "Copy all", then one row for each command.
- **Command:** one command with a Copy button, for use in cards.
- **Card:** the same surface as the panel. A colored eyebrow, an `h3`, text, then commands.
- **Benchmark views** (benchmarks page only): a filter panel with the panel surface, horizontal
  SVG bar charts and numeric tables. Each chart has a table with the same data; the table is
  the accessible source. Cyan, violet and pink label the decoders. Pink text marks a failed
  status. A wide table scrolls inside its own focusable region, never the page.

## Motion

- The glows drift for 14 s, 18 s and 16 s, as in the SVG.
- Controls change in 150–200 ms.
- With `prefers-reduced-motion: reduce`, all animation and transitions stop. No content depends
  on motion.

## Accessibility

- Touch targets are 44 px or more.
- The focus ring is 2 px cyan with an offset.
- Copy buttons report the result in a status region.
- Copy buttons are hidden when JavaScript is not available.
