function jsonResponse(data, status = 200, corsOrigin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
  });
}

function getCorsOrigin(env, requestOrigin) {
  const configured = env.CORS_ORIGIN || "*";
  if (configured === "*") return "*";
  if (!requestOrigin) return configured;
  return requestOrigin === configured ? configured : configured;
}

function utcDateString() {
  return new Date().toISOString().slice(0, 10);
}

function toNumber(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`Invalid numeric value for ${label}`);
  }
  return num;
}

function scoreCase(predCl, predCd, trueCl, trueCd) {
  const clRelErr = Math.abs(predCl - trueCl) / Math.max(Math.abs(trueCl), 1e-3);
  const cdRelErr = Math.abs(predCd - trueCd) / Math.max(Math.abs(trueCd), 1e-4);
  const err = clRelErr + cdRelErr;

  const points = Math.max(0, 100 - 50 * err);
  const isCorrect = clRelErr <= 0.03 && cdRelErr <= 0.05;

  return {
    points,
    err,
    clRelErr,
    cdRelErr,
    isCorrect,
  };
}

function isAuthorizedAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;

  const auth = request.headers.get("Authorization") || "";
  const expected = `Bearer ${token}`;
  return auth === expected;
}

async function getCasesForDate(db, date) {
  const result = await db
    .prepare(
      `SELECT case_id, airfoil, mach, reynolds, aoa, coordinates_json, cl, cd
       FROM daily_cases
       WHERE date = ?
       ORDER BY case_id ASC`
    )
    .bind(date)
    .all();

  return result.results || [];
}

function toPublicCases(rows) {
  return rows.map((row) => ({
    case_id: row.case_id,
    airfoil: row.airfoil,
    mach: row.mach,
    reynolds: row.reynolds,
    aoa: row.aoa,
    coordinates: JSON.parse(row.coordinates_json || "[]"),
  }));
}

async function getPublishedAt(db, date) {
  const row = await db
    .prepare(`SELECT published_at FROM challenge_publications WHERE date = ? LIMIT 1`)
    .bind(date)
    .first();
  return row ? row.published_at : null;
}

async function handleGetTodayCases(url, env, corsOrigin) {
  const date = url.searchParams.get("date") || utcDateString();
  const rows = await getCasesForDate(env.DB, date);

  if (rows.length === 0) {
    return jsonResponse(
      {
        date,
        cases: [],
        message: "No benchmark cases published for this date yet.",
      },
      404,
      corsOrigin
    );
  }

  const publishedAt = await getPublishedAt(env.DB, date);
  return jsonResponse({ date, published_at: publishedAt, cases: toPublicCases(rows) }, 200, corsOrigin);
}

async function handleGetLatestCases(env, corsOrigin) {
  let latest = await env.DB
    .prepare(`SELECT date, published_at FROM challenge_publications ORDER BY published_at DESC LIMIT 1`)
    .first();

  if (!latest || !latest.date) {
    latest = await env.DB
      .prepare(`SELECT date FROM daily_cases ORDER BY date DESC LIMIT 1`)
      .first();
  }

  if (!latest || !latest.date) {
    return jsonResponse(
      {
        cases: [],
        message: "No benchmark cases published yet.",
      },
      404,
      corsOrigin
    );
  }

  const date = latest.date;
  const rows = await getCasesForDate(env.DB, date);
  if (!rows.length) {
    return jsonResponse(
      {
        cases: [],
        message: "No benchmark cases published yet.",
      },
      404,
      corsOrigin
    );
  }

  return jsonResponse(
    {
      date,
      published_at: latest.published_at || null,
      cases: toPublicCases(rows),
    },
    200,
    corsOrigin
  );
}

