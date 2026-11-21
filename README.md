# splot website

The source of [splotlabs.io](https://splotlabs.io), the website for
[splot](https://github.com/splotlabs/splot): an encoder, a decoder and a validator for AV2.

The website is one static landing page and a 404 page. It is built with
[Astro](https://astro.build) and served by Cloudflare Workers Static Assets. It has no backend,
no analytics and no client framework.

## Develop

You need Node.js 22.23.4 or later. The pinned version is in `.nvmrc`.

```bash
npm ci
npm run dev
```

## Check

```bash
npm run check
npm run format:check
npm test
```

`npm test` builds the site, serves `dist/` with the project Wrangler, and runs the Playwright
smoke and accessibility tests. It uses your installed Chrome. In CI, it uses the Playwright
Chromium.

## Edit the content

Links, commands and facts are in `src/data/site.ts`. The page text is in `src/pages/index.astro`.
Each product claim comes from the splot repository. If you change a claim, update
[docs/CONTENT-SOURCES.md](./docs/CONTENT-SOURCES.md).

The design rules are in [DESIGN.md](./DESIGN.md). The test record is in [docs/QA.md](./docs/QA.md).

The social image `public/og.png` is a 1200 × 630 render of `src/brand/og.svg`.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md). Copyright © 2026 Bartosz Tomczyk. Uses outside
that license, which includes typical commercial deployments, need a separate written license
from him (bartekplus@gmail.com). SplotLabs and splot are project names he uses, not a separate
company.

The brand assets (`public/favicon.svg`, `public/og.png`, `src/brand/og.svg`) are adapted from
`docs/assets/hero.svg` in the splot repository, by the same copyright holder, under the same
license. The npm dependencies are development tools. They keep their own licenses and are not
part of the published site, except for the small Astro runtime output in the built CSS and
JavaScript.

splot is source-available. It is not open source.

## Contributing

Read the [contribution policy](https://github.com/splotlabs/.github/blob/main/CONTRIBUTING.md)
first. Other people's contributions are licensed by their authors under the unmodified MIT No
Attribution License (MIT-0), through the
[SplotLabs Contribution Terms](https://github.com/splotlabs/.github/blob/main/CLA.md). You keep
your copyright. MIT-0 lets everyone who receives your contribution reuse it, including
commercially. It covers only your own original material. The rest of the website, including the
file you edit, keeps its license.

A contribution is merged only after each rights holder's acceptance of the approved terms is
recorded. This link, a ticked box in a pull request and a green CI run are not that acceptance.
