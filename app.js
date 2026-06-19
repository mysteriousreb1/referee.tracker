/* =====================================================
   REFEREE TRACKER — INTERFACE GITHUB PAGES
   Connectée à Google Apps Script via JSONP.
   ===================================================== */

const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec";
const API_KEY = "REFEREE_TRACKER_2026_PRIVATE";

const PAYMENT_STATUSES = ["À recevoir", "Reçu", "Écart à vérifier", "À vérifier"];

let state = {
  allRows: [],
  filteredRows: [],
  activeTab: "matchs",
  selectedSeason: "",
  search: ""
};

document.addEventListener("DOMContentLoaded", () => {
  bindUi();
  buildSeasonSelect();
  loadData();
});

function bindUi() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      setActiveTab(btn.dataset.tab);
    });
  });

  document.getElementById("refreshBtn").addEventListener("click", loadData);

  document.getElementById("seasonSelect").addEventListener("change", e => {
    state.selectedSeason = e.target.value;
    renderAll();
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    state.search = e.target.value.trim().toLowerCase();
    renderAll();
  });
}

function buildSeasonSelect() {
  const select = document.getElementById("seasonSelect");
  select.innerHTML = "";

  const options = ["Toutes les saisons", ...getSeasonsFrom2022ToCurrent()];
  options.forEach(season => {
    const opt = document.createElement("option");
    opt.value = season;
    opt.textContent = season;
    select.appendChild(opt);
  });

  const current = getCurrentSeason();
  state.selectedSeason = current;
  select.value = current;
}

