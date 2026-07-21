# Deploying the Triarchs of Olympus Website

This site (everything inside `SITE/`) is a fully static site: plain HTML,
CSS, vanilla JavaScript and SVG. It needs no build step, no server-side
language, no database, and no environment variables. It can be served by
literally any static file host — this guide focuses on GitHub Pages since
that's this repository's target, but the same folder works anywhere.

## 1. Previewing it locally

**Don't just double-click `index.html`.** Opening HTML files directly from
disk loads them over the `file://` protocol, and several things this site
relies on will silently break under `file://`:

- `fetch`/`<use href="...">` references from `world.html` into
  `assets/icons/icons.svg` and cross-file SVG symbol reuse can be blocked by
  the browser's local-file security model.
- Relative-path assumptions behave differently under `file://` than under
  `http://`, so a page that looks fine locally can still break once actually
  deployed, and vice versa — you want to test the same protocol family
  (`http`) that GitHub Pages will actually serve over.
- Some browsers silently disable `fetch`/CORS-sensitive features for local
  files, which can mask real problems until after you've published.

Instead, run a throwaway local HTTP server **from inside the `SITE/`
folder**:

```bash
cd SITE

# Option A — Python 3 (usually already installed)
python -m http.server 8080

# Option B — Node.js, no install required
npx serve .

# Option C — Node.js "http-server" package
npx http-server -p 8080
```

Then open `http://localhost:8080/` in a browser. Because this project
already has Node.js and `npm` set up at the repository root for the game
itself, `npx serve .` (run from inside `SITE/`) is the path of least
resistance — it needs no extra install and doesn't touch the game's own
`node_modules` or `package.json`.

Check the browser console for 404s or script errors while you click through
every page, resize the window, and try the mobile nav menu and the Download
button's popover.

## 2. Publishing `SITE/` with GitHub Pages

This repository contains the game project **and** the website side by side,
with the website confined to the `SITE/` subfolder. GitHub Pages has three
ways to serve a subfolder like this; here's how they compare for this repo:

| Method | Needs a build step? | Works with `SITE/` as a subfolder? | Notes |
|---|---|---|---|
| **A. GitHub Actions workflow** (recommended) | No (site is pre-built) | Yes, directly | Deploys exactly `SITE/` as the Pages artifact, whatever branch it lives on. Cleanest separation from the game project. |
| B. Deploy from a branch, root of branch | No | Only if `SITE/`'s contents are moved to the root of a **separate** branch | Requires copying/mirroring files onto another branch — more moving parts, and easy to let the copy drift out of sync with `main`. |
| C. Deploy from a branch, `/docs` folder | No | Only if the folder is literally named `docs` at the repo root | Would mean renaming `SITE/` to `docs/`, which conflicts with this project's existing `SITE/docs/` (developer-facing traceability docs) and the brief's required folder name. Not recommended here. |

### Recommended method for this repository: a GitHub Actions workflow

Because you are not authorised to add files under `.github/` from within
this task, a ready-to-use workflow is provided here as a **template** —
copy it into `.github/workflows/deploy-site.yml` yourself when you're ready
to publish:

```yaml
name: Deploy SITE to GitHub Pages

on:
  push:
    branches: ["main"]
    paths: ["SITE/**"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: "SITE"
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then, in the repository's **Settings → Pages**, set "Source" to **"GitHub
Actions"**. The `paths: ["SITE/**"]` filter means pushes that only touch the
game code won't trigger a redeploy of the site, and vice versa — the two
halves of the repo stay decoupled.

If you'd rather avoid Actions entirely, method B (a dedicated `gh-pages`
branch containing only the built site at its root, published with a tool
like `git subtree push` or the third-party `peaceiris/actions-gh-pages`
action) also works, but requires you to keep a second branch in sync by
hand or via that same Actions setup — for a static site with no build step,
method A is simpler and has fewer places to go wrong.

## 3. How the project subdirectory affects paths

If this repository is `username/Fable-MOBA` and Pages serves it as a
project site, the site's real URL will be:

```
https://username.github.io/Fable-MOBA/
```

*(exact repository name may differ — substitute accordingly)*

Every link, stylesheet, script and image reference in this site uses
**relative paths** (`./css/site.css`, `./assets/...`, `characters.html`),
never a leading `/`. That's deliberate: a root-relative path like
`/assets/images/example.png` would resolve to
`https://username.github.io/assets/images/example.png` — outside the
`/Fable-MOBA/` project prefix — and 404. Relative paths resolve correctly
regardless of which subdirectory the site is actually served from, so no
changes are needed whether Pages serves this repo at the root of a custom
domain or under a `/repo-name/` prefix.

If you ever move `SITE/`'s contents to be the *only* thing in a dedicated
repository (so it serves from the domain root, or from a `username.github.io`
user/org site), the relative paths continue to work unchanged — that's the
whole point of using them.

## 4. Connecting a custom domain later

1. In **Settings → Pages**, enter your domain under "Custom domain" (e.g.
   `triarchsofolympus.example.com` or an apex domain).
2. GitHub will create/verify a `CNAME` file for you automatically when you
   save that field through the UI — **do not hand-author a `CNAME` file
   inside `SITE/` yourself** unless you're confident about the exact domain,
   since GitHub Pages writes it based on the Settings UI and a mismatched
   manual file can cause the check to fail.
3. Add the corresponding DNS records at your domain registrar:
   - Apex domain → four `A` records pointing at GitHub's Pages IPs (GitHub
     lists the current IPs in their Pages docs).
   - Subdomain (`www` or otherwise) → a `CNAME` record pointing at
     `username.github.io`.
4. Once DNS propagates, enable "Enforce HTTPS" in the same Settings → Pages
   panel.
5. Because every internal link in this site is relative (see §3), nothing
   in `SITE/` needs to change when you switch from a `github.io/repo-name/`
   URL to a custom domain.

## 5. Updating the site safely without touching the game

- Everything the site needs lives inside `SITE/`. Routine updates — new
  copy, new character art, tweaked balance callouts — should only ever
  touch files under this folder.
- If a game-balance change happens upstream (say, an ability number changes
  in `src/data/heroes.ts`), treat that as a prompt to **manually re-check**
  `SITE/js/characters.js` and `SITE/world.html` against the new source and
  update the copied numbers — there is no automated sync between the game
  and the site, by design (the site has no build step and does not import
  from `src/`).
- `SITE/docs/source-map.md` is the checklist for that re-verification: it
  names the exact source file and field for every fact on the site, so a
  future update only has to diff against that list.
- Before pushing an update, re-run the local preview steps in §1 and click
  through every page once — there is no automated test suite for the
  website (the project's existing `npm run simtest` and `test/*.mjs` scripts
  test the *game*, not this site).
- If you later get access to an image-optimisation tool, consider
  re-encoding `SITE/assets/images/concept-art-battlefield.png` as a
  compressed WebP/AVIF copy (with the PNG kept as a `<picture>` fallback) —
  it is currently used unmodified at its original ~2.5 MB size because no
  such tool was available while this site was built (see
  `SITE/docs/source-map.md` §5 for details). Never re-encode or move the
  original `ConceptArt.png` at the repository root — always work from the
  copy already inside `SITE/assets/images/`.
