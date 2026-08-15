# Chrono Heist: The Anachronist Files

A branching, educational time-travel detective game across 10 civilizations,
with a leaderboard, a real-coastline situation map, and two generative-AI
features — all running from **one Cloudflare Worker** (ES module), deployable
from GitHub with no local terminal required.

## What's in this package

```
worker.js          ← the entire backend (ES module, single file)
wrangler.toml       ← tells Cloudflare how to build/deploy the Worker
public/
  index.html        ← the entire game (single file: HTML/CSS/JS)
README.md           ← this file
```

`worker.js` does two jobs from one `fetch()` handler:
1. Any request to `/api/*` is handled directly (leaderboard, map data, and
   the two AI features below).
2. Everything else falls through to `env.ASSETS.fetch(request)`, which
   serves `public/index.html` and any other static file.

You can still open `public/index.html` directly in a browser to play
offline-style — local storage covers saves/leaderboard, public CDNs cover
the map, and the AI features just show a friendly fallback until deployed.

## Generative AI features — now with two backends

1. **"Ask the Chrono Archivist"** (`/api/ask`) — after each case, students
   can ask a follow-up question about that specific civilization. The model
   is given the case's own verified history text as its *only* source of
   truth and is instructed to refuse anything outside that scope.
2. **AI-generated Field Quiz** (`/api/quiz`) — 3 multiple-choice questions
   generated fresh each playthrough from that case's content, for
   active-recall practice. Falls back to a pre-written question per case if
   no AI backend responds successfully, so the feature never blocks
   progress.

**Both features now try two backends, in order:**

1. **Grok (xAI)** — tried first, *only if* you've set an `XAI_API_KEY`.
   Uses the OpenAI-compatible `https://api.x.ai/v1/chat/completions`
   endpoint.
2. **Cloudflare Workers AI** (`@cf/meta/llama-3.1-8b-instruct`) — used
   automatically if Grok isn't configured, or if a Grok request fails for
   any reason (bad key, rate limit, outage, etc.).

You don't have to set up both — Workers AI alone is enough to run the
features, Grok alone is also enough, and having both gives you automatic
failover. If **neither** is configured, `/api/ask` and `/api/quiz` return a
clear error and the game degrades gracefully (Archivist shows a friendly
"can't reach it right now" message; Field Quiz uses its static fallback
question) rather than breaking anything.

A **diagnostics endpoint**, `/api/ai-status`, reports which backend(s) are
currently connected without making a real AI call — there's a button for
it right in the game's Teacher Tools screen (see Part 4 below), which is
the fastest way to check "is it actually connected" without opening
devtools.

---

## Redeploying via GitHub → Cloudflare (browser only)

### Part 1 — Push this package to GitHub

1. Go to **github.com**, log in, and create a **New repository** (any
   name, e.g. `chrono-heist`). Leave "Initialize with a README" unchecked.
2. On the empty repo page, click **uploading an existing file**, then drag
   in `worker.js`, `wrangler.toml`, and `README.md`. Click **Commit changes**.