function getCurrentSeason() {
  const now = new Date();
  const switchDate = new Date(now.getFullYear(), 6, 30); // 30 juillet
  const startYear = now >= switchDate ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}/${startYear + 1}`;
}

function getSeasonsFrom2022ToCurrent() {
  const current = getCurrentSeason();
  const currentStartYear = Number(current.split("/")[0]);
  const seasons = [];

  for (let y = 2022; y <= currentStartYear; y++) {
    seasons.push(`${y}/${y + 1}`);
  }

  return seasons;
}

function setActiveTab(tab) {
  state.activeTab = tab;

  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  document.querySelectorAll(".panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === tab);
  });

  renderAll();
}

function loadData() {
  setStatus("Chargement des données...", "");

  jsonp("matchs")
    .then(res => {
      if (!res.success) throw new Error(res.error || "Erreur API");
      state.allRows = normalizeRows(res.data || []);
      setStatus(`Données chargées : ${state.allRows.length} ligne(s)`, "ok");
      renderAll();
    })
    .catch(err => {
      setStatus("Impossible de contacter l’API Apps Script : " + err.message, "error");
    });
}

function jsonp(action, extra = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = "rt_cb_" + Date.now() + "_" + Math.random().toString(36).slice(2);

    const params = new URLSearchParams({
      key: API_KEY,
      action,
      callback: callbackName,
      ...extra
    });

    const script = document.createElement("script");
    script.src = `${APP_SCRIPT_URL}?${params.toString()}`;
    script.async = true;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout API"));
    }, 20000);

    window[callbackName] = data => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Script bloqué ou URL invalide"));
    };

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    document.body.appendChild(script);
  });
}

function normalizeRows(rows) {
  return rows.map(row => {
    const r = { ...row };

    r._date = parseFrDate(get(r, "Date match"));
    r._amount = toNumber(get(r, "Indemnité totale"));
    r._km = toNumber(get(r, "Km A/R stats"));
    r._format = get(r, "Format");
    r._season = normalizeSeason(get(r, "Saison"), r._date);
    r._isActive = !["annulé", "annule", "alerte"].includes(cleanText(get(r, "Statut")).toLowerCase()) && r._format !== "Alerte";

    return r;
  });
}

function normalizeSeason(value, date) {
  if (value && value.includes("/")) return value;

  if (value && value.includes("-")) {
    const parts = value.split("-");
    if (parts.length === 2) return `${parts[0]}/${parts[1]}`;
  }

  if (date) {
    const switchDate = new Date(date.getFullYear(), 6, 30);
    const startYear = date >= switchDate ? date.getFullYear() : date.getFullYear() - 1;
    return `${startYear}/${startYear + 1}`;
  }

  return "";
}

function renderAll() {
  state.filteredRows = filterRows(state.allRows);
  renderMatchs();
  renderPaiements();
  renderStats();
  renderAlertes();
  renderExport();
}

function filterRows(rows) {
  const selectedSeason = state.selectedSeason;
  const search = state.search;

  return rows.filter(row => {
    const seasonOk = selectedSeason === "Toutes les saisons" || row._season === selectedSeason;

    if (!seasonOk) return false;

    if (!search) return true;

    const searchable = [
      "Recevant",
      "Visiteur / événement",
      "Salle",
      "Adresse",
      "Ville",
      "Collègue nom",
      "Libellé compétition",
      "Niveau administratif",
      "Code compétition"
    ].map(k => get(row, k)).join(" ").toLowerCase();

    return searchable.includes(search);
  });
}

/* ---------------- Matchs ---------------- */

function renderMatchs() {
  const root = document.getElementById("matchs");
  const rows = state.filteredRows
    .filter(r => r._format !== "Alerte")
    .sort(sortByDateAsc);

  if (!rows.length) {
    root.innerHTML = empty("Aucun match ou tournoi pour cette saison.");
    return;
  }

  root.innerHTML = `
    <h2 class="section-title">Matchs & missions</h2>
    <div class="cards">
      ${rows.map(renderMatchCard).join("")}
    </div>
  `;

  attachCardListeners(root);
  attachPaymentListeners(root);
}

function renderMatchCard(row) {
  const uid = escapeHtml(get(row, "UID"));
  const format = get(row, "Format");
  const title = format === "3x3"
    ? firstValue(row, ["Visiteur / événement", "Recevant", "Libellé compétition"])
    : firstValue(row, ["Recevant", "Visiteur / événement", "Libellé compétition"]);

  const date = formatDateShort(row._date);
  const time = get(row, "Heure/RDV");
  const level = get(row, "Niveau administratif") || format;
  const warning = hasWarning(row);
  const paiement = get(row, "Statut paiement") || "À recevoir";
  const isPaid = paiement === "Reçu";

  return `
    <article class="match-card" data-uid="${uid}">
      <div class="card-head" role="button" tabindex="0">
        <div>
          <div class="badges">
            ${badge(format || "Mission", format === "3x3" ? "red" : "gray")}
            ${badge(level, "gray")}
            ${warning ? badge("À vérifier", "orange") : ""}
            ${isPaid ? badge("Payé", "green") : badge(paiement, paiement === "À recevoir" ? "gray" : "orange")}
          </div>
          <h3 class="card-title">${escapeHtml(title || "Mission")}</h3>
          <p class="card-sub">${escapeHtml(get(row, "Visiteur / événement") || get(row, "Libellé compétition") || "")}</p>
        </div>
        <div class="date-pill">
          <strong>${escapeHtml(date)}</strong>
          <span>${escapeHtml(time)}</span>
        </div>
      </div>

      <div class="card-body">
        ${renderDetails(row)}
        ${renderActions(row)}
        ${renderPaymentControl(row)}
      </div>
    </article>
  `;
}

function renderDetails(row) {
  const details = [
    ["Format", get(row, "Format")],
    ["Saison", row._season],
    ["Mon rôle", get(row, "Mon rôle")],
    ["Compétition", get(row, "Libellé compétition")],
    ["N° rencontre", get(row, "N° rencontre")],
    ["Recevant", get(row, "Recevant")],
    ["Visiteur / événement", get(row, "Visiteur / événement")],
    ["Salle", get(row, "Salle")],
    ["Adresse", get(row, "Adresse")],
    ["Ville", get(row, "Ville")],
    ["Code e-Marque", get(row, "Code e-Marque")],
    ["Collègue", formatColleague(row)],
    ["Référent 3x3", get(row, "Référent 3x3")],
    ["Observateur", get(row, "Observateur")],
    ["KM A/R", formatNumber(row._km, " km")],
    ["Indemnité", formatMoney(row._amount)],
    ["Paiement prévu", get(row, "Date paiement")],
    ["Warnings", [get(row, "Warning général"), get(row, "Warning finance"), get(row, "Warning FBI")].filter(Boolean).join(" | ")]
  ].filter(([, value]) => value !== "" && value !== null && value !== undefined);

  return `
    <div class="detail-grid">
      ${details.map(([label, value]) => `
        <div class="detail">
          <label>${escapeHtml(label)}</label>
          <span>${escapeHtml(String(value))}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderActions(row) {
  const address = get(row, "Adresse");
  const phone = onlyDigits(get(row, "Collègue téléphone"));
  const fbiWarning = get(row, "Warning FBI") || get(row, "Warning général");

  const links = [];

  if (address) {
    links.push(`<a class="action-link" href="${wazeUrl(address)}" target="_blank" rel="noopener">Waze</a>`);
  }

  if (phone) {
    links.push(`<a class="action-link secondary" href="sms:${phone}">SMS collègue</a>`);
  }

  if (fbiWarning || get(row, "N° rencontre")) {
    links.push(`<a class="action-link secondary" href="https://extranet.ffbb.com/fbi/connexion.fbi" target="_blank" rel="noopener">FBI</a>`);
  }

  if (!links.length) return "";
  return `<div class="actions">${links.join("")}</div>`;
}

function renderPaymentControl(row) {
  const uid = escapeHtml(get(row, "UID"));
  const current = get(row, "Statut paiement") || "À recevoir";

  return `
    <div class="payment-row">
      <div>
        <strong>Statut paiement</strong>
        <div class="card-sub">${escapeHtml(get(row, "Date paiement") ? "Prévu : " + get(row, "Date paiement") : "Date à vérifier")}</div>
      </div>
      <select class="payment-select" data-uid="${uid}">
        ${PAYMENT_STATUSES.map(s => `<option value="${escapeHtml(s)}" ${s === current ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
      </select>
    </div>
  `;
}

function attachCardListeners(root) {
  root.querySelectorAll(".card-head").forEach(head => {
    head.addEventListener("click", () => head.closest(".match-card").classList.toggle("open"));
    head.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        head.closest(".match-card").classList.toggle("open");
      }
    });
  });
}

