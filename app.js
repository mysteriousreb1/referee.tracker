const API_BASE_URL = "https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec";
const API_KEY = "REFEREE_TRACKER_2026_PRIVATE";

const PAYMENT_STATUSES = ["À recevoir", "Reçu", "Écart à vérifier", "À vérifier"];

let allMatches = [];
let currentFilter = "upcoming";

const matchesList = document.getElementById("matchesList");
const statusBox = document.getElementById("statusBox");
const refreshBtn = document.getElementById("refreshBtn");

refreshBtn.addEventListener("click", loadMatches);

matchesList.addEventListener("click", event => {
  const saveBtn = event.target.closest(".save-payment-btn");
  if (saveBtn) {
    const uid = saveBtn.dataset.uid;
    const select = [...document.querySelectorAll(".payment-select")]
      .find(el => el.dataset.uid === uid);

    if (!select) return;

    updatePaymentStatus(uid, select.value);
    return;
  }

  const summary = event.target.closest(".match-summary");
  if (summary) {
    const card = summary.closest(".match-card");
    card.classList.toggle("open");
  }
});

document.querySelectorAll(".filter-btn").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");

    currentFilter = button.dataset.filter;
    renderMatches();
  });
});

loadMatches();

function loadMatches() {
  setStatus("Chargement des données...", "");

  const url = `${API_BASE_URL}?key=${encodeURIComponent(API_KEY)}&action=matchs&v=${Date.now()}`;

  jsonp(url)
    .then(response => {
      if (!response.success) {
        throw new Error(response.error || "Erreur API");
      }

      allMatches = response.data || [];

      updateSummary();
      renderMatches();

      setStatus(`Données chargées : ${allMatches.length} ligne(s).`, "");
    })
    .catch(error => {
      setStatus("Erreur de chargement : " + error.message, "error");
      matchesList.innerHTML = "";
    });
}

function updatePaymentStatus(uid, status) {
  if (!uid) {
    setStatus("Impossible de modifier le paiement : UID manquant.", "error");
    return;
  }

  setStatus("Mise à jour du statut paiement...", "");

  const url =
    `${API_BASE_URL}?key=${encodeURIComponent(API_KEY)}` +
    `&action=updatePaymentStatus` +
    `&uid=${encodeURIComponent(uid)}` +
    `&status=${encodeURIComponent(status)}` +
    `&v=${Date.now()}`;

  jsonp(url)
    .then(response => {
      if (!response.success) {
        throw new Error(response.error || "Erreur de mise à jour");
      }

      setStatus("Statut paiement mis à jour.", "success");
      loadMatches();
    })
    .catch(error => {
      setStatus("Erreur mise à jour paiement : " + error.message, "error");
    });
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = "rtCallback_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const script = document.createElement("script");

    window[callbackName] = data => {
      delete window[callbackName];

      if (script.parentNode) {
        document.body.removeChild(script);
      }

      resolve(data);
    };

    script.onerror = () => {
      delete window[callbackName];

      if (script.parentNode) {
        document.body.removeChild(script);
      }

      reject(new Error("Impossible de contacter l'API"));
    };

    script.src = url + "&callback=" + callbackName;
    document.body.appendChild(script);
  });
}

function setStatus(message, type) {
  statusBox.classList.remove("error", "success");

  if (type) {
    statusBox.classList.add(type);
  }

  statusBox.textContent = message;
}

function updateSummary() {
  const active = allMatches.filter(m => get(m, "Statut") === "Actif").length;

  const warnings = allMatches.filter(m => {
    return Boolean(
      normalizeWarning(get(m, "Warning général")) ||
      normalizeWarning(get(m, "Warning finance")) ||
      normalizeWarning(get(m, "Warning FBI"))
    );
  }).length;

  const amountDue = allMatches
    .filter(m => get(m, "Statut paiement") === "À recevoir")
    .reduce((sum, m) => sum + toNumber(get(m, "Indemnité totale")), 0);

  document.getElementById("activeCount").textContent = active;
  document.getElementById("warningCount").textContent = warnings;
  document.getElementById("amountDue").textContent = formatMoney(amountDue);
}

function renderMatches() {
  const filtered = getFilteredMatches();

  if (!filtered.length) {
    matchesList.innerHTML = `<div class="empty">Aucun match à afficher.</div>`;
    return;
  }

  matchesList.innerHTML = filtered.map(match => renderMatchCard(match)).join("");
}

