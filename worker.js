/**
 * Chrono Heist — Cloudflare Worker (ES module)
 *
 * A single Worker that:
 *   1. Serves the game itself as a static asset (public/index.html and
 *      anything else in /public), via the built-in ASSETS binding.
 *   2. Handles every /api/* route — leaderboard, map data, and the two
 *      generative-AI features — using KV, and a DUAL AI backend: the
 *      Grok API (xAI) as primary if configured, with Cloudflare Workers
 *      AI as an automatic fallback if Grok isn't set up or fails.
 *
 * This is the modern "Workers with Static Assets" pattern, which deploys
 * cleanly from a GitHub repo through the Cloudflare dashboard with no
 * local CLI required — see README.md for the full redeploy walkthrough.
 *
 * Required / optional bindings (names must match EXACTLY — set via the
 * dashboard or wrangler.toml, see README.md → "Reconnecting the AI-powered
 * backend features"):
 *   ASSETS           (Static Assets — configured via wrangler.toml)
 *   LEADERBOARD_KV   (KV namespace, required)
 *   MAP_KV           (KV namespace, required)
 *   AI               (Workers AI binding — optional, used as fallback
 *                      and/or sole backend if Grok isn't configured)
 *   XAI_API_KEY      (Secret — optional, your xAI/Grok API key. If set,
 *                      Grok is tried FIRST for both AI features)
 *   XAI_MODEL        (Variable — optional, defaults to "grok-4-fast" if
 *                      unset. Check https://docs.x.ai for current model
 *                      names if Grok requests start failing — xAI updates
 *                      these periodically)
 *   MAP_ADMIN_KEY    (Secret, required for seeding map data)
 *
 * If NEITHER XAI_API_KEY nor AI is configured, /api/ask and /api/quiz
 * return a clear error, and the client falls back to a friendly in-game
 * message (Archivist) or a static pre-written question (Field Quiz) — the
 * game never breaks without an AI backend, it just runs without that
 * feature until one is connected.
 *
 * ── Leaderboard ──────────────────────────────────────────────────────
 *   GET    /api/leaderboard   -> full leaderboard array
 *   POST   /api/leaderboard   -> body: {name, score, evidence[]} — upsert
 *   PUT    /api/leaderboard   -> body: {list:[...]} — overwrite (Teacher Tools)
 *   DELETE /api/leaderboard   -> clears the leaderboard
 *
 * ── Map data ─────────────────────────────────────────────────────────
 *   GET    /api/map           -> stored world-map TopoJSON, long-cached
 *   PUT    /api/map           -> body: raw TopoJSON. Requires header
 *                                "X-Admin-Key: <MAP_ADMIN_KEY>". Used once
 *                                via the in-app "Seed Map Data" admin panel
 *                                (Teacher Tools screen) — no terminal needed.
 *
 * ── Generative AI (Grok primary, Workers AI fallback) ────────────────
 *   POST   /api/ask           -> body: {civilization, era, legacy, modern,
 *                                question} — "Ask the Chrono Archivist",
 *                                answers grounded ONLY in the supplied case
 *                                history, refuses off-topic questions.
 *   POST   /api/quiz          -> body: {civilization, era, legacy, modern}
 *                                — generates 3 fresh multiple-choice
 *                                comprehension questions from that case's
 *                                history for active-recall practice.
 */

const LEADERBOARD_KEY = "leaderboard";
const MAP_KEY = "world-map-topology";
const WORKERS_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_XAI_MODEL = "grok-4-fast"; // override via the XAI_MODEL variable if xAI renames/retires this
const XAI_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: CORS_HEADERS });
      }
      try {
        if (url.pathname === "/api/leaderboard") return await handleLeaderboard(request, env);
        if (url.pathname === "/api/map") return await handleMap(request, env);
        if (url.pathname === "/api/ask") return await handleAsk(request, env);
        if (url.pathname === "/api/quiz") return await handleQuiz(request, env);
        if (url.pathname === "/api/ai-status") return await handleAiStatus(request, env);
        return new Response("Not found", { status: 404, headers: CORS_HEADERS });
      } catch (err) {
        return json({ error: err.message || "Server error" }, 500);
      }
    }

    // Everything else — index.html and any other static file — is served
    // straight from the /public directory via the ASSETS binding.
    return env.ASSETS.fetch(request);
  },
};