/* ---------------- Paiements ---------------- */

function renderPaiements() {
  const root = document.getElementById("paiements");
  const rows = state.filteredRows
    .filter(r => r._format !== "Alerte")
    .sort(sortByPaymentThenDate);

  if (!rows.length) {
    root.innerHTML = empty("Aucun paiement pour cette saison.");
    return;
  }

  const grouped = groupBy(rows, r => get(r, "Statut paiement") || "À recevoir");
  const order = ["À recevoir", "Écart à vérifier", "À vérifier", "Reçu"];

  root.innerHTML = `
    <h2 class="section-title">Paiements</h2>
    ${order.filter(k => grouped[k]).map(status => `
      <h3 class="section-title">${escapeHtml(status)} — ${grouped[status].length}</h3>
      <div class="cards">${grouped[status].map(renderMatchCard).join("")}</div>
    `).join("")}
  `;

  attachCardListeners(root);
  attachPaymentListeners(root);
}

function attachPaymentListeners(root) {
  root.querySelectorAll(".payment-select").forEach(select => {
    select.addEventListener("change", async e => {
      const uid = e.target.dataset.uid;
      const status = e.target.value;

      e.target.disabled = true;
      setStatus("Mise à jour du paiement...", "");

      try {
        const res = await jsonp("updatePaymentStatus", { uid, status });

        if (!res.success) throw new Error(res.error || "Erreur update");

        const row = state.allRows.find(r => get(r, "UID") === uid);
        if (row) {
          row["Statut paiement"] = status;
          if (status === "Reçu") {
            row["Date réception"] = new Date().toLocaleDateString("fr-FR");
            if (!get(row, "Montant reçu")) row["Montant reçu"] = get(row, "Indemnité totale");
          }
          if (status === "À recevoir") {
            row["Date réception"] = "";
            row["Montant reçu"] = "";
          }
        }

        setStatus("Paiement mis à jour", "ok");
        renderAll();
      } catch (err) {
        setStatus("Erreur paiement : " + err.message, "error");
      } finally {
        e.target.disabled = false;
      }
    });
  });
}