function getFilteredMatches() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let result = [...allMatches];

  if (currentFilter === "upcoming") {
    result = result.filter(m => {
      const d = parseDate(get(m, "Date match"));
      return d && d >= today && !isCancelled(m);
    });
  }

  if (currentFilter === "warnings") {
    result = result.filter(m => {
      return Boolean(
        normalizeWarning(get(m, "Warning général")) ||
        normalizeWarning(get(m, "Warning finance")) ||
        normalizeWarning(get(m, "Warning FBI"))
      );
    });
  }

  if (currentFilter === "payments") {
    result = result.filter(m => get(m, "Statut paiement") === "À recevoir");
  }

  if (currentFilter === "cancelled") {
    result = result.filter(m => isCancelled(m));
  }

  result.sort((a, b) => {
    const da = parseDateTime(get(a, "Date match"), get(a, "Heure/RDV"));
    const db = parseDateTime(get(b, "Date match"), get(b, "Heure/RDV"));

    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;

    return da - db;
  });

  return result;
}

function renderMatchCard(match) {
  const status = get(match, "Statut");
  const warningGeneral = normalizeWarning(get(match, "Warning général"));
  const warningFinance = normalizeWarning(get(match, "Warning finance"));
  const warningFbi = normalizeWarning(get(match, "Warning FBI"));
  const hasWarning = warningGeneral || warningFinance || warningFbi;

  const cardClass = [
    "match-card",
    hasWarning ? "warning" : "",
    isCancelled(match) ? "cancelled" : ""
  ].join(" ");

  const niveau = get(match, "Niveau administratif");
  const format = get(match, "Format");
  const code = get(match, "Code compétition");
  const recevant = get(match, "Recevant");
  const visiteur = get(match, "Visiteur / événement");
  const competition = get(match, "Libellé compétition");
  const date = formatDate(get(match, "Date match"));
  const time = normalizeTime(get(match, "Heure/RDV"));
  const address = get(match, "Adresse");
  const rawPhone = get(match, "Collègue téléphone");
  const phone = cleanPhone(rawPhone);
  const uid = getUid(match);
  const amount = toNumber(get(match, "Indemnité totale"));
  const statutPaiement = get(match, "Statut paiement");

  const summaryTitle = buildSummaryTitle(match);
  const summarySubtitle = buildSummarySubtitle(match);

  return `
    <article class="${cardClass}">
      <button class="match-summary" type="button">
        <div class="match-summary-main">
          <div class="summary-line-1">
            ${badge(format)}
            ${badge(niveau)}
            ${badge(code, "red")}
            ${statusBadge(status)}
          </div>
          <div class="summary-line-2">${escapeHtml(summaryTitle)}</div>
        </div>

        <div class="match-summary-side">
          <span class="date-pill">${escapeHtml(date)} ${time ? "• " + escapeHtml(time) : ""}</span>
          <span class="chevron">›</span>
        </div>
      </button>

      <div class="match-body">
        <div class="match-details">
          ${detail("Compétition", competition)}
          ${detail("Recevant", recevant)}
          ${detail("Visiteur / événement", visiteur)}
          ${detail("Salle", get(match, "Salle"))}
          ${detail("Adresse", address)}
          ${detail("Code e-Marque", get(match, "Code e-Marque"))}
          ${detail("Collègue", get(match, "Collègue nom"))}
          ${detail("Téléphone collègue", phone ? formatPhoneDisplay(phone) : "")}
          ${detail("Observateur", get(match, "Observateur"))}
          ${detail("Indemnisé par", get(match, "Indemnisé par"))}
        </div>

        ${renderFinanceBox(match, uid)}
        ${renderWarningBox(warningGeneral, warningFinance, warningFbi)}

        <div class="actions">
          ${address ? `<a class="action-link" target="_blank" href="${wazeUrl(address)}">Ouvrir Waze</a>` : ""}
          ${phone ? `<a class="action-link secondary" href="sms:${phone}">SMS collègue</a>` : ""}
          ${shouldShowFbiButton(warningGeneral, warningFbi) ? `<a class="action-link warning" target="_blank" href="https://extranet.ffbb.com/fbi/connexion.fbi">Ouvrir FBI</a>` : ""}
        </div>
      </div>
    </article>
  `;
}

function buildSummaryTitle(match) {
  const format = get(match, "Format");
  const recevant = get(match, "Recevant");
  const evenement = get(match, "Visiteur / événement");

  if (format === "3x3") {
    return evenement || get(match, "Libellé compétition") || "Mission 3x3";
  }

  return recevant || get(match, "Libellé compétition") || "Désignation";
}

function buildSummarySubtitle(match) {
  return "";
}

