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
   serves `public/index.html` and any other static file — this is
   Cloudflare's current "Workers with Static Assets" pattern, the
   successor to the older separate Pages product, and it's what makes a
   single `worker.js` + `wrangler.toml` fully self-contained.

You can still open `public/index.html` directly in a browser to play
offline-style — local storage covers saves/leaderboard, public CDNs cover
the map, and the AI features just show a friendly fallback until deployed.

## Generative AI features (recap)

1. **"Ask the Chrono Archivist"** (`/api/ask`) — after each case, students
   can ask a follow-up question about that specific civilization. The model
   is given the case's own verified history text as its *only* source of
   truth and is instructed to refuse anything outside that scope.
2. **AI-generated Field Quiz** (`/api/quiz`) — 3 multiple-choice questions
   generated fresh each playthrough from that case's content, for
   active-recall practice. Falls back to a pre-written question per case if
   the AI is unreachable, so the feature never blocks progress.

Both run on **Cloudflare Workers AI** (`@cf/meta/llama-3.1-8b-instruct`).

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
`wrangler.toml` — not the dashboard — is the source of truth for bindings
on every deploy. Adding `LEADERBOARD_KV`, `MAP_KV`, or `AI` *only* through
the dashboard UI will appear to work until the next push or "Retry
deployment," at which point Wrangler resets bindings to whatever this file
declares and your dashboard-added ones vanish. That's the #1 cause of the
AI features or leaderboard going quiet after seeming to work. So:

1. In the Cloudflare dashboard, go to each KV namespace you created in
   Part 2 (`chrono-leaderboard`, `chrono-map`) and copy its **ID** (shown
   on the namespace's own page).
2. On GitHub, open `wrangler.toml` in your repo and click the ✏️ (edit)
   icon.
3. Replace `REPLACE_WITH_YOUR_LEADERBOARD_KV_ID` and
   `REPLACE_WITH_YOUR_MAP_KV_ID` with the two IDs from step 1. The `[ai]`
   binding needs no ID — leave it as-is.
4. Commit the change directly to your main branch. This triggers an
   automatic redeploy with the bindings now baked into the build, so they
   persist across every future deploy.
5. Separately, set the one binding that's *safe* to manage via dashboard
   alone: go to your Worker → **Settings** → **Variables and Secrets** →
   **Add** → type **Secret** → name it `MAP_ADMIN_KEY` → set any
   password-like value. Secrets are stored independently of `wrangler.toml`
   and do persist across Git-triggered redeploys, unlike plain bindings.
6. Confirm the deploy succeeded under the **Deployments** tab.

### Part 5 — Seed the map data (one click, in-app)

1. Open your deployed Worker URL.
2. Enter the agent name **Palpatine** → **Begin Assignment**.
3. Enter the password **Order-66** at the prompt.
4. On the Teacher Tools screen, scroll to **Admin: Seed Map Data**.
5. Enter the `MAP_ADMIN_KEY` value from Part 4, step 5, and click
   **Seed Map Data**. Wait for the success confirmation.

Reload the game and start a new run — the leaderboard, real-coastline map,
and both AI features should now be fully live on your own Cloudflare
account.

---

## Troubleshooting

The Archivist and Field Quiz now log the actual failure to the browser
console (F12 → Console tab) instead of only showing the generic in-game
"scrambled by the timestream" message — check there first; it'll show the
real HTTP status and error text from the Worker.

- **"The Archivist's connection is scrambled" / quiz always falls back to
  the static question:** open the browser console and look for a
  `Chrono Archivist` or `Chrono Field Quiz` error log.
  - `"Workers AI binding not configured"` → the `AI` binding isn't active.
    Check it's declared under `[ai]` in `wrangler.toml` (not only added via
    dashboard — see Part 4) and that the deploy succeeded afterward.
  - Any other error → likely a transient Workers AI issue; try again.
- **This appeared to work, then stopped:** almost always means a binding
  was added only via the dashboard and got reset by a later Git-triggered
  deploy. Re-check `wrangler.toml` has real KV IDs and the `[ai]` block —
  see Part 4.
- **Leaderboard doesn't persist:** same root cause — confirm
  `LEADERBOARD_KV` and `MAP_KV` have real namespace IDs in `wrangler.toml`
  (not placeholder text), and that binding *names* are spelled exactly
  right (case-sensitive).
- **Map still shows the offline atlas view:** re-check the `MAP_ADMIN_KEY`
  value matches exactly between Settings → Variables and Secrets and what
  you typed into the in-app admin panel, then retry **Seed Map Data**.
- **A new commit to GitHub doesn't show up on the live site:** check the
  **Deployments** tab in the Cloudflare dashboard — Git-connected Workers
  redeploy automatically on push, but you can also trigger **Retry
  deployment** manually.
- **Previously deployed this as a Cloudflare Pages project:** this package
  now uses the unified Worker-with-Assets pattern instead of Pages
  Functions. Rather than trying to convert an existing Pages project,
  create a fresh Worker project from this repo as described above — your
  existing KV namespaces (if any) can be reused, just re-bind them to the
  new Worker in Part 4.