/* ---------------- Stats ---------------- */

function renderStats() {
  const root = document.getElementById("stats");
  const rows = state.filteredRows.filter(r => r._format !== "Alerte" && r._isActive);
  const rowsComplete = rows.filter(r => r._amount || r._km);

  const five = rows.filter(r => r._format === "5x5");
  const three = rows.filter(r => r._format === "3x3");

  const totalAmount = sum(rowsComplete, "_amount");
  const totalKm = sum(rowsComplete, "_km");

  const stats = [
    ["Total indemnités", formatMoney(totalAmount)],
    ["Total KM", formatNumber(totalKm, " km")],
    ["Total matchs arbitrés 5x5", five.length],
    ["Total tournois 3x3 arbitrés", three.length],
    ["Moy. indemnité / match 5x5", formatMoney(avg(five, "_amount"))],
    ["Moy. KM / match 5x5", formatNumber(avg(five, "_km"), " km")],
    ["Moy. indemnité / mission 3x3", formatMoney(avg(three, "_amount"))],
    ["Moy. KM / mission 3x3", formatNumber(avg(three, "_km"), " km")]
  ];

  const records = buildRecords(rows);
  const weekendRows = aggregateByPeriod(rows, getWeekendKey);
  const monthRows = aggregateByPeriod(rows, getMonthKey);
  const seasonRows = aggregateByPeriod(rows, r => r._season || "Sans saison");

  root.innerHTML = `
    <h2 class="section-title">Statistiques — ${escapeHtml(state.selectedSeason)}</h2>
    <div class="kpi-grid">
      ${stats.map(([label, value]) => renderKpi(label, value)).join("")}
    </div>

    <h2 class="section-title">Records</h2>
    <div class="kpi-grid">
      ${records.map(([label, value]) => renderKpi(label, value)).join("")}
    </div>

    ${renderTopSection("Top 5 clubs", topN(rows, r => get(r, "Recevant"), 5))}
    ${renderTopSection("Top 5 salles", topN(rows, r => get(r, "Salle"), 5))}
    ${renderTopSection("Top 5 collègues", topN(rows.filter(r => r._format === "5x5"), r => get(r, "Collègue nom"), 5))}

    ${renderAggregationTable("Indemnités et KM / week-end", weekendRows)}
    ${renderAggregationTable("Indemnités et KM / mois", monthRows)}
    ${renderAggregationTable("Indemnités et KM / saison", seasonRows)}
  `;
}

function buildRecords(rows) {
  const maxKm = maxBy(rows, r => r._km);
  const maxAmount = maxBy(rows, r => r._amount);
  const busiestMonth = topN(rows, getMonthKey, 1)[0];
  const busiestWeekend = topN(rows, getWeekendKey, 1)[0];

  return [
    ["Salle la + fréquentée", topLabel(rows, r => get(r, "Salle"))],
    ["Ville la + fréquentée", topLabel(rows, r => get(r, "Ville"))],
    ["Club recevant le + arbitré", topLabel(rows, r => get(r, "Recevant"))],
    ["Niveau le + arbitré", topLabel(rows, r => get(r, "Niveau administratif"))],
    ["Collègue le + fréquent", topLabel(rows.filter(r => r._format === "5x5"), r => get(r, "Collègue nom"))],
    ["+ gros déplacement", maxKm ? `${formatNumber(maxKm._km, " km")} — ${firstValue(maxKm, ["Recevant", "Visiteur / événement"])}` : ""],
    ["+ grosse indemnité", maxAmount ? `${formatMoney(maxAmount._amount)} — ${firstValue(maxAmount, ["Recevant", "Visiteur / événement"])}` : ""],
    ["Mois le + chargé", busiestMonth ? `${busiestMonth.label} — ${busiestMonth.count}` : ""],
    ["Week-end le + chargé", busiestWeekend ? `${busiestWeekend.label} — ${busiestWeekend.count}` : ""]
  ];
}