function renderFinanceBox(match, uid) {
  const indemnite = get(match, "Indemnité totale");
  const statutPaiement = get(match, "Statut paiement");
  const datePaiement = get(match, "Date paiement");
  const dateReception = get(match, "Date réception");
  const montantRecu = get(match, "Montant reçu");

  if (!indemnite && !statutPaiement && !datePaiement && !dateReception && !montantRecu) {
    return "";
  }

  const options = PAYMENT_STATUSES.map(status => {
    const selected = status === statutPaiement ? "selected" : "";
    return `<option value="${escapeAttr(status)}" ${selected}>${escapeHtml(status)}</option>`;
  }).join("");

  return `
    <div class="finance-box">
      ${detail("Indemnité totale", indemnite ? formatMoney(toNumber(indemnite)) : "")}
      ${detail("Statut paiement", statutPaiement)}
      ${detail("Date paiement prévue", formatDate(datePaiement))}
      ${detail("Date réception", formatDate(dateReception))}
      ${detail("Montant reçu", montantRecu ? formatMoney(toNumber(montantRecu)) : "")}

      <div class="payment-editor">
        <label>Modifier paiement</label>
        <select class="payment-select" data-uid="${escapeAttr(uid)}">
          ${options}
        </select>
        <button class="save-payment-btn" data-uid="${escapeAttr(uid)}" type="button">
          Enregistrer
        </button>
      </div>
    </div>
  `;
}

function renderWarningBox(warningGeneral, warningFinance, warningFbi) {
  if (!warningGeneral && !warningFinance && !warningFbi) {
    return "";
  }

  return `
    <div class="warning-box">
      ${warningGeneral ? `<div>⚠️ ${escapeHtml(warningGeneral)}</div>` : ""}
      ${warningFinance ? `<div>💶 ${escapeHtml(warningFinance)}</div>` : ""}
      ${warningFbi ? `<div>🏀 ${escapeHtml(warningFbi)}</div>` : ""}
    </div>
  `;
}

function detail(label, value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";

  return `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div>${escapeHtml(value)}</div>
    </div>
  `;
}

function badge(value, variant = "") {
  if (!value) return "";
  return `<span class="badge ${variant}">${escapeHtml(value)}</span>`;
}

function statusBadge(status) {
  if (!status) return "";

  const s = String(status).toLowerCase();

  if (s.includes("annul")) return `<span class="badge cancelled">${escapeHtml(status)}</span>`;
  if (s.includes("vérifier") || s.includes("verifier") || s.includes("réponse") || s.includes("reponse")) {
    return `<span class="badge warning">${escapeHtml(status)}</span>`;
  }

  return `<span class="badge">${escapeHtml(status)}</span>`;
}

function shouldShowFbiButton(warningGeneral, warningFbi) {
  const text = `${warningGeneral || ""} ${warningFbi || ""}`.toLowerCase();
  return text.includes("fbi");
}

function get(obj, key) {
  return obj && obj[key] !== undefined && obj[key] !== null ? String(obj[key]).trim() : "";
}

function getUid(match) {
  return get(match, "UID") || get(match, "Unique_Key");
}

function normalizeWarning(value) {
  const text = String(value || "").trim();
  const simplified = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

  if (!text) return "";
  if (["NON", "NO", "N", "FALSE", "0", "OUI", "YES", "Y", "TRUE", "1"].includes(simplified)) return "";

  return text;
}

function normalizeTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  let m = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) return pad2(m[1]) + ":" + pad2(m[2]);

  m = text.match(/T(\d{1,2}):(\d{2})/);
  if (m) return pad2(m[1]) + ":" + pad2(m[2]);

  m = text.match(/\b(\d{1,2})h(\d{0,2})\b/i);
  if (m) return pad2(m[1]) + ":" + pad2(m[2] || "00");

  return text;
}

function parseDate(value) {
  if (!value) return null;

  let text = String(value).trim();
  text = text.replace(/^[a-zà-ÿ]{3,9}\.?\s+/i, "");

  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = new Date(`${m[3]}-${pad2(m[2])}-${pad2(m[1])}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateTime(dateValue, timeValue) {
  const d = parseDate(dateValue);
  if (!d) return null;

  const time = normalizeTime(timeValue) || "00:00";
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return d;

  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
}

function formatDate(value) {
  const d = parseDate(value);
  if (!d) return value || "";

  return d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatMoney(value) {
  const n = Number(value || 0);

  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR"
  });
}

function toNumber(value) {
  if (!value) return 0;

  const n = Number(String(value).replace(",", ".").replace(/[^\d.]/g, ""));
  return isNaN(n) ? 0 : n;
}

function cleanPhone(value) {
  let digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.length === 9) digits = "0" + digits;
  return digits;
}

function formatPhoneDisplay(value) {
  const digits = cleanPhone(value);
  if (digits.length !== 10) return digits;
  return digits.replace(/(\d{2})(?=\d)/g, "$1.").replace(/\.$/, "");
}

function wazeUrl(address) {
  return "https://waze.com/ul?q=" + encodeURIComponent(address) + "&navigate=yes";
}

function isCancelled(match) {
  return String(get(match, "Statut")).toLowerCase().includes("annul");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function pad2(value) {
  return String(value || "0").padStart(2, "0");
}
