# Hosting

The reference app is a static Vite build. It can be hosted on Vercel, Cloudflare
Pages, Netlify, or any static asset host.

Current Cloudflare Pages URL:

- `https://maestro-template.pages.dev`

## Local Static Smoke

```bash
pnpm build
pnpm smoke:web-static
```

The smoke verifies `apps/web/dist/index.html`, the React root, linked built
assets, and asset count. It is the minimum reviewer-safe proof before pointing a
hosting provider at the repo.

## Recommended Hosting Defaults

- Build command: `pnpm build`
- Output directory: `apps/web/dist`
- Node package manager: `pnpm`
- Environment: fake/local providers by default
- Production promotion: only from a commit that passed `pnpm verify` and
  `pnpm smoke:web-static`

## Cloudflare Pages

Create the project once:

```bash
pnpm dlx wrangler@latest pages project create maestro-template --production-branch main
```

Deploy:

```bash
pnpm deploy:cloudflare
```

Smoke the hosted app:

```bash
pnpm smoke:hosted
pnpm smoke:hosted:browser
pnpm smoke:hosted:visual
```

When running on the headless host, wrap deploys in the secret environment:

```bash
headless-bws-env exec -- pnpm deploy:cloudflare
```

## Provider Notes

- Vercel: configure the project root as the repo root and output directory as
  `apps/web/dist`.
- Cloudflare Pages: use the same build command and output directory.
- Convex backend: provision separately before enabling live data routes.
- API docs: the backend docs route is authored at
  `packages/convex/confect/http.ts`.
