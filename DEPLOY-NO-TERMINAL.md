# Deploying Chrono Heist — browser only, no terminal

Every step below happens on github.com or dash.cloudflare.com in a normal
browser tab. Nothing here needs git, npm, wrangler, or a command line.

You'll need: a free GitHub account, a free Cloudflare account, and the
three items from this package — `index.html`, `functions/api/[[path]].js`,
and (optional but recommended) this guide and the README.

---

## Part 1 — Put the code on GitHub

1. Go to **github.com**, log in, and click the **+** icon (top right) →
   **New repository**.
2. Name it something like `chrono-heist`, set it to **Public** or
   **Private** (either works), leave "Initialize with a README" **unchecked**,
   and click **Create repository**.
3. On the new empty repo page, click **uploading an existing file**.
4. Drag `index.html` into the upload box, wait for it to finish uploading,
   then scroll down and click **Commit changes**.
5. Now add the Function file, which needs to live at the exact path
   `functions/api/[[path]].js`. GitHub's drag-and-drop upload doesn't
   reliably preserve folder structure from a single file, so create it
   directly instead:
   - Click **Add file** → **Create new file** (top right of the repo's
     file list).
   - In the **"Name your file..."** box, type the full path:
     `functions/api/[[path]].js` — GitHub will automatically create the
     `functions` and `api` folders for you as you type the `/`.
   - Open `functions/api/[[path]].js` from this package in a text editor
     (or just re-open it here), copy its entire contents, and paste them
     into GitHub's editor box.
   - Scroll down and click **Commit changes**.
6. (Optional) Repeat step 5's "Create new file" method to add `README.md`
   and this guide too, for reference — they don't affect deployment.

Your repo should now show two items at the root: `index.html` and a
`functions` folder containing `api/[[path]].js`.

---

## Part 2 — Create the two KV namespaces

1. Go to **dash.cloudflare.com** and log in.
2. In the left sidebar, find **Storage & Databases → KV**.
3. Click **Create a namespace**. Name it `chrono-leaderboard` (the display
   name doesn't have to match anything in the code) and click **Add**.
4. Click **Create a namespace** again, name this second one `chrono-map`,
   and click **Add**.

You now have two empty KV namespaces. You'll connect them to your site in
Part 4 — the *binding names* you use there (`LEADERBOARD_KV` and `MAP_KV`)
matter much more than these display names.

---

## Part 3 — Create the Pages project from your GitHub repo

1. In the Cloudflare dashboard sidebar, go to **Workers & Pages**.
2. Click **Create**, then choose the **Pages** tab, then **Connect to Git**.
3. Authorize Cloudflare to access your GitHub account if prompted, then
   select the `chrono-heist` repository.
4. On the build settings screen:
   - **Framework preset:** None
   - **Build command:** leave blank
   - **Build output directory:** `/`
5. Click **Save and Deploy**. Cloudflare will build and deploy the site —
   this takes under a minute. You'll get a URL like
   `https://chrono-heist-xyz.pages.dev`.

At this point the site is live and playable, but the leaderboard, map, and
AI features aren't connected yet — that's Part 4.

---

## Part 4 — Connect KV, Workers AI, and the admin secret

1. From your new Pages project's page, click the **Settings** tab, then
   **Functions** in the left-hand sub-menu.
2. Find **KV namespace bindings** → click **Add binding**.
   - Variable name: `LEADERBOARD_KV` (must match exactly)
   - KV namespace: select `chrono-leaderboard`
   - Click **Save**.
3. Click **Add binding** again:
   - Variable name: `MAP_KV` (must match exactly)
   - KV namespace: select `chrono-map`
   - Click **Save**.
4. Find **Workers AI bindings** (same Functions settings page) → click
   **Add binding**.
   - Variable name: `AI` (must match exactly)
   - Click **Save**.
5. Go to **Settings → Environment variables** (or **Variables and Secrets**,
   naming varies slightly by dashboard version).
   - Click **Add variable**.
   - Name: `MAP_ADMIN_KEY`
   - Value: make up any password-like string (you'll type this once more
     in Part 5) — click the **Encrypt** option if offered, so it's stored
     as a secret.
   - Click **Save**.
6. Go to the **Deployments** tab, find the latest deployment, click the
   **⋯** menu next to it, and choose **Retry deployment** (this ensures
   the new bindings are picked up). Wait for it to finish.

---

## Part 5 — Seed the map data (one click, in-app)

The situation map needs one dataset loaded into `MAP_KV` before it'll draw
real coastlines from your own site instead of a public fallback CDN. This
is done from inside the game itself:

1. Open your `*.pages.dev` URL.
2. On the landing page, type the agent name **Palpatine** and click
   **Begin Assignment**.
3. When the authorization prompt appears, enter the password **Order-66**.
4. On the Teacher Tools screen, scroll to **Admin: Seed Map Data**.
5. Enter the `MAP_ADMIN_KEY` value you chose in Part 4, step 5.
6. Click **Seed Map Data** and wait a few seconds — it'll confirm success
   once the coastline data is stored.

That's it. Reload the game, start a new run, and the leaderboard, map, and
both AI features (Ask the Chrono Archivist, the Field Quiz) should all be
live and running off your own Cloudflare account.

---

## Troubleshooting (still no terminal needed)

- **"The Archivist's connection is scrambled" / quiz always uses the
  fallback question:** double-check the Workers AI binding's variable name
  is exactly `AI` (Settings → Functions → Workers AI bindings), then retry
  the deployment.
- **Leaderboard doesn't save across visits:** check both KV binding
  variable names are exactly `LEADERBOARD_KV` and `MAP_KV` — a typo here is
  the most common issue, and bindings are case-sensitive.
- **Map still shows the offline atlas view:** re-check the `MAP_ADMIN_KEY`
  value matches exactly between Settings → Environment variables and what
  you typed into the in-app admin panel, then try **Seed Map Data** again.
- **Changes to `index.html` don't show up:** any new commit to the GitHub
  repo triggers an automatic redeploy (Pages watches the repo) — check the
  **Deployments** tab to confirm it ran, or click **Retry deployment**.
