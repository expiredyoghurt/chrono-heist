/**
 * Chrono Heist — Cloudflare Pages Function
 *
 * A single catch-all function (functions/api/[[path]].js) handling every
 * /api/* route. Cloudflare Pages deploys this automatically — no build
 * step, no wrangler, no terminal. Bindings (KV namespaces, Workers AI,
 * the admin secret) are all added from the Pages dashboard under
 * Settings → Functions, entirely in the browser.
 *
 * Required bindings (set names EXACTLY like this in the dashboard):
 *   LEADERBOARD_KV   (KV namespace)
 *   MAP_KV           (KV namespace)
 *   AI               (Workers AI binding)
 *   MAP_ADMIN_KEY    (environment variable / secret — any string you choose)
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
 * ── Generative AI (Workers AI) ───────────────────────────────────────
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
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Key",
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    if (url.pathname === "/api/leaderboard") return await handleLeaderboard(request, env);
    if (url.pathname === "/api/map") return await handleMap(request, env);
    if (url.pathname === "/api/ask") return await handleAsk(request, env);
    if (url.pathname === "/api/quiz") return await handleQuiz(request, env);
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  } catch (err) {
    return json({ error: err.message || "Server error" }, 500);
  }
}

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

/* ---------------- Ask the Chrono Archivist (Workers AI) ---------------- */

async function handleAsk(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.AI) return json({ error: "Workers AI binding not configured" }, 500);

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
    const result = await env.AI.run(AI_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      max_tokens: 300,
    });
    const answer = (result && (result.response || result.result)) || "";
    if (!answer.trim()) return json({ error: "Empty response from model" }, 502);
    return json({ answer: answer.trim() });
  } catch (err) {
    return json({ error: "AI request failed: " + (err.message || "unknown error") }, 502);
  }
}

/* ---------------- Chrono Field Quiz (Workers AI) ---------------- */

async function handleQuiz(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.AI) return json({ error: "Workers AI binding not configured" }, 500);

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
    const result = await env.AI.run(AI_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Generate the quiz now." },
      ],
      max_tokens: 700,
    });
    const raw = (result && (result.response || result.result)) || "";
    const questions = parseQuizJson(raw);
    if (!questions) return json({ questions: [] }); // client falls back to its static question
    return json({ questions });
  } catch (err) {
    return json({ questions: [], error: "AI request failed: " + (err.message || "unknown error") });
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