function renderKpi(label, value) {
  return `<div class="kpi"><label>${escapeHtml(label)}</label><strong>${escapeHtml(String(value || "—"))}</strong></div>`;
}

function renderTopSection(title, rows) {
  if (!rows.length) return "";
  return `
    <h2 class="section-title">${escapeHtml(title)}</h2>
    <div class="table-card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nom</th><th class="num">Nombre</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.count}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAggregationTable(title, rows) {
  if (!rows.length) return "";
  return `
    <h2 class="section-title">${escapeHtml(title)}</h2>
    <div class="table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Période</th>
              <th class="num">Missions</th>
              <th class="num">Indemnités</th>
              <th class="num">KM</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${escapeHtml(r.label)}</td>
                <td class="num">${r.count}</td>
                <td class="num">${formatMoney(r.amount)}</td>
                <td class="num">${formatNumber(r.km, " km")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------- Alertes ---------------- */

function renderAlertes() {
  const root = document.getElementById("alertes");

  const rows = state.filteredRows.filter(r =>
    r._format === "Alerte" ||
    hasWarning(r) ||
    cleanText(get(r, "Statut paiement")) === "À vérifier"
  ).sort(sortByDateAsc);

  if (!rows.length) {
    root.innerHTML = empty("Aucune alerte pour cette saison.");
    return;
  }

  root.innerHTML = `
    <h2 class="section-title">Alertes</h2>
    <div class="cards">${rows.map(renderAlertCard).join("")}</div>
  `;

  attachCardListeners(root);
  attachPaymentListeners(root);
}

function renderAlertCard(row) {
  return renderMatchCard(row);
}

/* ---------------- Export ---------------- */

function renderExport() {
  const root = document.getElementById("export");
  const rows = state.filteredRows.filter(r => r._format !== "Alerte" && r._isActive);

  const five = rows.filter(r => r._format === "5x5");
  const three = rows.filter(r => r._format === "3x3");

  const text = [
    `REFEREE TRACKER — EXPORT`,
    `Saison : ${state.selectedSeason}`,
    ``,
    `Total indemnités : ${formatMoney(sum(rows, "_amount"))}`,
    `Total KM : ${formatNumber(sum(rows, "_km"), " km")}`,
    `Total matchs 5x5 : ${five.length}`,
    `Total tournois 3x3 : ${three.length}`,
    ``,
    `Top club : ${topLabel(rows, r => get(r, "Recevant")) || "-"}`,
    `Top salle : ${topLabel(rows, r => get(r, "Salle")) || "-"}`,
    `Top collègue : ${topLabel(five, r => get(r, "Collègue nom")) || "-"}`,
    ``,
    `Lignes :`,
    ...rows.map(r => `- ${get(r, "Date match")} ${get(r, "Heure/RDV")} | ${get(r, "Format")} | ${firstValue(r, ["Recevant", "Visiteur / événement"])} | ${formatMoney(r._amount)} | ${formatNumber(r._km, " km")}`)
  ].join("\n");

  root.innerHTML = `
    <h2 class="section-title">Export copiable</h2>
    <textarea class="export-box" readonly>${escapeHtml(text)}</textarea>
    <div class="actions">
      <button class="small-btn" type="button" id="copyExportBtn">Copier</button>
    </div>
  `;

  document.getElementById("copyExportBtn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    setStatus("Export copié", "ok");
  });
}

/* ---------------- Utils stats ---------------- */

function aggregateByPeriod(rows, keyFn) {
  const map = new Map();

  rows.forEach(row => {
    const key = keyFn(row);
    if (!key || key === "Sans date") return;

    if (!map.has(key)) map.set(key, { label: key, count: 0, amount: 0, km: 0 });
    const item = map.get(key);
    item.count += 1;
    item.amount += row._amount || 0;
    item.km += row._km || 0;
  });

  return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label), "fr"));
}

