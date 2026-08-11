# Chrono Heist: The Anachronist Files

A branching, educational time-travel detective game across 10 civilizations,
with a leaderboard, a real-coastline situation map, and two generative-AI
features — all backed by Cloudflare Workers KV / Workers AI, deployable
**entirely from a browser** (see `DEPLOY-NO-TERMINAL.md`).

## Files
- `index.html` — the whole game (single file: HTML/CSS/JS). Open it directly
  in a browser to play right away — local storage covers saves/leaderboard,
  public CDNs cover the map, and the AI features simply go quiet with a
  friendly fallback until you deploy the backend below.
- `functions/api/[[path]].js` — **one Cloudflare Pages Function** handling
  every `/api/*` route (leaderboard, map data, and both AI features). Pages
  deploys this automatically from your GitHub repo — no build step, no CLI.
- `DEPLOY-NO-TERMINAL.md` — full step-by-step deployment guide using only
  github.com and the Cloudflare dashboard in a browser.

## Where generative AI fits, and why (only) these two features

I considered a few ways AI could sit inside a history game — an open-ended
chat with the antagonist, personalized debriefs, adaptive difficulty,
AI-narrated cutscenes — but most of those are either decorative (don't
actually change what a student learns) or risky to run unsupervised with
minors (open-ended roleplay with no fixed scope is hard to keep on-topic
and age-appropriate). I implemented the two that clear both bars:

1. **"Ask the Chrono Archivist"** (`/api/ask`) — after each case, students
   can ask a free-form follow-up question about that specific civilization.
   The model is given the case's own verified history text as its *only*
   source of truth and is instructed to refuse anything outside that scope.
   This is the actual pedagogical win: static content answers what the
   designer anticipated; this answers what the *student* is actually
   curious about, without turning into a general-purpose chatbot.

2. **AI-generated Field Quiz** (`/api/quiz`) — 3 multiple-choice questions
   generated fresh each playthrough from that case's history content, for
   active-recall practice (retrieval practice is one of the best-evidenced
   study techniques, and a fixed quiz bank can't offer fresh questions on
   replay). If the AI is unreachable or returns something malformed, it
   falls back to one pre-written question per case — the feature never
   blocks progress or breaks the game.

Both run on **Cloudflare Workers AI** (`@cf/meta/llama-3.1-8b-instruct`)
through the Pages Function, with the system prompt doing the scoping/safety
work (topic-locked to the case, word limit, explicit instruction to say
"I'm not sure" rather than invent facts, refusal of anything unrelated).

**Ideas I didn't implement**, for future consideration: an AI-narrated
"case briefing" read aloud (accessibility win, needs a TTS binding);
adaptive difficulty that adjusts decision-option wording based on a
student's running accuracy; a teacher-facing dashboard that summarizes
common wrong quiz answers per case. All are feasible on the same
Pages Function + Workers AI pattern if you want to extend this later.

## Notes for teachers
- Enter the agent name **Palpatine** on the landing page to trigger the
  authorization prompt (password: **Order-66**), which opens the Teacher
  Tools screen: edit/delete leaderboard entries, clear the board, and (once,
  during setup) seed the map data — all from buttons in the browser.
- Every case can be "won" or "lost" — losing never blocks progress and
  always still delivers the full history + modern-legacy content.
- The AI Field Quiz awards bonus points on top of the case's base score;
  it can only be taken once per case per playthrough.
