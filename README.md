# My Internet — Personal Discovery Dashboard

One calm place to read the world on your own terms: a **chronological** feed from sources **you** choose, with discovery tools to push you gently outside your usual interests. No algorithm, no engagement ranking, no tracking, no ads.

- **Unified feed** from RSS / RSS 1.0 / Atom, newest first, grouped by day, with category tabs
- **Sources**: 48 suggested official feeds (world, science, economics, history, culture, technology, travel, Bangladesh) + add any website or feed, custom categories, pause/remove, per-source health, OPML import/export
- **Bookmarks, read/unread, search (incl. your notes), private notes**
- **Discover**: *Surprise me*, *Random country*, *Explore an unknown topic*, *Unfamiliar publication*, *Interesting website*, plus a Wikipedia topic lookup
- **Mobile-first**, dark mode, keyboard shortcut `/` for search
- **Free to host**: static files + 3 small Netlify Functions. Firebase is optional (sync only).

## How it works

```
Browser (plain HTML/CSS/ES modules, no build step)
   │  /api/feed/<base64url(feed URL)>   /api/wiki   /api/config
   ▼
Netlify Functions ── safe-fetch (SSRF guard, size/time/redirect caps)
   │                 parse-feed (RSS/RDF/Atom → one JSON shape, HTML stripped)
   ▼
Publisher's official feed · Wikipedia/Wikivoyage official APIs
```

- **No scraping.** The server only fetches the feed URL you give it (or Wikimedia's public APIs). Pasting a normal website only reads the `<link rel="alternate">` feed tags in its `<head>`. If a site has no feed, it can't be added.
- **Browser never sees raw HTML** from publishers: titles/summaries are converted to plain text and only `http(s)` links are kept.
- **Your data** (sources, bookmarks, notes, read state) lives in your browser's `localStorage`. With Firebase enabled it also syncs across devices (last-writer-wins per item, so two devices never overwrite each other's additions).
- **No mock content.** Every article shown is fetched live. (`tests/fixtures/` holds tiny fake feeds used *only* by automated tests and is never served by the app.)

## Run it locally

```bash
npm install
npm run dev:local          # http://localhost:8888 — no Netlify account needed
```

