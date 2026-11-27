# Instructions for agents

This repository is the website for [splot](https://github.com/splotlabs/splot), an AV2 toolkit.
`CLAUDE.md` points to this file.

## Decisions that are final

Do not ask the owner to make these decisions again.

- Scope: one English landing page for splot, one benchmarks page (`/benchmarks/`), and a 404 page.
  No analytics, forms, accounts, CMS, blog, payments, backend, or browser codec demo.
- Production origin: `https://splotlabs.io` (the apex domain, not `www`).
- Repository: `splotlabs/website`, public, PolyForm Noncommercial 1.0.0.
- Hosting: Cloudflare Workers Static Assets. Do not use Cloudflare Pages.
- Stack: Astro static output, strict TypeScript, native CSS, minimal vanilla JavaScript, npm.
  No React, Tailwind, SSR adapter, or Worker script.
- Design: dark, with the splot wordmark and the cyan, violet and pink gradient. See `DESIGN.md`.

## Architecture

- `src/data/site.ts`: links, commands and facts. Edit the copy here first.
- `src/pages/index.astro`: the landing page. `src/pages/404.astro`: the 404 page.
  `src/pages/benchmarks.astro`: the benchmarks page.
- `src/layouts/BaseLayout.astro`: head, navigation, footer.
- `src/components/`: `Command` (one command with a Copy button) and `CommandPanel`.
- `src/styles/global.css`: all styles and design tokens.
- `src/scripts/enhance.ts`: browser JavaScript for all pages (copy buttons, menu close).
- `src/scripts/benchmarks.ts` and `src/scripts/bench-data.ts`: browser JavaScript for the
  benchmarks page only (data loading, validation, filters, SVG charts).
- `public/_headers`: response headers for Workers Static Assets, including the
  Content-Security-Policy. The policy allows no inline script and no inline style. `connect-src`
  names only `'self'` and the benchmark data base (`benchmarks.dataBase` in `src/data/site.ts`).
- `wrangler.jsonc`: assets only. Do not add `main`, bindings, or routes without approval.

## Commands

| Command                     | Function                                                     |
| --------------------------- | ------------------------------------------------------------ |
| `npm run dev`               | Astro development server                                     |
| `npm run check`             | Astro and TypeScript checks                                  |
| `npm run format:check`      | Prettier check (`npm run format` to fix)                     |
| `npm run build`             | Production build into `dist/`                                |
| `npm run preview`           | Serve `dist/` locally with Wrangler                          |
| `npm test`                  | Build, then run the Playwright smoke and accessibility tests |
| `npm run deploy:preview`    | **Public upload.** Creates a Worker Preview                  |
| `npm run deploy:production` | **Public upload.** Deploys to production                     |

## Rules for copy

- Each product claim and command must come from the splot repository. Record the source in
  `docs/CONTENT-SOURCES.md`, with the upstream commit.
- Say "source-available". Do not say "open source".
- Keep the pre-alpha status visible.
- Do not add users, testimonials, release dates, binary downloads, or simulated tool output.
- Benchmark results appear only on the benchmarks page, and only from published datasets that the
  [splotlabs/benchmarks](https://github.com/splotlabs/benchmarks) harness produced. Do not show a
  number that is not in a published dataset. Synthetic test fixtures stay in `tests/fixtures/` and
  never appear in production.
- Treat splot as a read-only reference during website work.
- If an example misstates a command, correct the example and its source attribution here.
- If the documented command fails in splot, report the defect in splot. Describe the verified limitation on the website.

Fix website defects within scope during the session. For a deferred fix, open or update an issue
in the owning repository before handover. Follow the
[shared issue procedure](https://github.com/splotlabs/.github/blob/main/AGENTS.md#defects-found-during-work).

## Design skills

If design skills are installed, use them in this order: the owner's brief and `DESIGN.md`, then
truthful content, then accessibility and performance, then the preferences of a skill.
A skill must not replace the brand palette, add a framework, or force full-height sections.

## Gates

Get the owner's approval for each of these actions, each time:

- A change of the settings of the remote repository.
- A manual `npm run deploy:preview` or `npm run deploy:production`.
- A Custom Domain, a route, or a DNS change for `splotlabs.io`.

A branch push publishes a public Worker Preview, and a merge into `main` deploys production.
Autonomous mode covers both.

Do not put account identifiers, dashboard addresses, tokens, or private notes in this repository.

## Autonomous work

The owner turns autonomous mode on in the task ("autonomous", "take it to merge") or by handing
over a GitHub issue. Without it, a commit, push, PR or merge needs the task to name it.

In autonomous mode, do the whole path without asking or reporting progress: branch, implement,
commit, run the checks and a code review, push, open the PR (linked to its issue, if any), address
every review comment (fix it, or reply with the reason it stays), and merge when CI is green.
Diagnose failing checks and conflicts, and continue.

Stop only for a decision that is the owner's:

- The requirement is unclear.
- The best solution is a larger restructure than the task implies, or several sound designs exist.
- A gate above applies, or the change touches a final decision.
- The action is destructive or cannot be undone.

Ask once, with the options, their pros, cons and effort, and a recommendation. Continue the work
that does not depend on the answer. Never reach the merge with a hack, workaround, weakened check,
skipped test or dismissed comment.