3. `public/index.html` needs to sit inside a `public` folder. The most
   reliable way to get nested folders onto GitHub without git:
   - Click **Add file → Create new file**.
   - In the filename box, type the full path: `public/index.html` —
     GitHub creates the `public` folder automatically as you type the `/`.
   - Paste the entire contents of `index.html` into the editor box.
   - Click **Commit changes**.
   (Modern browsers can also drag a whole folder into the upload page and
   preserve its structure — try that first if you prefer; use the method
   above if it doesn't come through as a `public/` folder.)

Your repo root should now show `worker.js`, `wrangler.toml`, `README.md`,
and a `public` folder containing `index.html`.

### Part 2 — Create the two KV namespaces

1. In the Cloudflare dashboard (**dash.cloudflare.com**), go to
   **Storage & Databases → KV**.
2. **Create a namespace** named `chrono-leaderboard`.
3. **Create a namespace** named `chrono-map`.

(Display names don't need to match anything in the code — the *binding
names* you set in Part 4 are what matter.)

### Part 3 — Connect the Worker to your GitHub repo

1. Go to **Workers & Pages → Create**.
2. Choose the option to import/connect a **Git repository** (Cloudflare's
   Worker-from-Git flow — labeled "Import a repository" or "Connect to
   Git" depending on your dashboard version).
3. Authorize GitHub if prompted, then select your `chrono-heist` repo.
4. Cloudflare should detect `wrangler.toml` automatically and use it to
   configure the build (entry point `worker.js`, assets directory
   `./public`). Accept the defaults and click **Save and Deploy**.
5. Wait for the first deployment to finish — you'll get a URL like
   `https://chrono-heist.<your-subdomain>.workers.dev`.

### Part 4 — Reconnecting the AI-powered backend features

**Important:** this Worker deploys via Git (Wrangler-based CI), which means
`wrangler.toml` — not the dashboard — is the source of truth for *plain
bindings* on every deploy. Adding `LEADERBOARD_KV`, `MAP_KV`, or `AI` only
through the dashboard UI will appear to work until the next push or "Retry
deployment," at which point Wrangler resets bindings to whatever this file
declares and your dashboard-added ones vanish. **Secrets and plain
environment variables are different** — those persist independently and
are managed via the dashboard on purpose. Here's the full sequence:

1. In the Cloudflare dashboard, open each KV namespace you created in
   Part 2 and copy its **ID** (shown on the namespace's own page).
2. On GitHub, open `wrangler.toml` in your repo and click the ✏️ (edit)
   icon.
3. Replace `REPLACE_WITH_YOUR_LEADERBOARD_KV_ID` and
   `REPLACE_WITH_YOUR_MAP_KV_ID` with the two IDs from step 1. The `[ai]`
   binding needs no ID — leave it as-is.
4. Commit the change directly to your main branch. This triggers an
   automatic redeploy with the KV/AI bindings now baked into the build, so
   they persist across every future deploy.
5. Now set up the Secrets (these ARE safe to manage purely via dashboard).
   Go to your Worker → **Settings** → **Variables and Secrets** → **Add**:
   - **`MAP_ADMIN_KEY`** (type **Secret**) — any password-like string you
     make up. Required for the map-data seeding step in Part 5.
   - **`XAI_API_KEY`** (type **Secret**, *optional*) — your Grok API key
     from **console.x.ai** (or wherever xAI issues keys at the time you're
     reading this — check their current docs). Skip this entirely if you
     only want to use Workers AI; the game works fine without it.
   - **`XAI_MODEL`** (type **Text**, *optional*) — only needed if you want
     to override the default Grok model name (`grok-4-fast`, set in
     `worker.js`). xAI renames/retires models periodically — if Grok
     requests start failing with a "model not found" style error, check
     **docs.x.ai** for the current model name and set it here instead of
     editing code.
6. Confirm the deploy succeeded under the **Deployments** tab.
7. Open your deployed site, and in Teacher Tools (see Part 5 for how to
   get there) click **Check AI Backend Status** to confirm what's
   connected before moving on.

### Part 5 — Seed the map data (one click, in-app)

1. Open your deployed Worker URL.
2. Enter the agent name **Palpatine** → **Begin Assignment**.
3. Enter the password **Order-66** at the prompt.
4. On the Teacher Tools screen, scroll to **Admin: Seed Map Data**.
5. Enter the `MAP_ADMIN_KEY` value from Part 4, step 5, and click
   **Seed Map Data**. Wait for the success confirmation.
6. While you're here, scroll to **Admin: AI Backend Status** and click
   **Check AI Backend Status** to confirm Grok and/or Workers AI are live.

Reload the game and start a new run — the leaderboard, real-coastline map,
and both AI features should now be fully live on your own Cloudflare
account.

---

## Troubleshooting

**Start with the in-app checker:** Teacher Tools → **Check AI Backend
Status**. It tells you exactly which backend(s) the Worker can currently
see, without needing devtools.

The Archivist and Field Quiz also log the actual failure to the browser
console (F12 → Console tab) if a request goes through but fails — check
there for the real HTTP status and error text from the Worker.

- **AI status shows neither backend connected:** you haven't set
  `XAI_API_KEY` and/or the `[ai]` binding isn't in `wrangler.toml` (or a
  deploy hasn't run since you added it). See Part 4.
- **Grok shows "not configured" even though you set XAI_API_KEY:** double
  check it was added as a **Secret** (not accidentally left unset or typo'd
  in the variable name — it must be exactly `XAI_API_KEY`), and that a
  deploy has run since you added it.
- **Grok requests fail with a model-related error:** xAI may have renamed
  or retired the default model. Set the `XAI_MODEL` variable to a current
  model name from **docs.x.ai** (Part 4, step 5).
- **This appeared to work, then stopped:** almost always means a *plain
  binding* (KV or AI) was added only via the dashboard and got reset by a
  later Git-triggered deploy. Re-check `wrangler.toml` has real KV IDs and
  the `[ai]` block. Secrets like `XAI_API_KEY` and `MAP_ADMIN_KEY` don't
  have this problem.
- **Leaderboard doesn't persist:** confirm `LEADERBOARD_KV` and `MAP_KV`
  have real namespace IDs in `wrangler.toml` (not placeholder text), and
  that binding *names* are spelled exactly right (case-sensitive).
- **Map still shows the offline atlas view:** re-check the `MAP_ADMIN_KEY`
  value matches exactly between Settings → Variables and Secrets and what
  you typed into the in-app admin panel, then retry **Seed Map Data**.
- **A new commit to GitHub doesn't show up on the live site:** check the
  **Deployments** tab — Git-connected Workers redeploy automatically on
  push, but you can also trigger **Retry deployment** manually.