Optional settings: copy `.env.example` to `.env`, then `node --env-file=.env scripts/dev-server.mjs`.
To run exactly like production (Netlify's runtime) use `npm run dev` (uses `netlify-cli`).

## Deploy (free) — about 10 minutes

You do not need a command line for this.

1. **Put the project on GitHub.** Create a new repository, then *Add file → Upload files* and upload everything in this folder (keep the folder structure; do **not** upload `node_modules/` or `.env`).
2. **Create the Netlify site.** On [netlify.com](https://www.netlify.com) sign up (free) → *Add new site → Import an existing project* → pick the GitHub repo. Build settings are read from `netlify.toml`; leave "build command" empty and "publish directory" `public`. Click **Deploy**.
3. Open the site URL. The starter sources load automatically. Done — the app works fully with no environment variables.
4. *(Recommended)* **Politeness:** in Netlify → *Site configuration → Environment variables* add `CONTACT_URL` = your site's URL. It's added to the User-Agent so publishers can see who is fetching their feed.

Every time you commit a change to GitHub, Netlify redeploys automatically.

> **Why Git-based deploy?** The `/api/*` functions need their two small dependencies (`fast-xml-parser`, `jose`) installed and bundled. Netlify does that automatically when it builds from Git.

### Optional: Firebase sync (Google sign-in + Firestore)

Skip this if one browser is enough.

1. [console.firebase.google.com](https://console.firebase.google.com) → *Add project* (free Spark plan).
2. *Build → Authentication → Get started → Sign-in method → Google → Enable.*
3. *Authentication → Settings → Authorized domains* → add your Netlify domain (e.g. `my-internet.netlify.app`).
4. *Build → Firestore Database → Create database* (production mode, any region).
5. *Firestore → Rules* → paste the contents of `firestore.rules` → **Publish**. (Each signed-in user can only read/write `users/<their uid>/…`.)
6. *Project settings → General → Your apps → Web (`</>`)* → register an app → copy the config values.
7. In Netlify *Environment variables* add: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` (+ optionally `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`). Then *Deploys → Trigger deploy*.
8. Open the app → 👤 → **Sign in with Google**. Your local data is merged into your account, not overwritten.

### Optional: make your deployment private

Anyone who finds your URL can use your function quota. To lock it down (after Firebase works):

| Variable | Value |
|---|---|
| `REQUIRE_AUTH` | `true` |
| `ALLOWED_EMAILS` | `you@gmail.com` (comma-separate for more people) |

The API then requires a valid Firebase sign-in from an allowed, verified Google account. Verification uses Google's *public* signing keys, so no service-account secret exists anywhere.

## Environment variables

All optional. Set them in Netlify (*Site configuration → Environment variables*), or in a local `.env` (never commit it). See `.env.example`.

| Variable | Purpose |
|---|---|
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` | Enable sync. Firebase "web config" values identify your project and are **not secrets**; Firestore rules protect the data. All four are needed. |
| `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID` | Optional extras from the same config. |
| `REQUIRE_AUTH` | `true` = API requires sign-in. Default `false`. |
| `ALLOWED_EMAILS` | Comma-separated allow-list used with `REQUIRE_AUTH`. Never sent to the browser. |
| `CONTACT_URL` / `USER_AGENT` | Identify your reader to publishers. |

There are **no paid APIs and no secret keys** in this project.

## Testing

```bash
npm test            # 27 unit + API tests (parser, SSRF guard, caps, auth, merge logic, timeline, discovery)
npm run test:e2e    # real-browser test (needs Chromium; set CHROMIUM_PATH if not auto-found)
npm run check-feeds # checks every catalog feed with the production code path — run this on your machine
```

## Maintaining it

- **Feeds break sometimes** (publishers move or retire them). The Sources screen shows each feed's health and the Feed screen says how many failed; one broken feed never affects the rest. Every month or so run `npm run check-feeds`, then edit `public/data/catalog.json` (fix the URL or delete the entry) and commit.
- **Add suggested sources / categories / discovery topics**: all in `public/data/catalog.json` (`sources`, `sites`, `topics`). A new category needs an entry in `categories`; custom categories can also be created from the UI.
- **Dependencies**: `npm outdated` / `npm update` occasionally (only two runtime deps). The Firebase browser SDK version is pinned at the top of `public/js/sync.js` — bump it deliberately and test sign-in.
- **Back up**: *Sources → Export backup (JSON)* and *Export sources (OPML)*. OPML also lets you move to/from other readers.
- **Usage**: caching keeps function calls low (the CDN caches each feed ~10 minutes; the app re-fetches only stale feeds). Check your Netlify plan's current function limits in the dashboard if you add many sources or share the link.
- **Function timeout**: feeds get 9 s, matching Netlify's default 10 s function limit. A feed that regularly times out is shown as failing; remove it or find a lighter feed.
- **Be a good citizen**: use feeds for personal reading, keep `CONTACT_URL` set, and don't republish others' content. Wikipedia/Wikivoyage text shown in Discover is CC BY-SA 4.0 (attribution is shown in the app).

## Known limits

- Feed URLs in the catalog are from official publisher pages but were **not live-tested at build time** (the build environment had no open internet). Run `npm run check-feeds` after your first deploy.
- Some publishers only put headlines/summaries in their feeds, or paywall the articles themselves; the app links out to the original.
- Firebase sync was built against the documented SDK and its merge logic is unit-tested, but it has not been exercised against a live Firebase project here; follow the steps above and tell me if anything differs.
- If you first use the app signed-out and later sign in on a second device, starter sources you had deleted on the first device may reappear until you remove them again.
- Notes and bookmarks are limited by browser storage (~5 MB) and, when synced, Firestore's 1 MiB-per-document limit (the app warns before that).

## Project layout

```
public/                 static site (no build)
  index.html, css/app.css
  js/app.js             boot, routing, theme, account dialog
  js/state.js           local store + mergeable records (bookmarks, notes, reads, sources)
  js/timeline.js        merge, de-duplicate, sort chronologically, filter
  js/feeds.js           fetch all sources, health tracking, cache
  js/discover.js        discovery logic;  js/sync.js  optional Firebase
  js/views/             feed, saved, sources, discover, article card
  data/catalog.json     categories, suggested sources, interesting sites, topic seeds
  data/countries.json   UN member + observer states
netlify/functions/      thin entrypoints: feed, wiki, config
netlify/lib/            safe-fetch, parse-feed, handlers, optional auth
scripts/                dev-server, check-feeds, e2e
tests/                  unit/API tests + test-only fixtures
netlify.toml            deploy config + security headers (CSP)
firestore.rules         per-user data access rules
```