/* ---------------- Leaderboard ---------------- */

async function handleLeaderboard(request, env) {
  if (request.method === "GET") {
    return json(await getLeaderboardList(env));
  }

  if (request.method === "POST") {
    const entry = await request.json();
    if (!entry || typeof entry.name !== "string") {
      return json({ error: "Invalid entry" }, 400);
    }
    let list = await getLeaderboardList(env);
    const idx = list.findIndex((e) => e.name.toLowerCase() === entry.name.toLowerCase());
    if (idx >= 0) {
      if (list[idx].score <= entry.score) list[idx] = entry;
    } else {
      list.push(entry);
    }
    list.sort((a, b) => b.score - a.score);
    await env.LEADERBOARD_KV.put(LEADERBOARD_KEY, JSON.stringify(list));
    return json(list);
  }

  if (request.method === "PUT") {
    const body = await request.json();
    const list = Array.isArray(body.list) ? body.list : [];
    await env.LEADERBOARD_KV.put(LEADERBOARD_KEY, JSON.stringify(list));
    return json(list);
  }

  if (request.method === "DELETE") {
    await env.LEADERBOARD_KV.put(LEADERBOARD_KEY, JSON.stringify([]));
    return json([]);
  }

  return json({ error: "Method not allowed" }, 405);
}

async function getLeaderboardList(env) {
  const raw = await env.LEADERBOARD_KV.get(LEADERBOARD_KEY);
  return raw ? JSON.parse(raw) : [];
}

/* ---------------- Map data ---------------- */

async function handleMap(request, env) {
  if (request.method === "GET") {
    const raw = await env.MAP_KV.get(MAP_KEY);
    if (!raw) return json({ error: "Map data not seeded yet. Use the Teacher Tools admin panel." }, 404);
    return new Response(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=604800, immutable",
        ...CORS_HEADERS,
      },
    });
  }

  if (request.method === "PUT") {
    const adminKey = request.headers.get("X-Admin-Key");
    if (!env.MAP_ADMIN_KEY || adminKey !== env.MAP_ADMIN_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }
    const text = await request.text();
    try {
      JSON.parse(text);
    } catch (e) {
      return json({ error: "Body is not valid JSON" }, 400);
    }
    await env.MAP_KV.put(MAP_KEY, text);
    return json({ ok: true, bytes: text.length });
  }

  return json({ error: "Method not allowed" }, 405);
}

/* ---------------- Dual AI backend: Grok (primary) + Workers AI (fallback) --- */

// Calls the xAI (Grok) chat completions API. Throws on any failure.
async function callGrok(env, messages, maxTokens) {
  const model = env.XAI_MODEL || DEFAULT_XAI_MODEL;
  const res = await fetch(XAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.XAI_API_KEY,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Grok API HTTP ${res.status}${bodyText ? " — " + bodyText.slice(0, 200) : ""}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || !text.trim()) throw new Error("Grok API returned an empty response");
  return text.trim();
}

// Calls Cloudflare Workers AI. Throws on any failure.
async function callWorkersAI(env, messages, maxTokens) {
  const result = await env.AI.run(WORKERS_AI_MODEL, { messages, max_tokens: maxTokens });
  const text = (result && (result.response || result.result)) || "";
  if (!text.trim()) throw new Error("Workers AI returned an empty response");
  return text.trim();
}

// Tries Grok first (if XAI_API_KEY is set), then falls back to Workers AI
// (if the AI binding is set). Throws a combined error only if every
// configured backend failed, or nothing is configured at all.
async function generateText(env, messages, maxTokens) {
  const attempts = [];

  if (env.XAI_API_KEY) {
    try {
      return { text: await callGrok(env, messages, maxTokens), source: "grok" };
    } catch (err) {
      attempts.push("Grok: " + err.message);
    }
  }

  if (env.AI) {
    try {
      return { text: await callWorkersAI(env, messages, maxTokens), source: "workers-ai" };
    } catch (err) {
      attempts.push("Workers AI: " + err.message);
    }
  }

  if (attempts.length === 0) {
    throw new Error("No AI backend configured — set XAI_API_KEY and/or bind Workers AI as 'AI'.");
  }
  throw new Error("All configured AI backends failed — " + attempts.join(" | "));
}

