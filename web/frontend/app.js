const apiBase = (window.API_BASE_URL || "http://127.0.0.1:8787/api").replace(/\/$/, "");
const apiConfigured = !!apiBase && !apiBase.includes("YOUR-WORKER-SUBDOMAIN");

const els = {
  dateLabel: document.getElementById("date-label"),
  status: document.getElementById("status"),
  casesBody: document.getElementById("cases-body"),
  boardBody: document.getElementById("board-body"),
  form: document.getElementById("submission-form"),
  refreshBtn: document.getElementById("refresh-btn"),
  submitBtn: document.getElementById("submit-btn"),
  name: document.getElementById("name"),
  email: document.getElementById("email"),
  group: document.getElementById("group"),
  result: document.getElementById("result"),
};

let currentDate = null;
let currentCases = [];
let demoMode = false;

function setStatus(message, kind = "") {
  els.status.className = `status ${kind}`.trim();
  els.status.textContent = message;
}

function fmtNum(v, digits = 6) {
  return Number(v).toFixed(digits);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function buildDemoCases() {
  const coords = [
    [1.0, 0.002],
    [0.8, 0.05],
    [0.5, 0.09],
    [0.2, 0.06],
    [0.0, 0.0],
    [0.2, -0.04],
    [0.5, -0.06],
    [0.8, -0.03],
    [1.0, -0.001],
  ];

  return Array.from({ length: 10 }, (_, i) => ({
    case_id: i + 1,
    airfoil: `airfoil_${String(i + 1).padStart(3, "0")}`,
    mach: 0.1 + i * 0.05,
    reynolds: 1_000_000 + i * 800_000,
    aoa: -4 + i * 0.8,
    coordinates: coords,
  }));
}

function enableDemoMode(reason = "") {
  demoMode = true;
  currentDate = todayIsoDate();
  currentCases = buildDemoCases();
  els.dateLabel.textContent = currentDate;
  renderCases(currentCases);
  renderBoard([]);

  const reasonMsg = reason ? ` (${reason})` : "";
  setStatus(`Backend API is not connected. Showing local demo data${reasonMsg}.`, "error");
  els.result.className = "status";
  els.result.textContent = "Demo mode active: submissions are disabled until API is configured.";
}

function coordPreview(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return "[]";
  const slice = coords.slice(0, 6).map((pt) => `[${pt[0]}, ${pt[1]}]`);
  const suffix = coords.length > 6 ? ` ... (${coords.length} pts)` : "";
  return `${slice.join(", ")}${suffix}`;
}

function renderCases(cases) {
  els.casesBody.innerHTML = "";

  for (const c of cases) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.case_id}</td>
      <td class="code">${c.airfoil}</td>
      <td>${fmtNum(c.mach, 4)}</td>
      <td>${Math.round(c.reynolds).toLocaleString()}</td>
      <td>${fmtNum(c.aoa, 3)}</td>
      <td>
        <details>
          <summary>show coords</summary>
          <div class="coords code">${coordPreview(c.coordinates)}</div>
        </details>
      </td>
      <td>
        <div class="row" style="grid-template-columns:1fr 1fr; gap:6px;">
          <input type="number" step="any" data-case-id="${c.case_id}" data-key="cl" placeholder="CL" required />
          <input type="number" step="any" data-case-id="${c.case_id}" data-key="cd" placeholder="CD" required />
        </div>
      </td>
    `;
    els.casesBody.appendChild(tr);
  }
}

function renderBoard(entries) {
  els.boardBody.innerHTML = "";

  if (!entries.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6"><small>No submissions yet.</small></td>`;
    els.boardBody.appendChild(tr);
    return;
  }

  entries.forEach((e, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${e.name}</td>
      <td>${e.group_name || "-"}</td>
      <td>${fmtNum(e.score, 2)}</td>
      <td>${e.correct_cases}</td>
      <td><small>${new Date(e.created_at).toLocaleString()}</small></td>
    `;
    els.boardBody.appendChild(tr);
  });
}

async function loadCases() {
  setStatus("Loading today's benchmark cases...");
  const res = await fetch(`${apiBase}/cases/today`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to load cases.");
  }

  currentDate = data.date;
  currentCases = data.cases;
  els.dateLabel.textContent = currentDate;
  renderCases(currentCases);
  setStatus(`Loaded ${currentCases.length} cases for ${currentDate}.`, "ok");
}

async function loadLeaderboard() {
  if (demoMode) {
    renderBoard([]);
    return;
  }

  const url = currentDate
    ? `${apiBase}/leaderboard?date=${encodeURIComponent(currentDate)}&limit=20`
    : `${apiBase}/leaderboard?limit=20`;

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to load leaderboard.");
  }
  renderBoard(data.entries || []);
}

function collectPredictions() {
  const map = new Map();
  const inputs = els.casesBody.querySelectorAll("input[data-case-id]");

  for (const input of inputs) {
    const caseId = Number(input.dataset.caseId);
    const key = input.dataset.key;
    const value = input.value;

    if (!value) {
      throw new Error(`Missing ${key.toUpperCase()} for case ${caseId}.`);
    }

    if (!map.has(caseId)) {
      map.set(caseId, { case_id: caseId });
    }

    map.get(caseId)[key] = Number(value);
  }

  return Array.from(map.values()).sort((a, b) => a.case_id - b.case_id);
}

async function submitPredictions(event) {
  event.preventDefault();
  els.submitBtn.disabled = true;

  try {
    if (demoMode) {
      throw new Error("Demo mode active. Connect API first to enable submissions.");
    }

    if (!currentCases.length) {
      throw new Error("No active cases loaded.");
    }

    const payload = {
      date: currentDate,
      name: els.name.value.trim(),
      email: els.email.value.trim(),
      group: els.group.value.trim(),
      predictions: collectPredictions(),
    };

    const res = await fetch(`${apiBase}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Submission failed.");
    }

    els.result.className = "status ok";
    els.result.textContent = `Submitted. Score: ${fmtNum(data.score, 2)} | Correct cases: ${data.correct_cases}/10 | Rank: ${data.rank}`;

    await loadLeaderboard();
  } catch (err) {
    els.result.className = "status error";
    els.result.textContent = String(err.message || err);
  } finally {
    els.submitBtn.disabled = false;
  }
}

async function boot() {
  if (!apiConfigured) {
    enableDemoMode("set web/frontend/config.js with your API URL");
    return;
  }

  try {
    await loadCases();
    await loadLeaderboard();
  } catch (err) {
    enableDemoMode(String(err.message || err));
  }
}

els.form.addEventListener("submit", submitPredictions);
els.refreshBtn.addEventListener("click", async () => {
  if (!apiConfigured) {
    enableDemoMode("set web/frontend/config.js with your API URL");
    return;
  }

  try {
    await loadCases();
    await loadLeaderboard();
  } catch (err) {
    enableDemoMode(String(err.message || err));
  }
});

boot();
