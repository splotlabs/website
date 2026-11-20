# Instructions for agents

This repository is the website for [splot](https://github.com/splotlabs/splot), an AV2 toolkit.
`CLAUDE.md` points to this file.

## Decisions that are final

Do not ask the owner to make these decisions again.

- Scope: one English landing page for splot, and a 404 page. No analytics, forms, accounts, CMS,
  blog, payments, backend, or browser codec demo.
- Production origin: `https://splotlabs.io` (the apex domain, not `www`).
- Repository: `splotlabs/website`, public, PolyForm Noncommercial 1.0.0.
- Hosting: Cloudflare Workers Static Assets. Do not use Cloudflare Pages.
- Stack: Astro static output, strict TypeScript, native CSS, minimal vanilla JavaScript, npm.
  No React, Tailwind, SSR adapter, or Worker script.
- Design: dark, with the splot wordmark and the cyan, violet and pink gradient. See `DESIGN.md`.

## Architecture

- `src/data/site.ts`: links, commands and facts. Edit the copy here first.
- `src/pages/index.astro`: the landing page. `src/pages/404.astro`: the 404 page.
- `src/layouts/BaseLayout.astro`: head, navigation, footer.
- `src/components/`: `Command` (one command with a Copy button) and `CommandPanel`.
- `src/styles/global.css`: all styles and design tokens.
- `src/scripts/enhance.ts`: the only browser JavaScript (copy buttons, menu close).
- `public/_headers`: response headers for Workers Static Assets, including the
  Content-Security-Policy. The policy allows no inline script and no inline style.
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
- Do not add benchmarks, users, testimonials, release dates, binary downloads, or simulated
  tool output.
- Do not treat the splot repository as writable. It is a read-only reference.

## Design skills

If design skills are installed, use them in this order: the owner's brief and `DESIGN.md`, then
truthful content, then accessibility and performance, then the preferences of a skill.
A skill must not replace the brand palette, add a framework, or force full-height sections.

## Gates

Get the owner's approval for each of these actions, each time:

- A push to the remote repository, or a change of its settings.
- A Worker Preview or a production deployment.
- A Custom Domain, a route, or a DNS change for `splotlabs.io`.

Do not put account identifiers, dashboard addresses, tokens, or private notes in this repository.
