# QA record

Date: 2026-11-20. Subject: the production build (`npm run build`), served locally by the project
Wrangler 4.165.0 (`wrangler dev`), which applies the Workers Static Assets routing and `_headers`.

Local tools: Node.js 26.13.1, Astro 7.4.13, Chrome (installed), Playwright, axe-core,
Lighthouse 13.6.0.

## Passed

| Check                                                                            | Method                                 | Result                                 |
| -------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| Type and Astro checks                                                            | `npm run check`                        | 0 errors, 0 warnings                   |
| Formatting                                                                       | `npm run format:check`                 | Passed                                 |
| Home page loads, no console errors, no failed requests                           | Playwright                             | Passed                                 |
| Canonical URL is `https://splotlabs.io/`, no `noindex` on the home page          | Playwright                             | Passed                                 |
| Security headers are served from `_headers`                                      | Playwright and `curl -I`               | Passed                                 |
| A missing path returns HTTP 404 with the 404 page and `noindex`                  | Playwright and `curl`                  | Passed                                 |
| `_headers` is not served as a file                                               | Playwright                             | Passed                                 |
| No horizontal overflow at 320, 390, 768 and 1440 px                              | Playwright                             | Passed                                 |
| Each internal anchor has a target                                                | Playwright                             | Passed                                 |
| A copy button writes the command to the clipboard and reports it                 | Playwright                             | Passed                                 |
| The compact menu opens, navigates and closes                                     | Playwright, 390 px                     | Passed                                 |
| The skip link is the first keyboard stop and is visible                          | Playwright                             | Passed                                 |
| Reduced motion stops the background animation                                    | Playwright                             | Passed                                 |
| The page is usable without JavaScript. Copy buttons are hidden.                  | Playwright                             | Passed                                 |
| Automated accessibility (WCAG 2.0–2.2 A and AA rules, best practices)            | axe-core, both pages, 390 and 1440 px  | 0 violations                           |
| External links                                                                   | `curl`, each link                      | All 200, with the two exceptions below |
| Build output has no server bundle or Functions directory                         | File list of `dist/`                   | Passed                                 |
| No inline script or style in the HTML (required by the CSP)                      | `grep` on `dist/index.html`            | Passed                                 |
| Hashed assets have a long immutable cache. HTML must revalidate.                 | `curl -I`                              | Passed                                 |
| License body is the official PolyForm Noncommercial 1.0.0 text                   | `diff` against the PolyForm repository | Identical                              |
| No account identifiers, dashboard addresses or email addresses in the repository | `grep`                                 | None found                             |

### Lighthouse 13.6.0, local Wrangler server, default throttling

| Mode    | Performance | Accessibility | Best practices | SEO |
| ------- | ----------- | ------------- | -------------- | --- |
| Mobile  | 100         | 100           | 100            | 100 |
| Desktop | 100         | 100           | 100            | 100 |

The first mobile run gave performance 90 (total blocking time 410 ms). The cause was a
`backdrop-filter` on the command panel. After its removal, two mobile runs gave 100.
These are local scores. Scores on the deployed site can be different.

### Size (gzip)

| File                   | Size                           |
| ---------------------- | ------------------------------ |
| First-party JavaScript | 0.4 kB (target: 20 kB maximum) |
| CSS                    | 3.1 kB                         |
| `index.html`           | 3.1 kB                         |

## After publication (2026-11-20)

| Check                                                                                         | Result |
| --------------------------------------------------------------------------------------------- | ------ |
| CI on GitHub Actions: Node.js 24.22.1, Playwright Chromium, all checks and 18 tests           | Passed |
| Worker Preview: HTML identical to the local build, headers, real 404, `X-Robots-Tag: noindex` | Passed |
| `https://splotlabs.io/`: HTTP 200, valid certificate for `splotlabs.io`                       | Passed |
| `https://splotlabs.io/`: HTML identical to the local build                                    | Passed |
| `https://splotlabs.io/`: security headers present, no `X-Robots-Tag`                          | Passed |
| `https://splotlabs.io/no-such-page`: HTTP 404                                                 | Passed |
| Hashed assets: one-year immutable cache. HTML: must revalidate.                               | Passed |
| `robots.txt`, `sitemap.xml`, `favicon.svg`, `og.png`: HTTP 200                                | Passed |