// Simple diagnostics endpoint: tells you which backends are configured
// WITHOUT making a real API call, useful for checking bindings landed
// correctly after a redeploy.
async function handleAiStatus(request, env) {
  return json({
    grokConfigured: !!env.XAI_API_KEY,
    grokModel: env.XAI_MODEL || DEFAULT_XAI_MODEL,
    workersAiConfigured: !!env.AI,
  });
}

/* ---------------- Ask the Chrono Archivist ---------------- */

async function handleAsk(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid request body" }, 400);

  const civilization = clip(body.civilization, 120);
  const era = clip(body.era, 60);
  const legacy = clip(body.legacy, 2500);
  const modern = clip(body.modern, 1500);
  const question = clip(body.question, 300);

  if (!question) return json({ error: "Question is required" }, 400);

  const systemPrompt =
    `You are the Chrono Archivist, a friendly research-assistant character inside an educational ` +
    `history game for students called Chrono Heist. You may ONLY discuss ${civilization} during ${era}, ` +
    `using the verified background below as your source of truth. Do not discuss any other topic, ` +
    `civilization, era, or subject — including current events, other countries, personal advice, or ` +
    `anything unrelated to this specific case. If the student asks about something outside this scope, ` +
    `politely say you can only discuss this case and suggest they ask something about ${civilization} or ` +
    `${era} instead. Keep answers factual, encouraging, age-appropriate for middle and high school ` +
    `students, and under 110 words. If a detail isn't covered in the background and you're not confident ` +
    `about it, say so honestly rather than inventing facts. Never produce violent, unsafe, or inappropriate content.\n\n` +
    `VERIFIED BACKGROUND:\n${legacy}\n\n${modern}`;

  try {
    const { text } = await generateText(
      env,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      300
    );
    return json({ answer: text });
  } catch (err) {
    return json({ error: err.message || "AI request failed" }, 502);
  }
}

/* ---------------- Chrono Field Quiz ---------------- */

async function handleQuiz(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "Invalid request body" }, 400);

  const civilization = clip(body.civilization, 120);
  const era = clip(body.era, 60);
  const legacy = clip(body.legacy, 2500);
  const modern = clip(body.modern, 1500);

  const systemPrompt =
    `You write short comprehension quizzes for a middle/high-school history game. Using ONLY the ` +
    `background text below about ${civilization} during ${era}, write EXACTLY 3 multiple-choice questions ` +
    `that test understanding of the material (not obscure trivia). Respond with ONLY a raw JSON array — ` +
    `no prose, no markdown code fences, no explanation — matching exactly this shape:\n` +
    `[{"question":"...", "options":["...","...","...","..."], "correctIndex":0}, ...]\n` +
    `Each question must have exactly 4 options and correctIndex must be the 0-based index of the correct ` +
    `option. Keep questions and options concise and age-appropriate.\n\n` +
    `BACKGROUND:\n${legacy}\n\n${modern}`;

  try {
    const { text: raw } = await generateText(
      env,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate the quiz now." },
      ],
      700
    );
    const questions = parseQuizJson(raw);
    if (!questions) return json({ questions: [] }); // client falls back to its static question
    return json({ questions });
  } catch (err) {
    return json({ questions: [], error: err.message || "AI request failed" });
  }
}

function parseQuizJson(raw) {
  if (!raw) return null;
  // Strip markdown code fences if the model added them despite instructions.
  let text = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "");
  // Grab the first [...] block in case there's stray prose around it.
  const match = text.match(/\[[\s\S]*\]/);
  if (match) text = match[0];
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const valid = data.filter(
    (q) =>
      q &&
      typeof q.question === "string" &&
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      q.options.every((o) => typeof o === "string") &&
      Number.isInteger(q.correctIndex) &&
      q.correctIndex >= 0 &&
      q.correctIndex <= 3
  );
  return valid.length > 0 ? valid : null;
}

/* ---------------- Shared ---------------- */

function clip(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.slice(0, maxLen);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
