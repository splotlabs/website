# Deployment

The website is served by **Cloudflare Workers Static Assets**. There is no Worker script and no
Cloudflare Pages project.

## Current state (2026-11-20)

| Item                             | Value                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Worker                           | `splot-website`                                                                |
| Production origin                | `https://splotlabs.io` (Workers Custom Domain, apex only)                      |
| First production version         | `6c02dd86-353c-4e08-acdc-48e4aad7b276`, from commit `cf64d59`                  |
| Content reference                | `splotlabs/splot` at `e299bc3d85a5b2fbcf2b2a6162a4ee127986ab92`                |
| `workers.dev` production address | Disabled (Wrangler default when a route is configured)                         |
| `workers.dev` Preview URLs       | Disabled (Wrangler default when `workers.dev` is disabled)                     |
| Workers Builds (Git integration) | Not connected. Deployments are manual.                                         |
| Zone setting "Always Use HTTPS"  | On since 2026-11-20. It was off before. HTTP requests get a redirect to HTTPS. |
| `www.splotlabs.io`               | No record and no redirect                                                      |

Configuration is in `wrangler.jsonc`: the asset directory `./dist`, `not_found_handling:
"404-page"`, the `splotlabs.io` Custom Domain, and an empty `previews` block. Response headers
are in `public/_headers`.

Cloudflare created one DNS record for the Custom Domain: a proxied record for `splotlabs.io`
that points to the Worker. Cloudflare manages this record and the certificate. Do not edit the
record by hand.

## Deploy by hand

You must be signed in (`npx wrangler login`) to the Cloudflare account that owns the
`splotlabs.io` zone. Use the project Wrangler, not a global installation.

```bash
npm ci
npm run check && npm run format:check && npm test
npm run deploy:production
```

`npm run deploy:production` runs `wrangler deploy`. It uploads `dist/` and makes the new version
live at `https://splotlabs.io` immediately.

To make a Worker Preview of a branch:

```bash
npm run build
npm run deploy:preview
```

`wrangler preview` uses the Git branch name as the Preview name. A Preview URL is public. A
Preview URL operates only when Preview URLs are enabled for the Worker (`"preview_urls": true`
in `wrangler.jsonc`, then a production deployment).

## Verify a deployment

```bash
curl -sI https://splotlabs.io/            # 200, with the security headers, without X-Robots-Tag
curl -s -o /dev/null -w '%{http_code}\n' https://splotlabs.io/no-such-page   # 404
```

Then open the page on a desktop and on a phone. Check the copy buttons and the menu.

HTML is served with `Cache-Control: public, max-age=0, must-revalidate`. Files in `/_astro/`
have hashed names and a one-year immutable cache.

## Routine workflow

```text
local change → checks → branch and pull request → CI → review → merge to main
→ deploy → verify at splotlabs.io
```

When Workers Builds is connected, a push to a branch makes a Worker Preview, and a merge to
`main` deploys to production. Proposed Workers Builds settings:

| Setting           | Value                                                    |
| ----------------- | -------------------------------------------------------- |
| Repository        | `splotlabs/website`                                      |
| Production branch | `main`                                                   |
| Root directory    | repository root                                          |
| Build command     | `npm run check && npm run format:check && npm run build` |
| Deploy command    | `npx wrangler deploy`                                    |
| Preview command   | `npx wrangler preview`                                   |

GitHub Actions runs checks only. It does not deploy. A passed GitHub check does not make
Workers Builds wait, so the build command above contains the checks.

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