These production checks used `curl` against a Cloudflare edge address, because the local DNS
resolver still had a cached negative answer for the new record.

## Not run

- A real browser session on `https://splotlabs.io/` (desktop and phone), and the copy buttons
  and menu on the deployed site.
- Lighthouse on the deployed site.
- Firefox, Safari, and real phones. All browser tests used Chrome.
- A screen reader session. The accessibility result is from automated rules and a manual check
  of headings, landmarks, focus and contrast. It is not a formal WCAG 2.2 AA claim.
- The product commands on the page. They are copied from the splot README and were not executed.
- The Impeccable launcher binary. The review used its audit checklist by hand (accessibility,
  performance, theming, responsive behavior).

## Review findings that were fixed

1. Two copy buttons had the same accessible name. Each of the 14 names is now unique.
2. The label colors for Decode and Validate were different in the workflow panel and the cards.
3. On a 390 px screen, long commands were cut. Commands now wrap.
4. The open mobile menu was translucent, and the text below it showed through.
5. The command panel blur caused 410 ms of blocking time in the mobile Lighthouse run.

## Benchmarks page (2026-11-27)

Subject: the production build with `benchmarks.dataBase` set to `null`, served by the project
Wrangler with the real `_headers`. The loaded views use the synthetic fixtures in
`tests/fixtures/`, served on a same-origin path by Playwright (`page.route`) and selected by a
test start hook. The fixtures are not in `dist/`.

| Check                                                                                    | Method               | Result       |
| ---------------------------------------------------------------------------------------- | -------------------- | ------------ |
| Production state "Results are not published yet.", no request outside the page assets    | Playwright           | Passed       |
| `connect-src` agrees with `benchmarks.dataBase`                                          | Playwright, headers  | Passed       |
| The start hook refuses other origins                                                     | Playwright           | Passed       |
| Filters, URL state, baseline change, failed cells, null metrics, thread scaling, history | Playwright, fixtures | Passed       |
| Unsupported index, summary and workload versions; load error; invalid data; empty index  | Playwright, fixtures | Passed       |
| Download links, provenance details, copy action, synthetic and partial banners           | Playwright, fixtures | Passed       |
| No console errors and no CSP violations                                                  | Playwright           | Passed       |
| No horizontal overflow at 320, 390, 768 and 1440 px, production and loaded               | Playwright           | Passed       |
| Automated accessibility (same rules as above), production and loaded, 390 and 1440 px    | axe-core             | 0 violations |
| Usable without JavaScript                                                                | Playwright           | Passed       |
| Benchmarks page JavaScript                                                               | gzip size            | 10.9 kB      |

Not run: real published data, a real data origin with CORS, Firefox, Safari, real phones and a
screen reader session.

## Brand fidelity

Compared with `docs/assets/hero.svg` at the recorded upstream commit:

- Wordmark: lowercase `splot`, weight 700, letter-spacing −8/184. Same.
- Gradient: left to right, `#5ee7ff` 0, `#a78bfa` 45%, `#ff7ab6` 100%. Same.
- Background `#05050a`, text `#f5f5f7`, muted text `#a1a1aa`. Same.
- Glows: `#6d5dfc`, `#ff5fa2`, `#22d3ee`, behind the first screen only.
- The favicon is new: the letter "s" of the wordmark with the same gradient.

## Screenshots

In `docs/screenshots/`: `desktop-1440.png`, `desktop-1440-full.png`, `tablet-768-full.png`,
`mobile-390.png`, `mobile-390-full.png`, `404-1440.png`.
