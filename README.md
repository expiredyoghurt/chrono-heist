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

The Worker is live, but the leaderboard, map, and both AI features need
their bindings connected — done entirely via dashboard UI, no file
editing required:

1. Open your Worker in the dashboard → **Settings** → **Bindings**
   (sometimes shown as **Variables and Bindings**).
2. **Add binding** → **KV namespace**:
   - Variable name: `LEADERBOARD_KV` (must match exactly)
   - Namespace: `chrono-leaderboard`
3. **Add binding** → **KV namespace** again:
   - Variable name: `MAP_KV` (must match exactly)
   - Namespace: `chrono-map`
4. **Add binding** → **Workers AI**:
   - Variable name: `AI` (must match exactly)
5. **Add binding** → **Environment Variable** (or **Secret**):
   - Variable name: `MAP_ADMIN_KEY`
   - Value: any password-like string you make up — enable **Encrypt** if
     offered. You'll reuse this value once in Part 5.
6. Save, then go to **Deployments** and **Retry deployment** (or push any
   small commit to GitHub) so the new bindings take effect.

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

- **"The Archivist's connection is scrambled" / quiz always falls back to
  the static question:** confirm the Workers AI binding's variable name is
  exactly `AI` (Settings → Bindings), then retry the deployment.
- **Leaderboard doesn't persist:** confirm both KV binding variable names
  are exactly `LEADERBOARD_KV` and `MAP_KV` — bindings are case-sensitive
  and a typo here is the most common issue.
- **Map still shows the offline atlas view:** re-check the `MAP_ADMIN_KEY`
  value matches exactly between Settings → Bindings/Variables and what you
  typed into the in-app admin panel, then retry **Seed Map Data**.
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