async function handleSubmit(request, env, corsOrigin) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400, corsOrigin);
  }

  const date = body.date || utcDateString();
  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const groupName = (body.group || "").trim();
  const predictions = Array.isArray(body.predictions) ? body.predictions : [];

  if (!name) return jsonResponse({ error: "Name is required." }, 400, corsOrigin);
  if (!email) return jsonResponse({ error: "Email is required." }, 400, corsOrigin);
  if (!email.includes("@")) return jsonResponse({ error: "Email is invalid." }, 400, corsOrigin);

  const truthRows = await getCasesForDate(env.DB, date);
  if (truthRows.length === 0) {
    return jsonResponse({ error: "No benchmark cases for this date." }, 400, corsOrigin);
  }

  const truthById = new Map();
  for (const row of truthRows) {
    truthById.set(Number(row.case_id), row);
  }

  if (predictions.length !== truthRows.length) {
    return jsonResponse(
      { error: `Expected ${truthRows.length} predictions, got ${predictions.length}.` },
      400,
      corsOrigin
    );
  }

  let totalScore = 0;
  let totalError = 0;
  let correctCases = 0;
  const breakdown = [];

  for (const p of predictions) {
    const caseId = toNumber(p.case_id, "case_id");
    const truth = truthById.get(caseId);
    if (!truth) {
      return jsonResponse({ error: `Unknown case_id: ${caseId}` }, 400, corsOrigin);
    }

    const predCl = toNumber(p.cl, `cl for case ${caseId}`);
    const predCd = toNumber(p.cd, `cd for case ${caseId}`);
    const trueCl = Number(truth.cl);
    const trueCd = Number(truth.cd);

    const caseScore = scoreCase(predCl, predCd, trueCl, trueCd);
    totalScore += caseScore.points;
    totalError += caseScore.err;
    if (caseScore.isCorrect) correctCases += 1;

    breakdown.push({
      case_id: caseId,
      points: caseScore.points,
      cl_rel_error: caseScore.clRelErr,
      cd_rel_error: caseScore.cdRelErr,
      is_correct: caseScore.isCorrect,
    });
  }

  const nowIso = new Date().toISOString();

  try {
    await env.DB
      .prepare(
        `INSERT INTO submissions (
          date, name, email, group_name, score, total_error, correct_cases, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        date,
        name,
        email,
        groupName,
        totalScore,
        totalError,
        correctCases,
        JSON.stringify({ predictions, breakdown }),
        nowIso
      )
      .run();
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    if (message.includes("UNIQUE")) {
      return jsonResponse(
        { error: "A submission already exists for this email on this date." },
        409,
        corsOrigin
      );
    }
    return jsonResponse({ error: "Failed to save submission.", details: message }, 500, corsOrigin);
  }

  const rankResult = await env.DB
    .prepare(
      `SELECT COUNT(*) + 1 AS rank
       FROM submissions
       WHERE date = ?
         AND (
           score > ?
           OR (score = ? AND total_error < ?)
           OR (score = ? AND total_error = ? AND created_at < ?)
         )`
    )
    .bind(date, totalScore, totalScore, totalError, totalScore, totalError, nowIso)
    .first();

  return jsonResponse(
    {
      date,
      score: totalScore,
      total_error: totalError,
      correct_cases: correctCases,
      rank: rankResult ? rankResult.rank : null,
      breakdown,
      scoring_note: "Per-case points = max(0, 100 - 50*(CL_rel_err + CD_rel_err)).",
    },
    200,
    corsOrigin
  );
}

async function handleLeaderboard(url, env, corsOrigin) {
  const date = url.searchParams.get("date") || utcDateString();
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 20)));

  const rows = await env.DB
    .prepare(
      `SELECT name, group_name, score, total_error, correct_cases, created_at
       FROM submissions
       WHERE date = ?
       ORDER BY score DESC, total_error ASC, created_at ASC
       LIMIT ?`
    )
    .bind(date, limit)
    .all();

  return jsonResponse({ date, entries: rows.results || [] }, 200, corsOrigin);
}

async function handleAdminPublish(request, env, corsOrigin) {
  if (!isAuthorizedAdmin(request, env)) {
    return jsonResponse({ error: "Unauthorized." }, 401, corsOrigin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400, corsOrigin);
  }

  const date = (body.date || "").trim();
  const cases = Array.isArray(body.cases) ? body.cases : [];
  const resetSubmissions = Boolean(body.reset_submissions);
  if (!date) return jsonResponse({ error: "date is required." }, 400, corsOrigin);
  if (cases.length === 0) return jsonResponse({ error: "cases must be non-empty." }, 400, corsOrigin);

  const nowIso = new Date().toISOString();
  const statements = [];

  statements.push(
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS challenge_publications (
         date TEXT PRIMARY KEY,
         published_at TEXT NOT NULL
       )`
    )
  );

  statements.push(env.DB.prepare("DELETE FROM daily_cases WHERE date = ?").bind(date));
  if (resetSubmissions) {
    statements.push(env.DB.prepare("DELETE FROM submissions WHERE date = ?").bind(date));
  }

  for (const c of cases) {
    const caseId = toNumber(c.case_id, "case_id");
    const airfoil = String(c.airfoil || "").trim();
    if (!airfoil) return jsonResponse({ error: `airfoil missing for case ${caseId}` }, 400, corsOrigin);

    const mach = toNumber(c.mach, `mach for case ${caseId}`);
    const reynolds = toNumber(c.reynolds, `reynolds for case ${caseId}`);
    const aoa = toNumber(c.aoa, `aoa for case ${caseId}`);
    const cl = toNumber(c.cl, `cl for case ${caseId}`);
    const cd = toNumber(c.cd, `cd for case ${caseId}`);

    const coords = Array.isArray(c.coordinates) ? c.coordinates : [];
    const coordinatesJson = JSON.stringify(coords);

    statements.push(
      env.DB
        .prepare(
          `INSERT INTO daily_cases (date, case_id, airfoil, mach, reynolds, aoa, coordinates_json, cl, cd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(date, caseId, airfoil, mach, reynolds, aoa, coordinatesJson, cl, cd)
    );
  }

  statements.push(
    env.DB
      .prepare(
        `INSERT INTO challenge_publications (date, published_at)
         VALUES (?, ?)
         ON CONFLICT(date) DO UPDATE SET published_at = excluded.published_at`
      )
      .bind(date, nowIso)
  );

  await env.DB.batch(statements);

  return jsonResponse(
    {
      message: "Published benchmark cases.",
      date,
      published_at: nowIso,
      cases_published: cases.length,
      reset_submissions: resetSubmissions,
    },
    200,
    corsOrigin
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsOrigin = getCorsOrigin(env, request.headers.get("Origin"));

    if (request.method === "OPTIONS") {
      return jsonResponse({ ok: true }, 200, corsOrigin);
    }

    if (url.pathname === "/api/health") {
      return jsonResponse({ ok: true, date: utcDateString() }, 200, corsOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/cases/today") {
      return handleGetTodayCases(url, env, corsOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/cases/latest") {
      return handleGetLatestCases(env, corsOrigin);
    }

    if (request.method === "POST" && url.pathname === "/api/submissions") {
      return handleSubmit(request, env, corsOrigin);
    }

    if (request.method === "GET" && url.pathname === "/api/leaderboard") {
      return handleLeaderboard(url, env, corsOrigin);
    }

    if (request.method === "POST" && url.pathname === "/api/admin/publish") {
      return handleAdminPublish(request, env, corsOrigin);
    }

    return jsonResponse({ error: "Not found." }, 404, corsOrigin);
  },
};