function topN(rows, keyFn, n) {
  const map = new Map();

  rows.forEach(row => {
    const label = cleanText(typeof keyFn === "function" ? keyFn(row) : row[keyFn]);
    if (!label) return;
    map.set(label, (map.get(label) || 0) + 1);
  });

  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr"))
    .slice(0, n);
}

function topLabel(rows, keyFn) {
  const top = topN(rows, keyFn, 1)[0];
  return top ? `${top.label} (${top.count})` : "";
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

function avg(rows, field) {
  const valid = rows.filter(r => Number(r[field]) > 0);
  if (!valid.length) return 0;
  return sum(valid, field) / valid.length;
}

function maxBy(rows, getter) {
  let best = null;
  let bestValue = -Infinity;

  rows.forEach(row => {
    const value = Number(getter(row)) || 0;
    if (value > bestValue) {
      bestValue = value;
      best = row;
    }
  });

  return bestValue > 0 ? best : null;
}

function groupBy(rows, fn) {
  return rows.reduce((acc, row) => {
    const key = fn(row) || "Autre";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}

function getMonthKey(row) {
  if (!row._date) return "Sans date";
  const y = row._date.getFullYear();
  const m = String(row._date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getWeekendKey(row) {
  if (!row._date) return "Sans date";
  const d = new Date(row._date);
  const day = d.getDay();
  const saturday = new Date(d);
  const shift = day === 0 ? -1 : 6 - day; // dimanche -> samedi précédent
  saturday.setDate(d.getDate() + shift);

  const sunday = new Date(saturday);
  sunday.setDate(saturday.getDate() + 1);

  return `${formatDateShort(saturday)} / ${formatDateShort(sunday)}`;
}

/* ---------------- Utils display ---------------- */

function get(row, key) {
  return row && row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : "";
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = get(row, key);
    if (value) return value;
  }
  return "";
}

function hasWarning(row) {
  return Boolean(get(row, "Warning général") || get(row, "Warning finance") || get(row, "Warning FBI"));
}

function formatColleague(row) {
  const name = get(row, "Collègue nom");
  const role = get(row, "Collègue rôle");
  const phone = get(row, "Collègue téléphone");

  if (!name) return "";
  return [name, role, phone].filter(Boolean).join(" — ");
}

function badge(text, cls = "") {
  if (!text) return "";
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function setStatus(message, type) {
  const bar = document.getElementById("statusBar");
  bar.textContent = message;
  bar.className = "status-bar show";
  if (type) bar.classList.add(type);

  if (type === "ok") {
    setTimeout(() => {
      bar.classList.remove("show");
    }, 2600);
  }
}

function parseFrDate(value) {
  if (!value) return null;
  const s = String(value).trim();

  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatDateShort(date) {
  if (!date) return "";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatNumber(value, suffix = "") {
  const n = Number(value) || 0;
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + suffix;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function onlyDigits(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sortByDateAsc(a, b) {
  const da = a._date ? a._date.getTime() : 0;
  const db = b._date ? b._date.getTime() : 0;
  return da - db;
}

function sortByPaymentThenDate(a, b) {
  const pa = PAYMENT_STATUSES.indexOf(get(a, "Statut paiement"));
  const pb = PAYMENT_STATUSES.indexOf(get(b, "Statut paiement"));
  if (pa !== pb) return pa - pb;
  return sortByDateAsc(a, b);
}

function wazeUrl(address) {
  return "https://waze.com/ul?q=" + encodeURIComponent(address) + "&navigate=yes";
}
