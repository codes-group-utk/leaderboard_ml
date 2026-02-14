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
  downloadInputsBtn: document.getElementById("download-inputs-btn"),
  predictionFile: document.getElementById("prediction-file"),
  downloadTemplateBtn: document.getElementById("download-template-btn"),
  fileStatus: document.getElementById("file-status"),
};

let currentDate = null;
let currentPublishedAt = null;
let currentCases = [];
let demoMode = false;

function setStatus(message, kind = "") {
  els.status.className = `status ${kind}`.trim();
  els.status.textContent = message;
}

function setFileStatus(message, kind = "") {
  els.fileStatus.className = `status ${kind}`.trim();
  els.fileStatus.textContent = message;
}

function setDateLabel() {
  if (!currentDate) {
    els.dateLabel.textContent = "-";
    return;
  }

  if (!currentPublishedAt) {
    els.dateLabel.textContent = currentDate;
    return;
  }

  const published = new Date(currentPublishedAt);
  const publishedText = Number.isNaN(published.getTime())
    ? currentPublishedAt
    : published.toLocaleString();
  els.dateLabel.textContent = `${currentDate} (published ${publishedText})`;
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
  currentPublishedAt = null;
  currentCases = buildDemoCases();
  setDateLabel();
  renderCases(currentCases);
  renderBoard([]);

  const reasonMsg = reason ? ` (${reason})` : "";
  setStatus(`Using local demo data${reasonMsg}.`, "error");
  els.result.className = "status";
  els.result.textContent = "Demo mode active: submissions are disabled until API is configured.";
  setFileStatus("No file loaded.");
}

function showWaitingForPublish(message = "No challenge has been published yet. Waiting for next push.") {
  demoMode = false;
  currentDate = null;
  currentPublishedAt = null;
  currentCases = [];
  setDateLabel();
  els.casesBody.innerHTML = "";
  renderBoard([]);
  setStatus(message, "error");
  els.result.className = "status";
  els.result.textContent = "Awaiting first published challenge.";
  setFileStatus("No file loaded.");
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
  setStatus("Loading latest published challenge...");
  const res = await fetch(`${apiBase}/cases/latest`);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || data.error || "Failed to load cases.");
  }

  currentDate = data.date;
  currentPublishedAt = data.published_at || null;
  currentCases = data.cases;
  setDateLabel();
  renderCases(currentCases);

  const publishNote = currentPublishedAt ? ` | published: ${new Date(currentPublishedAt).toLocaleString()}` : "";
  setStatus(`Loaded ${currentCases.length} cases from latest push (${currentDate})${publishNote}.`, "ok");
}

async function loadLeaderboard() {
  if (demoMode || !currentDate) {
    renderBoard([]);
    return;
  }

  const url = `${apiBase}/leaderboard?date=${encodeURIComponent(currentDate)}&limit=20`;
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

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(filename, rows) {
  const csvText = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadInputsCsv() {
  if (!currentCases.length) {
    setStatus("No cases loaded. Cannot download inputs yet.", "error");
    return;
  }

  const rows = [["date", "case_id", "airfoil", "mach", "reynolds", "aoa", "coordinates_json"]];

  for (const c of currentCases) {
    rows.push([
      currentDate || "",
      c.case_id,
      c.airfoil,
      c.mach,
      c.reynolds,
      c.aoa,
      JSON.stringify(c.coordinates || []),
    ]);
  }

  const dateTag = currentDate || todayIsoDate();
  downloadCsv(`benchmark_inputs_${dateTag}.csv`, rows);
}

function downloadTemplateCsv() {
  if (!currentCases.length) {
    setFileStatus("No cases loaded. Cannot generate template.", "error");
    return;
  }

  const rows = [["case_id", "cl", "cd"]];
  for (const c of currentCases) {
    rows.push([c.case_id, "", ""]);
  }

  const dateTag = currentDate || todayIsoDate();
  downloadCsv(`prediction_template_${dateTag}.csv`, rows);
}

function parseCsvLine(line) {
  const out = [];
  let token = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        token += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(token.trim());
      token = "";
      continue;
    }

    token += ch;
  }

  out.push(token.trim());
  return out;
}

function parsePredictionCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) {
    throw new Error("Uploaded CSV is empty.");
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const required = ["case_id", "cl", "cd"];
  for (const name of required) {
    if (!header.includes(name)) {
      throw new Error(`CSV must include header column: ${name}`);
    }
  }

  const idxCase = header.indexOf("case_id");
  const idxCl = header.indexOf("cl");
  const idxCd = header.indexOf("cd");

  const expectedCaseIds = new Set(currentCases.map((c) => Number(c.case_id)));
  const seenCaseIds = new Set();
  const parsed = [];

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const caseIdRaw = row[idxCase];
    const clRaw = row[idxCl];
    const cdRaw = row[idxCd];

    if (!caseIdRaw && !clRaw && !cdRaw) {
      continue;
    }

    const caseId = Number(caseIdRaw);
    const cl = Number(clRaw);
    const cd = Number(cdRaw);

    if (!Number.isInteger(caseId)) {
      throw new Error(`Row ${i + 1}: case_id must be an integer.`);
    }
    if (!Number.isFinite(cl)) {
      throw new Error(`Row ${i + 1}: cl must be numeric.`);
    }
    if (!Number.isFinite(cd)) {
      throw new Error(`Row ${i + 1}: cd must be numeric.`);
    }
    if (!expectedCaseIds.has(caseId)) {
      throw new Error(`Row ${i + 1}: unknown case_id ${caseId}.`);
    }
    if (seenCaseIds.has(caseId)) {
      throw new Error(`Row ${i + 1}: duplicate case_id ${caseId}.`);
    }

    seenCaseIds.add(caseId);
    parsed.push({ case_id: caseId, cl, cd });
  }

  if (parsed.length !== expectedCaseIds.size) {
    throw new Error(`CSV must have exactly ${expectedCaseIds.size} prediction rows (one per case_id).`);
  }

  return parsed;
}

function applyPredictionsToInputs(predictions) {
  const byCase = new Map(predictions.map((p) => [p.case_id, p]));
  const inputs = els.casesBody.querySelectorAll("input[data-case-id]");

  for (const input of inputs) {
    const caseId = Number(input.dataset.caseId);
    const key = input.dataset.key;
    const prediction = byCase.get(caseId);
    if (!prediction) {
      throw new Error(`Missing prediction for case_id ${caseId}.`);
    }
    input.value = prediction[key];
  }
}

async function handlePredictionFileChange(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) {
    setFileStatus("No file loaded.");
    return;
  }

  if (!currentCases.length) {
    setFileStatus("Cases are not loaded yet. Refresh and try again.", "error");
    event.target.value = "";
    return;
  }

  try {
    const text = await file.text();
    const predictions = parsePredictionCsv(text);
    applyPredictionsToInputs(predictions);
    setFileStatus(`Loaded ${predictions.length} predictions from ${file.name}.`, "ok");
  } catch (err) {
    setFileStatus(String(err.message || err), "error");
    event.target.value = "";
  }
}

async function submitPredictions(event) {
  event.preventDefault();
  els.submitBtn.disabled = true;

  try {
    if (demoMode) {
      throw new Error("Demo mode active. Connect API first to enable submissions.");
    }

    if (!currentCases.length || !currentDate) {
      throw new Error("No active challenge loaded.");
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
    setFileStatus("No file loaded.");
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.toLowerCase().includes("no benchmark cases published")) {
      showWaitingForPublish();
    } else {
      enableDemoMode(msg);
    }
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
    setFileStatus("No file loaded.");
    els.predictionFile.value = "";
  } catch (err) {
    const msg = String(err.message || err);
    if (msg.toLowerCase().includes("no benchmark cases published")) {
      showWaitingForPublish();
    } else {
      enableDemoMode(msg);
    }
  }
});

els.downloadInputsBtn.addEventListener("click", downloadInputsCsv);
els.downloadTemplateBtn.addEventListener("click", downloadTemplateCsv);
els.predictionFile.addEventListener("change", handlePredictionFileChange);

boot();
