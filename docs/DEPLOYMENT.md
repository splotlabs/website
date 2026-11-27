# Deployment

The website is served by **Cloudflare Workers Static Assets**. There is no Worker script and no
Cloudflare Pages project.

## Current state (2026-11-20)

| Item                             | Value                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Worker                           | `splot-website`                                                                                                 |
| Production origin                | `https://splotlabs.io` (Workers Custom Domain, apex only)                                                       |
| First production version         | `6c02dd86-353c-4e08-acdc-48e4aad7b276`, from commit `cf64d59`                                                   |
| Content reference                | `splotlabs/splot` at `e299bc3d85a5b2fbcf2b2a6162a4ee127986ab92`                                                 |
| `workers.dev` production address | Disabled (`"workers_dev": false`)                                                                               |
| `workers.dev` Preview URLs       | Enabled (`"preview_urls": true`). Cloudflare adds `noindex` to them.                                            |
| Workers Builds (Git integration) | Connected to `splotlabs/website`. A merge to `main` deploys to production. Other branches get a Worker Preview. |
| Branch rules                     | `main` accepts changes through pull requests only. The CI job `check` must pass. No force push.                 |
| Zone setting "Always Use HTTPS"  | On since 2026-11-20. It was off before. HTTP requests get a redirect to HTTPS.                                  |
| `www.splotlabs.io`               | No record and no redirect                                                                                       |

Configuration is in `wrangler.jsonc`: the asset directory `./dist`, `not_found_handling:
"404-page"`, the `splotlabs.io` Custom Domain, and an empty `previews` block. Response headers
are in `public/_headers`.

Cloudflare created one DNS record for the Custom Domain: a proxied record for `splotlabs.io`
that points to the Worker. Cloudflare manages this record and the certificate. Do not edit the
record by hand.

## Deploy

Deployment is automatic:

1. Push a branch to `splotlabs/website`. Workers Builds makes a Worker Preview of the branch.
   The Preview URL is public. Workers Builds does not build branches of forks.
2. Open a pull request. GitHub Actions runs the job `check`.
3. Merge the pull request after `check` passes. Workers Builds then runs the build command and
   `npx wrangler deploy`. The new version is live at `https://splotlabs.io` when the build ends.

A direct push to `main` is refused by the repository ruleset.

### Deploy by hand (emergency only)

You must be signed in (`npx wrangler login`) to the Cloudflare account that owns the
`splotlabs.io` zone. Use the project Wrangler, not a global installation. Deploy only a commit
that is on `main`, or the next automatic build will replace your version.

```bash
npm ci
npm run check && npm run format:check && npm test
npm run deploy:production
```

## Verify a deployment

```bash
curl -sI https://splotlabs.io/            # 200, with the security headers, without X-Robots-Tag
curl -s -o /dev/null -w '%{http_code}\n' https://splotlabs.io/no-such-page   # 404
```

Then open the page on a desktop and on a phone. Check the copy buttons and the menu.

HTML is served with `Cache-Control: public, max-age=0, must-revalidate`. Files in `/_astro/`
have hashed names and a one-year immutable cache.

## Workers Builds settings

```text
local change → branch → Worker Preview → pull request → CI → merge to main
→ Workers Builds → production at splotlabs.io
```

| Setting        | Production trigger                                       | Preview trigger            |
| -------------- | -------------------------------------------------------- | -------------------------- |
| Repository     | `splotlabs/website`                                      | `splotlabs/website`        |
| Branches       | `main`                                                   | all branches except `main` |
| Root directory | `/`                                                      | `/`                        |
| Build command  | `npm run check && npm run format:check && npm run build` | the same                   |
| Deploy command | `npx wrangler deploy`                                    | `npx wrangler preview`     |

GitHub Actions runs checks only. It does not deploy. A passed GitHub check does not make
Workers Builds wait, so the build command contains the checks. The browser tests run only in
GitHub Actions, and the ruleset makes them a condition of the merge.

## Benchmark data origin

The benchmarks page (`/benchmarks/`) reads `index.json`, and then the `summary.json` of the
selected dataset, in the browser. There is no bucket, no storage domain and no CORS rule to
manage. The published datasets are files in the `published/` directory of
[splotlabs/benchmarks](https://github.com/splotlabs/benchmarks), and the page reads them through
the raw file host of GitHub:

| Item                        | Value                                                                    |
| --------------------------- | ------------------------------------------------------------------------ |
| `benchmarks.dataBase`       | `https://raw.githubusercontent.com/splotlabs/benchmarks/main/published/` |
| Index                       | `<dataBase>index.json`                                                   |
| Dataset                     | `<dataBase>datasets/<dataset_id>/summary.json` and its download files    |
| `connect-src` in `_headers` | `'self'` and the same URL, as a path-scoped source                       |

Publication is a pull request in splotlabs/benchmarks that adds a dataset directory and updates
`published/index.json`. The website needs no change and no deployment for a new dataset. When
the index lists no dataset, the page shows "Results are not published yet." When the index
cannot be loaded, the page shows the load error state and the static methodology text.

Properties of the raw file host that the page must tolerate:

- It serves JSON as `text/plain`. The page parses the body and does not check the content type.
- It serves the bundles and the other download files as ordinary downloads. The download links
  are navigations, so they need no `connect-src` entry.
- It caches responses for some minutes. A merged publication can take that long to appear.
- It sends an open CORS header, and the page sends no credentials (`credentials: "omit"`).

To change the data base, make two edits in one pull request: set `benchmarks.dataBase` in
`src/data/site.ts` (an https URL with a final `/`), and put the same URL in `connect-src` in
`public/_headers`. Do not add other sources. The test "connect-src names exactly the data base"
in `tests/benchmarks.spec.ts` fails when the two do not agree.

## Roll back the content

List the versions, then roll back to a known-good version:

```bash
npx wrangler versions list
npx wrangler rollback <version-id>
```

After a rollback, revert the bad commit on `main` with `git revert` and push. If you do not,
the next deployment puts the bad version back. Do not force-push.

At the first launch there was no earlier version. The first known-good version is
`6c02dd86-353c-4e08-acdc-48e4aad7b276`.

## Roll back the domain

A content rollback does not change DNS or the Custom Domain. To detach the domain:

1. Remove the `routes` entry from `wrangler.jsonc` and deploy.
2. In the Cloudflare dashboard, open the Worker, then **Domains**, and delete the
   `splotlabs.io` Custom Domain. This also removes the DNS record that Cloudflare created.

Before the launch, the zone had no DNS records, so there is nothing to restore.

The zone setting "Always Use HTTPS" is independent of the Worker. To reverse it, set it to off
in the dashboard: **SSL/TLS**, then **Edge Certificates**.
