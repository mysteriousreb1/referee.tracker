/* rt-stats.js — GÉNÉRÉ depuis code.gs (test/build-rt-stats.js). Ne pas modifier à la main.
   Moteur de statistiques avancées exécuté dans le navigateur : même code que
   buildStatsForApiBrut_ côté Apps Script, seules les sources de données sont
   remplacées (lignes MATCHS en mémoire, réglages reçus via « stats.env »).
   Aucun secret ici. */
const RT_STATS = (function () {
  "use strict";
  // ---------- état injecté ----------
  let ROWS = [];                       // objets clé = en-tête du Sheet (valeurs affichées)
  let ENV = { couts: { prix: [], entretien: [] }, prixActuel: 0, prixGel: {} };
  let CONFIG = null;                   // Profil.config (profil, vehicules, tarifs)
  // ---------- shims Apps Script ----------
  const Logger = { log() {} };
  function log_() {}
  function _cacheLire_() { return null; }
  function _cacheEcrire_(k, v) { return v; }
  function _cacheInvalider_() {}
  function lireCouts_() { return ENV.couts || { prix: [], entretien: [] }; }
  function prixHistorique_() { return (ENV.prixHistorique && Object.keys(ENV.prixHistorique).length) ? ENV.prixHistorique : PRIX_E10_HISTORIQUE; }
  function lirePrixActuel_() { const n = Number(ENV.prixActuel); return (n > 0.5 && n < 4) ? n : 0; }
  function lirePrixGel_(cle) { const v = Number((ENV.prixGel || {})[cle]); return (v > 0.5 && v < 4) ? v : 0; }
  function gelerPrix_() {}            // le gel est fait côté serveur
  var START_COORDS = { lat: 0, lon: 0 }, START_ADDRESS = "";
  var VEHICLES = [{ name: "Peugeot 108", consoL100: 6.58, cv: 4, depuis: "01/01/2000" }, { name: "Audi A3 35 TFSI", consoL100: 6.0, cv: 8, depuis: "01/08/2026" }];
  function _syncConfig_() {
    const c = CONFIG; if (!c) return;
    if (c.tarifs) { if (c.tarifs.indemnite_km) RATE_PER_KM_FFBB = c.tarifs.indemnite_km; if (c.tarifs.usure_km) COUT_USURE_PAR_KM = c.tarifs.usure_km; if (c.tarifs.carburant_defaut) FUEL_PRICE_PER_L = c.tarifs.carburant_defaut; }
    if (Array.isArray(c.vehicules) && c.vehicules.length) VEHICLES = c.vehicules.map(v => ({ name: v.nom, consoL100: v.conso, cv: v.cv, depuis: v.depuis }));
  }
  // CFG.vehiculePour : dernier véhicule dont « depuis » précède la date (liste triée par depuis).
  function vehicleForDate_(dateStr) {
    const liste = VEHICLES.slice().sort((a, b) => (parseDate_(a.depuis) || 0) - (parseDate_(b.depuis) || 0));
    const d = parseDate_(dateStr);
    if (!d) return liste[liste.length - 1];
    let choisi = liste[0];
    for (let i = 0; i < liste.length; i++) { const dd = parseDate_(liste[i].depuis); if (dd && dd <= d) choisi = liste[i]; else break; }
    return choisi;
  }
  // getSS_().getSheetByName(SHEET_MATCHS) → feuille virtuelle construite sur ROWS
  function getSS_() {
    return { getSheetByName() {
      const headers = ROWS.length ? Object.keys(ROWS[0]).filter(h => h.charAt(0) !== "_") : [];
      const values = [headers].concat(ROWS.map(r => headers.map(h => r[h] == null ? "" : String(r[h]))));
      return { getLastRow: () => values.length, getLastColumn: () => headers.length, getRange: () => ({ getDisplayValues: () => values }) };
    } };
  }
  // ---------- code.gs (extrait) ----------
  function dateValide_(a, mo, j) {
  const d = new Date(a, mo - 1, j);
  return (d.getFullYear() === a && d.getMonth() === mo - 1 && d.getDate() === j) ? d : null;
  }
  var RATE_PER_KM_FFBB = 0.40;
  var FUEL_PRICE_PER_L = 1.95;
  const PRIX_E10_HISTORIQUE = {
  // 2022
  "2022-01": 1.6281,
  "2022-02": 1.6986,
  "2022-03": 1.8901,
  "2022-04": 1.6916,
  "2022-05": 1.8012,
  "2022-06": 1.9578,
  "2022-07": 1.8312,
  "2022-08": 1.7041,
  "2022-09": 1.4477,
  "2022-10": 1.5527,
  "2022-11": 1.6151,
  "2022-12": 1.5643,
  // 2023
  "2023-01": 1.8238,
  "2023-02": 1.8337,
  "2023-03": 1.8228,
  "2023-04": 1.8327,
  "2023-05": 1.7755,
  "2023-06": 1.7663,
  "2023-07": 1.7662,
  "2023-08": 1.8645,
  "2023-09": 1.8884,
  "2023-10": 1.7981,
  "2023-11": 1.7703,
  "2023-12": 1.7326,
  // 2024
  "2024-01": 1.7498,
  "2024-02": 1.785,
  "2024-03": 1.7969,
  "2024-04": 1.8478,
  "2024-05": 1.8096,
  "2024-06": 1.7544,
  "2024-07": 1.7362,
  "2024-08": 1.6897,
  "2024-09": 1.6424,
  "2024-10": 1.6664,
  "2024-11": 1.6683,
  "2024-12": 1.6953,
  // 2025
  "2025-01": 1.7057,
  "2025-02": 1.6905,
  "2025-03": 1.6367,
  "2025-04": 1.6421,
  "2025-05": 1.6254,
  "2025-06": 1.627,
  "2025-07": 1.6125,
  "2025-08": 1.6153,
  "2025-09": 1.6403,
  "2025-10": 1.6297,
  "2025-11": 1.6647,
  "2025-12": 1.5956,
  // 2026
  "2026-01": 1.6596,
  "2026-02": 1.6883,
  "2026-03": 1.861,
  "2026-04": 1.995,
  "2026-05": 2.0273,
  "2026-06": 1.868,
  // Saison 2026/2027 — prix reel releve secteur Kaltenhouse (bascule 2,26 EUR/L sur matchs passes)
  "2026-08": 2.26,
  "2026-09": 2.26
  };
  const BAREME_FISCAL_PAR_KM = {
  3: 0.529,
  4: 0.606,
  5: 0.636,
  6: 0.665,
  7: 0.697,
  8: 0.697
  };
  const LIEUX_3X3 = ["BASKET CENTER"];
  const DUREE_MATCH_H = {
  "5x5": 2.5,
  "3x3": 6,
  "default": 1.5
  };
  var COUT_USURE_PAR_KM = 0.12;
  const CO2_KG_PAR_LITRE_E10 = 2.28;
  const SAISON_DEBUT_MOIS = 9;
  const SAISON_FIN_MOIS = 7;
  const SHEET_MATCHS = "MATCHS";
  function detecterGenre_(code, libelle) {
  const c = normalize_(code);
  // Certains libellés utilisent _ ou . comme séparateurs (CPE_U13M_T2_1/8)
  const t = (c + " " + normalize_(libelle)).replace(/[_.]+/g, " ").trim();
  // Mixte en premier : sinon le "M" de "MI" serait pris pour Masculin
  if (/\bU\d{2}MI\b/.test(t) || /\bMIXTE\b/.test(t)) return "Mixte";
  // Championnats : DMU18, RFU13, NM2, DF2, PRM, PNF, RM2...
  let m = c.match(/^(?:D|R|N|PR|PN)(M|F)(?:U?\d|\d|$)/);
  if (m) return m[1] === "M" ? "Masculin" : "Féminin";
  // Séniors en coupe : SM / SF
  if (/\bSM\b/.test(t)) return "Masculin";
  if (/\bSF\b/.test(t)) return "Féminin";
  // Genre accolé à la catégorie : U18M, U13F (coupes, finales, opens)
  m = t.match(/\bU\d{2}\s*(M|F)\b/);
  if (m) return m[1] === "M" ? "Masculin" : "Féminin";
  // Amicaux : RSF-10, RSM-10
  m = t.match(/\bRS(M|F)\b/);
  if (m) return m[1] === "M" ? "Masculin" : "Féminin";
  return "";
  }
  function detecterCategorie_(code, libelle) {
  const c = normalize_(code);
  const t = (c + " " + normalize_(libelle)).replace(/[_.]+/g, " ").trim();
  // Ni \b avant le U (collé au genre : DMU18), ni après les chiffres (U18M)
  const m = t.match(/U(\d{2})/);
  if (m) return "U" + m[1];
  if (/\bS(M|F)\b/.test(t) || /\bRS(M|F)\b/.test(t)) return "Séniors";
  if (/^(?:D|R|N)(?:M|F)\d/.test(c)) return "Séniors"; // DM2, RF2, NM1
  if (/^(?:PR|PN)(?:M|F)$/.test(c)) return "Séniors"; // PRM, PNF
  return "";
  }
  function compute11thNextMonth_(dateStr) {
  const d = parseDate_(dateStr);
  if (!d) return "";
  const payment = new Date(d.getFullYear(), d.getMonth() + 1, 11);
  return formatDate_(payment);
  }
  function computeSeason_(dateStr) {
  const d = parseDate_(dateStr) || new Date();
  const y = getSeasonStartYear_(d);
  return `${y}/${y + 1}`;
  }
  function getSeasonStartYear_(date) {
  const d = date || new Date();
  const year = d.getFullYear();
  const switchDate = new Date(year, 6, 30); // 30 juillet
  return d >= switchDate ? year : year - 1;
  }
  function parseDate_(dateStr) {
  if (!dateStr) return null;
  if (Object.prototype.toString.call(dateStr) === "[object Date]") return dateStr;
  const s = String(dateStr).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return dateValide_(Number(m[3]), Number(m[2]), Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dateValide_(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
  }
  function formatDate_(date) {
  return `${pad2_(date.getDate())}/${pad2_(date.getMonth() + 1)}/${date.getFullYear()}`;
  }
  function clean_(value) {
  return String(value || "").replace(/\u00A0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
  }
  function normalize_(value) {
  return clean_(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }
  function pad2_(value) {
  return String(value || "0").padStart(2, "0");
  }
  const ENTRETIEN_PAR_KM_ = { "Audi A3 35 TFSI": 0.1875, "Peugeot 108": 0.12 };
  function isoDate_(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function periodePour_(liste, dateStr) {
  var d = parseDate_(dateStr);
  if (!d || !liste || !liste.length) return null;
  var iso = isoDate_(d), res = null;
  for (var i = 0; i < liste.length; i++) { if (liste[i].depuis <= iso) res = liste[i]; }
  return res;
  }
  function entretienParKm_(dateStr) {
  var per = periodePour_(lireCouts_().entretien, dateStr);
  if (per) return per.eur_km;
  const n = (vehicleForDate_(dateStr) || {}).name || "";
  return (ENTRETIEN_PAR_KM_[n] !== undefined) ? ENTRETIEN_PAR_KM_[n] : COUT_USURE_PAR_KM;
  }
  function prixCarburantPour_(dateStr) {
  const d = parseDate_(dateStr);
  if (!d) return FUEL_PRICE_PER_L;
  var perPrix = periodePour_(lireCouts_().prix, dateStr);
  if (perPrix) return perPrix.prix;
  const cle = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  // 1. Le mois figure dans l'historique : c'est la valeur définitive
  const HISTO = prixHistorique_();
  if (HISTO[cle]) return HISTO[cle];
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  // 2. Match passé hors historique : on prend le mois connu le plus proche —
  // SAUF si le trou est APRÈS le dernier mois figé (ex. juillet 2026 alors que
  // l'historique s'arrête en juin 2026) : dans ce cas le prix a probablement
  // augmenté depuis, et le relevé « temps réel » en cache (mis à jour chaque
  // semaine par majPrixCarburantActuel_) est une bien meilleure approximation
  // qu'un mois potentiellement vieux de plusieurs mois. MODIFICATION 19/09/2026.
  if (d < aujourdhui) {
  const mois = Object.keys(HISTO).sort();
  if (!mois.length) return FUEL_PRICE_PER_L;
  const dernierMoisConnu = mois[mois.length - 1];
  const moisCourant = aujourdhui.getFullYear() + "-" + String(aujourdhui.getMonth() + 1).padStart(2, "0");
  if (moisEnNombre_(cle) > moisEnNombre_(dernierMoisConnu)) {
  const gele = lirePrixGel_(cle);
  if (gele) return gele; // mois révolu : prix figé, ne bouge plus
  const actuel = lirePrixActuel_();
  if (actuel) {
  // On ne fige que les mois RÉVOLUS ; le mois en cours reste au temps réel.
  if (moisEnNombre_(cle) < moisEnNombre_(moisCourant)) gelerPrix_(cle, actuel);
  return actuel;
  }
  }
  let proche = mois[0];
  let ecartMin = Infinity;
  mois.forEach(m => {
  const ecart = Math.abs(moisEnNombre_(m) - moisEnNombre_(cle));
  if (ecart < ecartMin) {
  ecartMin = ecart;
  proche = m;
  }
  });
  return PRIX_E10_HISTORIQUE[proche];
  }
  // 3. Match à venir : prix temps réel s'il est en cache
  const actuel = lirePrixActuel_();
  return actuel || FUEL_PRICE_PER_L;
  }
  function moisEnNombre_(cle) {
  const p = String(cle).split("-");
  return Number(p[0]) * 12 + Number(p[1]);
  }
  function realFuelCost_(kmAR, dateStr) {
  const km = Number(kmAR) || 0;
  if (!km) return 0;
  const v = vehicleForDate_(dateStr);
  const prix = prixCarburantPour_(dateStr);
  return Number(((km * v.consoL100 / 100) * prix).toFixed(2));
  }
  function baremeFiscalCost_(kmAR, dateStr) {
  const km = Number(kmAR) || 0;
  if (!km) return 0;
  const v = vehicleForDate_(dateStr);
  const coef = BAREME_FISCAL_PAR_KM[v.cv] || BAREME_FISCAL_PAR_KM[5];
  return Number((km * coef).toFixed(2));
  }
  function appliquerDoublesStats_(entries) {
  const groupes = {};
  entries.forEach(e => {
  if (!e.date) return;
  // b39 — même règle que le site (lieuDouble_) : VILLE d'abord (les salles sont
  // écrites différemment d'une convocation à l'autre), jamais en 3x3.
  if (String(e.format || "") === "3x3") return;
  const brut = e.ville || e.salle || e.adresse || "";
  const lieu = normUpper_(brut).replace(/[^A-Z0-9]/g, "");
  if (!lieu) return;
  const d = e.date;
  const cle = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() + "|" + lieu;
  (groupes[cle] = groupes[cle] || []).push(e);
  });
  Object.keys(groupes).forEach(cle => {
  const grp = groupes[cle];
  if (grp.length < 2) return;
  // Le km n'est souvent présent que sur UNE convocation du groupe (les autres
  // vides) : on prend le km du GROUPE = le max, puis on le répartit → somme =
  // 1 seul A/R, robuste au remplissage des lignes.
  const kmGroupe = Math.max.apply(null, grp.map(e => e.kmAR || 0));
  grp.forEach(e => recalculerKmDouble_(e, kmGroupe / grp.length, grp.length));
  });
  }
  function recalculerKmDouble_(e, kmEff, taille) {
  e.doubleTaille = taille;
  e.kmAR = kmEff; // km attribué (coûts + km parcourus comptés une fois au total)
  e.coutReel = realFuelCost_(kmEff, e.dateStr);
  e.bareme = baremeFiscalCost_(kmEff, e.dateStr);
  e.remboursementKm = Number((kmEff * RATE_PER_KM_FFBB).toFixed(2));
  e.netReel = Number((e.indemnite - e.coutReel).toFixed(2));
  e.coutUsure = round2_(kmEff * entretienParKm_(e.dateStr));
  e.netReelToutCompris = round2_(e.indemnite - e.coutReel - e.coutUsure);
  e.litres = round2_(kmEff * vehicleForDate_(e.dateStr).consoL100 / 100);
  e.co2Kg = round2_(e.litres * CO2_KG_PAR_LITRE_E10);
  e.dureeH = (DUREE_MATCH_H[e.format] || DUREE_MATCH_H.default) + (kmEff ? kmEff / 70 : 0);
  e.eurParHeure = e.dureeH > 0 ? Number((e.netReel / e.dureeH).toFixed(2)) : 0;
  e.eurParKm = kmEff > 0 ? Number((e.indemnite / kmEff).toFixed(2)) : 0;
  }
  function buildStatsForApiBrut_(seasonFilter) {
  _syncConfig_(); // MODIFICATION B
  const sheet = getSS_().getSheetByName(SHEET_MATCHS);
  if (!sheet || sheet.getLastRow() < 2) return emptyStats_();
  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
  const headers = values[0];
  const idx = {};
  headers.forEach((h, i) => idx[h] = i);
  const rows = values.slice(1).filter(r => String(r[idx["UID"]] || "").trim());
  // Enrichissement : coût réel, net réel, véhicule, indicateurs 3x3/BASKET CENTER
  const enriched = rows.map(r => {
  const format = r[idx["Format"]] || "";
  const statut = String(r[idx["Statut"]] || "").toLowerCase();
  const dateStr = r[idx["Date match"]] || "";
  const season = normSeason_(r[idx["Saison"]] || "", dateStr);
  const kmAR = num_(r[idx["Km A/R stats"]]);
  const statutPaiement = r[idx["Statut paiement"]] || "";
  /* Bénévolat : le match a bien eu lieu, les kilomètres et le carburant
  sont réels, mais aucune indemnité n'a été perçue. On compte donc 0 €
  de recette — le net devient logiquement négatif, ce qui est la vérité
  de l'opération. L'indemnité théorique reste dans le Sheet. */
  const estBenevole = normUpper_(statutPaiement) === "BENEVOLE";
  const indemniteTheorique = num_(r[idx["Indemnité totale"]]);
  const indemnite = estBenevole ? 0 : indemniteTheorique;
  const recevant = r[idx["Recevant"]] || "";
  const salle = r[idx["Salle"]] || "";
  const ville = r[idx["Ville"]] || "";
  const adresse = r[idx["Adresse"]] || "";
  const niveau = r[idx["Niveau administratif"]] || "";
  // Genre/catégorie : lus de la colonne si présente, sinon recalculés à la volée
  // (permet d'avoir les stats même sur les lignes historiques non enrichies)
  const codeComp = r[idx["Code compétition"]] || "";
  const libComp = r[idx["Libellé compétition"]] || "";
  const genre = (idx["Genre"] !== undefined && r[idx["Genre"]]) ? r[idx["Genre"]] : detecterGenre_(codeComp, libComp);
  const categorie = (idx["Catégorie d'âge"] !== undefined && r[idx["Catégorie d'âge"]]) ? r[idx["Catégorie d'âge"]] : detecterCategorie_(codeComp, libComp);
  const collegue = r[idx["Collègue nom"]] || "";
  const paiementType = r[idx["Paiement Type"]] || "";
  const datePaiementPrevu = (idx["Date attendue"] !== undefined ? r[idx["Date attendue"]] : "") || r[idx["Date paiement"]] || "";
  const dateReception = r[idx["Date réception"]] || "";
  const montantRecuVentile = num_(idx["Reçu recevant"] !== undefined ? r[idx["Reçu recevant"]] : 0) +
  num_(idx["Reçu visiteur"] !== undefined ? r[idx["Reçu visiteur"]] : 0);
  const montantRecuTotal = montantRecuVentile || num_(r[idx["Montant reçu"]]);
  const coutReel = realFuelCost_(kmAR, dateStr);
  const bareme = baremeFiscalCost_(kmAR, dateStr);
  const remboursementKm = Number((kmAR * RATE_PER_KM_FFBB).toFixed(2));
  const netReel = Number((indemnite - coutReel).toFixed(2));
  const veh = vehicleForDate_(dateStr).name;
  // Usure/entretien (hors carburant) et empreinte carbone
  const coutUsure = round2_(kmAR * entretienParKm_(dateStr));
  const netReelToutCompris = round2_(indemnite - coutReel - coutUsure);
  const litres = round2_(kmAR * vehicleForDate_(dateStr).consoL100 / 100);
  const co2Kg = round2_(litres * CO2_KG_PAR_LITRE_E10);
  const dureeH = (DUREE_MATCH_H[format] || DUREE_MATCH_H.default) + (kmAR ? kmAR / 70 : 0); // trajet ~70km/h
  const eurParHeure = dureeH > 0 ? Number((netReel / dureeH).toFixed(2)) : 0;
  const eurParKm = kmAR > 0 ? Number((indemnite / kmAR).toFixed(2)) : 0;
  // Délai réel de paiement, si le match est encaissé et les deux dates connues
  const dPrevu = parseDate_(datePaiementPrevu);
  const dRecu = parseDate_(dateReception);
  const dMatch = parseDate_(dateStr);
  let delaiJours = (dPrevu && dRecu) ? Math.round((dRecu - dPrevu) / 86400000) : null;
  // b39 — une réception AVANT le match ou à plus de 400 j est une date d'import
  // (correction en lot), pas un vrai délai : on l'ignore.
  if (delaiJours !== null && ((dMatch && dRecu < dMatch) || Math.abs(delaiJours) > 400)) delaiJours = null;
  const jourSemaine = dMatch ? dMatch.getDay() : null; // 0 = dimanche ... 6 = samedi
  const is3x3 = format === "3x3";
  const isBasketCenter = LIEUX_3X3.some(l => normUpper_(recevant).includes(l) || normUpper_(salle).includes(l));
  return {
  format,
  statut,
  dateStr,
  season,
  kmAR,
  indemnite,
  indemniteTheorique,
  estBenevole,
  statutPaiement,
  recevant,
  salle,
  ville,
  adresse,
  niveau,
  collegue,
  genre,
  categorie,
  paiementType,
  coutReel,
  bareme,
  remboursementKm,
  netReel,
  veh,
  dureeH,
  eurParHeure,
  eurParKm,
  is3x3,
  isBasketCenter,
  coutUsure,
  netReelToutCompris,
  litres,
  co2Kg,
  delaiJours,
  jourSemaine,
  dateReception,
  datePaiementPrevu,
  montantRecu: montantRecuTotal,
  isActive: !statut.toLowerCase().includes("annul") && format !== "Alerte",
  date: parseDate_(dateStr)
  };
  }).filter(e => e.isActive);
  // Doublé (02/10/2026) — rétroactif, toutes saisons : plusieurs matchs le
  // même jour au même lieu = un SEUL trajet A/R. On répartit km + coûts à
  // parts égales entre les matchs du groupe ; l'indemnité reste entière.
  appliquerDoublesStats_(enriched);
  const filtered = (seasonFilter && seasonFilter !== "Toutes les saisons") ?
  enriched.filter(e => e.season === seasonFilter) :
  enriched;
  const five = filtered.filter(e => e.format === "5x5");
  const three = filtered.filter(e => e.format === "3x3");
  const sum = (arr, k) => arr.reduce((t, e) => t + (Number(e[k]) || 0), 0);
  const avg = (arr, k) => {
  const v = arr.filter(e => Number(e[k]) > 0);
  return v.length ? sum(v, k) / v.length : 0;
  };
  const totalIndemnite = sum(filtered, "indemnite");
  const totalCoutReel = sum(filtered, "coutReel");
  const totalNetReel = sum(filtered, "netReel");
  const totalKm = sum(filtered, "kmAR");
  const totalDureeH = sum(filtered, "dureeH");
  const totalRemboursementKm = sum(filtered, "remboursementKm");
  const totalBareme = sum(filtered, "bareme");
  // Reçu vs à recevoir
  const estBenevole_ = e => normUpper_(e.statutPaiement) === "BENEVOLE";
  const recu = filtered.filter(e => normUpper_(e.statutPaiement) === "RECU");
  // Un match bénévole ne figure ni dans le reçu ni dans le restant dû :
  // il n'y a simplement pas d'argent en jeu.
  const aRecevoir = filtered.filter(e => normUpper_(e.statutPaiement) !== "RECU" && !estBenevole_(e));
  const benevoles = filtered.filter(estBenevole_);
  // Agrégations
  const parSaison = aggregate_(filtered, e => e.season);
  const parMois = aggregate_(filtered, e => monthKey_(e.date));
  parMois.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  const NIVEAUX_VALIDES_ = ["Amical", "Départemental", "Régional", "Championnat de France", "3x3"];
  const parNiveau = aggregate_(filtered, e => NIVEAUX_VALIDES_.includes(e.niveau) ? e.niveau : (e.niveau ? "Autre" : "Inconnu"));
  const parClub = aggregate_(five, e => e.recevant);
  const parSalle = aggregate_(five, e => e.salle); // 5x5 seulement (salles réelles)
  const parVille = aggregate_(filtered, e => e.ville);
  const parCollegue = aggregate_(five, e => e.collegue);
  const parEvenement3x3 = aggregate_(three, e => e.recevant); // 3x3 par événement
  const parGenre = aggregate_(filtered, e => e.genre || "Non déterminé");
  const parCategorie = aggregate_(filtered, e => e.categorie || "Non déterminé");
  // ===== Usure & empreinte carbone =====
  const totalUsure = sum(filtered, "coutUsure");
  const totalNetToutCompris = sum(filtered, "netReelToutCompris");
  const totalLitres = sum(filtered, "litres");
  const totalCo2 = sum(filtered, "co2Kg");
  // ===== Délais réels de paiement (par type de paiement) =====
  // Détecte les dates de réception suspectes : si une même date revient sur
  // une part anormalement élevée des paiements reçus, c'est probablement
  // une correction en lot passée (comme marquerPaiementsRecus()), pas de
  // vraies dates individuelles — on l'exclut du calcul de délai pour ne
  // pas produire un chiffre absurde, sans pour autant remettre en cause
  // le statut "Reçu" lui-même.
  const dateReceptionSuspecte_ = detecterDateSuspecte_(filtered);
  const avecDelai = filtered.filter(e =>
  e.delaiJours !== null && e.dateReception !== dateReceptionSuspecte_
  );
  const parDelaiType = aggregerDelais_(avecDelai);
  const delaiMoyenGlobal = avecDelai.length ? avecDelai.reduce((t, e) => t + e.delaiJours, 0) / avecDelai.length : null;
  // ===== Régularité =====
  const moisRegularite = aggregate_(filtered, e => monthKey_(e.date));
  const regularite = calculerRegularite_(moisRegularite, filtered);
  // ===== Fidélité géographique =====
  const fidelite = calculerFidelite_(five);
  // ===== Seuil de rentabilité kilométrique =====
  const coutParKmMoyen = totalKm > 0 ? (totalCoutReel + totalUsure) / totalKm : 0;
  const indemniteMoyenneParMission = filtered.length ? totalIndemnite / filtered.length : 0;
  const kmEquilibre = coutParKmMoyen > 0 ? Math.round(indemniteMoyenneParMission / coutParKmMoyen) : null;
  // ===== Projection fin de saison (uniquement si la saison sélectionnée est en cours) =====
  const projection = calculerProjection_(seasonFilter, filtered, totalNetReel, enriched);
  const cashFlow = calculerCashFlow_(filtered);
  const comparaisonN1 = calculerComparaisonSaisonN1_(seasonFilter, enriched);
  // ===== Score de rentabilité par mission (0-100, relatif aux missions affichées) =====
  const classementRentabilite = classerRentabilite_(filtered);
  // Records
  const maxKm = maxByKey_(filtered, "kmAR");
  const maxIndemnite = maxByKey_(filtered, "indemnite");
  const maxNet = maxByKey_(filtered, "netReel");
  const minEurHeure = minByKey_(filtered.filter(e => isFinite(e.eurParHeure) && e.eurParHeure !== 0), "eurParHeure");
  return {
  season: seasonFilter || "Toutes les saisons",
  totaux: {
  missions: filtered.length,
  matchs5x5: five.length,
  tournois3x3: three.length,
  indemnite_brute: round2_(totalIndemnite),
  remboursement_km: round2_(totalRemboursementKm),
  cout_reel_carburant: round2_(totalCoutReel),
  net_reel: round2_(totalNetReel),
  equivalent_bareme_fiscal: round2_(totalBareme),
  km_total_AR: round2_(totalKm),
  recu_total: round2_(filtered.reduce((t, e) => t + encaissePaiement_(e), 0)),
  a_recevoir_total: round2_(filtered.reduce((t, e) => t + restePaiement_(e), 0)),
  nb_recu: recu.length,
  nb_a_recevoir: aRecevoir.length,
  nb_recu_partiel: filtered.filter(e => normUpper_(e.statutPaiement) === "RECU PARTIEL").length,
  nb_benevole: benevoles.length,
  benevolat_total: round2_(sum(benevoles, "indemnite"))
  },
  moyennes: {
  indemnite_par_5x5: round2_(avg(five, "indemnite")),
  indemnite_par_3x3: round2_(avg(three, "indemnite")),
  net_reel_par_mission: round2_(filtered.length ? sum(filtered, "netReel") / filtered.length : 0),
  km_par_5x5: round2_(avg(five, "kmAR")),
  km_par_3x3: round2_(avg(three, "kmAR")),
  eur_par_km: round2_(totalKm > 0 ? totalIndemnite / totalKm : 0),
  eur_par_heure_moyen: round2_(totalDureeH > 0 ? totalNetReel / totalDureeH : 0),
  cout_reel_par_100km: round2_(totalKm > 0 ? (totalCoutReel / totalKm) * 100 : 0)
  },
  cout_complet: {
  cout_usure_total: round2_(totalUsure),
  net_reel_tout_compris: round2_(totalNetToutCompris),
  cout_usure_par_km: totalKm > 0 ? round2_(totalUsure / totalKm) : COUT_USURE_PAR_KM,
  km_equilibre: kmEquilibre,
  note: "Le carburant est le seul coût réellement décaissé au fil de l'eau. L'usure (pneus, entretien, décote) est une estimation (moyenne " + (totalKm > 0 ? (totalUsure / totalKm) : COUT_USURE_PAR_KM).toFixed(2) + " €/km selon tes réglages), non versée par personne — elle sert à donner un net réel plus complet."
  },
  empreinte: {
  litres_consommes: round2_(totalLitres),
  co2_kg: round2_(totalCo2),
  equivalent_pleins_50l: round2_(totalLitres / 50),
  facteur_co2_par_litre: CO2_KG_PAR_LITRE_E10
  },
  delais_paiement: {
  delai_moyen_jours: delaiMoyenGlobal !== null ? Math.round(delaiMoyenGlobal) : null,
  par_type: parDelaiType,
  nb_avec_delai_connu: avecDelai.length,
  date_exclue_car_suspecte: dateReceptionSuspecte_ || null,
  note: dateReceptionSuspecte_ ?
  "La date " + dateReceptionSuspecte_ + " revient sur un grand nombre de paiements — probablement une correction en lot passée plutôt que de vraies dates de réception. Exclue du calcul de délai." :
  ""
  },
  regularite: regularite,
  fidelite_geographique: fidelite,
  projection_saison: projection,
  cash_flow: cashFlow,
  comparaison_saison_precedente: comparaisonN1,
  classement_rentabilite: classementRentabilite,
  records: {
  plus_gros_deplacement: maxKm ? {
  km: maxKm.kmAR,
  lieu: maxKm.recevant || maxKm.salle,
  date: maxKm.dateStr
  } : null,
  plus_grosse_indemnite: maxIndemnite ? {
  montant: maxIndemnite.indemnite,
  lieu: maxIndemnite.recevant,
  date: maxIndemnite.dateStr
  } : null,
  meilleur_net_reel: maxNet ? {
  net: maxNet.netReel,
  lieu: maxNet.recevant,
  date: maxNet.dateStr
  } : null,
  pire_rentabilite_horaire: minEurHeure ? {
  eur_heure: minEurHeure.eurParHeure,
  lieu: minEurHeure.recevant || minEurHeure.salle,
  date: minEurHeure.dateStr
  } : null
  },
  par_saison: parSaison,
  par_mois: parMois,
  par_niveau: parNiveau,
  top_clubs: parClub.slice(0, 8),
  top_salles: parSalle.slice(0, 8),
  top_villes: parVille.slice(0, 8),
  top_collegues: parCollegue.slice(0, 8),
  evenements_3x3: parEvenement3x3,
  par_genre: parGenre,
  par_categorie: parCategorie,
  vehicules: VEHICLES.map(v => ({
  nom: v.name,
  conso: v.consoL100,
  cv: v.cv
  })),
  prix_carburant: FUEL_PRICE_PER_L,
  note_3x3: "Les lieux " + LIEUX_3X3.join(", ") + " sont exclusivement 3x3 — comptés uniquement dans les stats 3x3."
  };
  }
  function encaissePaiement_(e) {
  const s = normUpper_(e.statutPaiement);
  if (e.estBenevole) return 0;
  if (s === "RECU" && !num_(e.montantRecu)) return e.indemnite;
  return Math.max(0, Math.min(num_(e.montantRecu), e.indemnite));
  }
  function restePaiement_(e) {
  if (e.estBenevole) return 0;
  return Math.max(0, e.indemnite - encaissePaiement_(e));
  }
  function calculerCashFlow_(missions) {
  const AUJ = new Date(); AUJ.setHours(0, 0, 0, 0);
  const enAttente = missions.filter(function (e) {
  return !e.estBenevole && restePaiement_(e) > 0;
  });
  const parDate = {};
  let retardMontant = 0, retardNb = 0;
  enAttente.forEach(function (e) {
  let ds = e.datePaiementPrevu;
  if (!ds && e.niveau === "Départemental" && typeof echeanceTexte_ === "function") ds = echeanceTexte_("cd67", e.dateStr);
  if (!ds && e.niveau === "Départemental" && typeof periodeCD67Pour_ === "function") {
  // periodeCD67Pour_ (Bareme.gs) référence parseDate_ qui vit dans l'IIFE
  // de Code.gs : hors de portée pour Bareme.gs. On protège l'appel pour
  // ne jamais crasher le calcul des stats ; repli compute11thNextMonth_.
  try { const p = periodeCD67Pour_(e.dateStr); if (p) ds = p.datePaiementAttendue; } catch (errCD67) {}
  }
  if (!ds) ds = compute11thNextMonth_(e.dateStr);
  const d = parseDate_(ds);
  if (!d) return;
  const du = restePaiement_(e);
  if (d < AUJ) { retardMontant += du; retardNb++; return; }
  if (!parDate[ds]) parDate[ds] = { date: ds, _d: d, montant: 0, nb: 0 };
  parDate[ds].montant += du;
  parDate[ds].nb++;
  });
  const echeances = Object.keys(parDate).map(function (k) { return parDate[k]; })
  .sort(function (a, b) { return a._d - b._d; });
  const joursDepuisAuj = function (d) { return Math.round((d - AUJ) / 86400000); };
  let cumul = 0;
  const echeancesOut = echeances.map(function (x) {
  cumul += x.montant;
  return { date: x.date, jours: joursDepuisAuj(x._d), montant: round2_(x.montant), nb: x.nb, cumul: round2_(cumul) };
  });
  const dansFenetre = function (n) {
  return round2_(echeances.filter(function (x) { return joursDepuisAuj(x._d) <= n; })
  .reduce(function (t, x) { return t + x.montant; }, 0));
  };
  const p0 = echeancesOut[0] || null;
  return {
  a_percevoir_total: round2_(enAttente.reduce(function (t, e) { return t + restePaiement_(e); }, 0)),
  horizon: { j30: dansFenetre(30), j60: dansFenetre(60), j90: dansFenetre(90) },
  prochaine: p0 ? { date: p0.date, jours: p0.jours, montant: p0.montant, nb: p0.nb } : null,
  en_retard: { montant: round2_(retardMontant), nb: retardNb },
  echeances: echeancesOut,
  note: "Encaissements attendus sur les missions non perçues (hors bénévolat). Date = échéancier CD67 / 10 du mois suivant. « En retard » = échéance dépassée, toujours à recevoir."
  };
  }
  function calculerComparaisonSaisonN1_(seasonFilter, enriched) {
  const saisonEnCours = cfSaisonEnCours_();
  const cible = (!seasonFilter || seasonFilter === "Toutes les saisons") ? saisonEnCours : seasonFilter;
  if (cible !== saisonEnCours) {
  return { disponible: false, raison: "Comparaison disponible seulement sur la saison en cours.", saison_courante: cible };
  }
  const anDebut = Number(String(cible).split("/")[0]);
  if (!anDebut) return { disponible: false, raison: "Saison illisible." };
  const precedente = (anDebut - 1) + "/" + anDebut;
  const AUJ = new Date(); AUJ.setHours(0, 0, 0, 0);
  const borneN1 = new Date(AUJ.getFullYear() - 1, AUJ.getMonth(), AUJ.getDate());
  const jourSaison = (typeof jourDeSaison_ === "function") ? jourDeSaison_(AUJ) : null;
  const cumuler = function (saison, borne) {
  const sel = enriched.filter(function (e) { return e.season === saison && e.date && e.date <= borne; });
  return {
  missions: sel.length,
  net_reel: round2_(sel.reduce(function (t, e) { return t + e.netReel; }, 0)),
  indemnite: round2_(sel.reduce(function (t, e) { return t + e.indemnite; }, 0)),
  km: round2_(sel.reduce(function (t, e) { return t + e.kmAR; }, 0))
  };
  };
  const courante = cumuler(cible, AUJ);
  const preced = cumuler(precedente, borneN1);
  const pct = function (a, b) { return b > 0 ? round2_(((a - b) / b) * 100) : null; };
  return {
  disponible: preced.missions > 0 || courante.missions > 0,
  saison_courante: cible,
  saison_precedente: precedente,
  jour_saison: jourSaison,
  date_reference: cfFmtDateFr_(AUJ),
  date_reference_n1: cfFmtDateFr_(borneN1),
  courante: courante,
  precedente: preced,
  delta: {
  missions: courante.missions - preced.missions,
  net_reel: round2_(courante.net_reel - preced.net_reel),
  net_reel_pct: pct(courante.net_reel, preced.net_reel),
  indemnite_pct: pct(courante.indemnite, preced.indemnite)
  },
  note: "Saison " + precedente + " arrêtée au " + cfFmtDateFr_(borneN1) + " (même jour de saison) pour une comparaison à moment égal."
  };
  }
  function cfSaisonEnCours_() {
  const now = new Date();
  const bascule = new Date(now.getFullYear(), 6, 30);
  const y = now >= bascule ? now.getFullYear() : now.getFullYear() - 1;
  return y + "/" + (y + 1);
  }
  function cfFmtDateFr_(d) {
  if (!d) return "";
  const p = function (n) { return String(n).padStart(2, "0"); };
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
  }
  function aggregate_(arr, keyFn) {
  const map = {};
  arr.forEach(e => {
  const key = String(keyFn(e) || "").trim();
  if (!key || key === "Sans date") return;
  if (!map[key]) map[key] = {
  label: key,
  count: 0,
  indemnite: 0,
  cout_reel: 0,
  net_reel: 0,
  km: 0
  };
  map[key].count++;
  map[key].indemnite += e.indemnite || 0;
  map[key].cout_reel += e.coutReel || 0;
  map[key].net_reel += e.netReel || 0;
  map[key].km += e.kmAR || 0;
  });
  return Object.values(map)
  .map(m => ({
  label: m.label,
  count: m.count,
  indemnite: round2_(m.indemnite),
  cout_reel: round2_(m.cout_reel),
  net_reel: round2_(m.net_reel),
  km: round2_(m.km)
  }))
  .sort((a, b) => b.count - a.count || b.indemnite - a.indemnite);
  }
  function maxByKey_(arr, k) {
  let best = null,
  bv = -Infinity;
  arr.forEach(e => {
  const v = Number(e[k]) || 0;
  if (v > bv) {
  bv = v;
  best = e;
  }
  });
  return bv > 0 ? best : null;
  }
  function minByKey_(arr, k) {
  let best = null,
  bv = Infinity;
  arr.forEach(e => {
  const v = Number(e[k]) || 0;
  if (v < bv) {
  bv = v;
  best = e;
  }
  });
  return best;
  }
  function monthKey_(date) {
  if (!date) return "Sans date";
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }
  function normSeason_(value, dateStr) {
  if (value && value.includes("/")) return value;
  const d = parseDate_(dateStr);
  if (d) {
  const sy = getSeasonStartYear_(d);
  return sy + "/" + (sy + 1);
  }
  return "";
  }
  function num_(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(",", ".").replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
  }
  function round2_(n) {
  return Number((Number(n) || 0).toFixed(2));
  }
  function normUpper_(v) {
  return normalize_(v);
  }
  function detecterDateSuspecte_(filtered) {
  const avecDate = filtered.filter(e => e.delaiJours !== null);
  if (avecDate.length < 5) return "";
  const freq = {};
  avecDate.forEach(e => {
  freq[e.dateReception] = (freq[e.dateReception] || 0) + 1;
  });
  let dateTop = "",
  maxCount = 0;
  Object.entries(freq).forEach(([d, c]) => {
  if (c > maxCount) {
  maxCount = c;
  dateTop = d;
  }
  });
  return (maxCount / avecDate.length >= 0.30) ? dateTop : "";
  }
  function aggregerDelais_(avecDelai) {
  const map = {};
  avecDelai.forEach(e => {
  const key = e.paiementType || "Non précisé";
  if (!map[key]) map[key] = {
  label: key,
  delais: [],
  enRetard: 0
  };
  map[key].delais.push(e.delaiJours);
  if (e.delaiJours > 0) map[key].enRetard++;
  });
  return Object.values(map).map(m => ({
  label: m.label,
  delai_moyen_jours: Math.round(m.delais.reduce((t, d) => t + d, 0) / m.delais.length),
  nb_paiements: m.delais.length,
  nb_en_retard: m.enRetard
  })).sort((a, b) => b.nb_paiements - a.nb_paiements);
  }
  function calculerRegularite_(moisAgg, filtered) {
  const nets = moisAgg.map(m => m.net_reel);
  const n = nets.length;
  if (n < 2) {
  return {
  coefficient_variation: null,
  ecart_type_mensuel: null,
  mois_analyses: n,
  jour_dominant: "",
  repartition_jours: []
  };
  }
  const moyenne = nets.reduce((t, v) => t + v, 0) / n;
  const variance = nets.reduce((t, v) => t + Math.pow(v - moyenne, 2), 0) / n;
  const ecartType = Math.sqrt(variance);
  const coefVariation = moyenne > 0 ? round2_((ecartType / moyenne) * 100) : null;
  // Répartition par jour de semaine (0=dimanche...6=samedi)
  const joursNoms = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const parJour = {};
  filtered.forEach(e => {
  if (e.jourSemaine === null) return;
  const nom = joursNoms[e.jourSemaine];
  if (!parJour[nom]) parJour[nom] = {
  label: nom,
  count: 0,
  net: 0
  };
  parJour[nom].count++;
  parJour[nom].net += e.netReel;
  });
  const repartitionJours = Object.values(parJour)
  .map(j => ({
  label: j.label,
  count: j.count,
  net_reel: round2_(j.net)
  }))
  .sort((a, b) => b.count - a.count);
  return {
  coefficient_variation: coefVariation,
  ecart_type_mensuel: round2_(ecartType),
  mois_analyses: n,
  jour_dominant: repartitionJours.length ? repartitionJours[0].label : "",
  repartition_jours: repartitionJours
  };
  }
  function calculerFidelite_(five) {
  const parSalle = {};
  five.forEach(e => {
  const key = e.salle || "Non renseigné";
  parSalle[key] = (parSalle[key] || 0) + 1;
  });
  const total = five.length;
  const salles = Object.keys(parSalle).filter(k => k !== "Non renseigné");
  const villesUniques = new Set(five.map(e => e.ville).filter(Boolean));
  if (!total) {
  return {
  salles_distinctes: 0,
  villes_distinctes: 0,
  indice_concentration: null,
  salle_principale: null,
  part_salle_principale: null
  };
  }
  const parts = Object.values(parSalle).map(c => c / total);
  const indiceConcentration = round2_(parts.reduce((t, p) => t + p * p, 0) * 100);
  let salleTop = "",
  maxCount = 0;
  Object.entries(parSalle).forEach(([s, c]) => {
  if (c > maxCount) {
  maxCount = c;
  salleTop = s;
  }
  });
  return {
  salles_distinctes: salles.length,
  villes_distinctes: villesUniques.size,
  indice_concentration: indiceConcentration,
  salle_principale: salleTop || null,
  part_salle_principale: salleTop ? round2_((maxCount / total) * 100) : null
  };
  }
  function calculerProjection_(seasonFilter, filtered, totalNetReel, enriched) {
  const saisonActuelle = computeSeason_(formatDate_(new Date()));
  if (seasonFilter && seasonFilter !== saisonActuelle && seasonFilter !== "Toutes les saisons") {
  return null; // saison passée ou différente : pas de projection pertinente
  }
  if (seasonFilter === "Toutes les saisons") return null;
  const [anneeDebut] = saisonActuelle.split("/").map(Number);
  const debut = new Date(anneeDebut, SAISON_DEBUT_MOIS - 1, 1);
  const fin = new Date(anneeDebut + 1, SAISON_FIN_MOIS - 1, 30);
  const aujourdhui = new Date();
  if (aujourdhui < debut || aujourdhui > fin) return null;
  // Jour de saison écoulé (jours depuis le 1er septembre de la saison en cours).
  const jourRef = Math.max(0, Math.round((aujourdhui - debut) / 86400000));
  // MODIFICATION 24/09/2026 — projection DATA-DRIVEN. L'ancienne méthode
  // extrapolait linéairement sur le temps calendaire, ce qui est faux :
  // l'activité d'un arbitre n'est pas uniforme (rien l'été, pic sept-juin),
  // et diviser par une fraction minuscule en début de saison donnait des
  // montants aberrants (net x14 en septembre). Nouvelle logique :
  // projection = net déjà réalisé + « reste » typique attendu APRÈS ce
  // jour de saison, estimé sur les saisons passées et pondéré par récence
  // (l'activité croît d'année en année, on donne plus de poids aux récentes).
  function jourDeSaison_(d) {
  const y = (d.getMonth() + 1) >= SAISON_DEBUT_MOIS ? d.getFullYear() : d.getFullYear() - 1;
  return Math.round((d - new Date(y, SAISON_DEBUT_MOIS - 1, 1)) / 86400000);
  }
  const resteNet = {}, resteMissions = {};
  (enriched || []).forEach(e => {
  if (!e.date || e.season === saisonActuelle) return;
  if (resteNet[e.season] === undefined) { resteNet[e.season] = 0; resteMissions[e.season] = 0; }
  if (jourDeSaison_(e.date) > jourRef) {
  resteNet[e.season] += (Number(e.netReel) || 0);
  resteMissions[e.season] += 1;
  }
  });
  const saisonsPassees = Object.keys(resteNet).sort(); // ordre chronologique
  function moyennePonderee_(map) {
  if (!saisonsPassees.length) return 0;
  let sommePoids = 0, sommeVal = 0;
  saisonsPassees.forEach((s, i) => { const w = i + 1; sommePoids += w; sommeVal += w * (map[s] || 0); });
  return sommePoids ? sommeVal / sommePoids : 0;
  }
  const projectionNet = round2_(totalNetReel + moyennePonderee_(resteNet));
  const projectionMissions = Math.round(filtered.length + moyennePonderee_(resteMissions));
  // « % réalisé » = part du net projeté déjà encaissée (indicateur d'avancement).
  const pctRealise = projectionNet > 0 ? round2_((totalNetReel / projectionNet) * 100) : 0;
  return {
  saison: saisonActuelle,
  pourcentage_saison_ecoule: pctRealise,
  net_reel_actuel: round2_(totalNetReel),
  net_reel_projete_fin_saison: projectionNet,
  missions_actuelles: filtered.length,
  missions_projetees_fin_saison: projectionMissions
  };
  }
  function classerRentabilite_(filtered) {
  const avecTaux = filtered.filter(e => e.eurParHeure !== 0 && e.kmAR > 0);
  if (avecTaux.length < 3) return {
  top: [],
  bottom: []
  };
  const tries = [...avecTaux].sort((a, b) => a.eurParHeure - b.eurParHeure);
  const n = tries.length;
  const versLigne = (e, rangPercentile) => ({
  lieu: e.recevant || e.salle || "Mission",
  date: e.dateStr,
  format: e.format,
  km: e.kmAR,
  eur_heure: e.eurParHeure,
  net_reel: e.netReel,
  score: Math.round(rangPercentile)
  });
  const withScore = tries.map((e, i) => versLigne(e, (i / (n - 1)) * 100));
  return {
  top: withScore.slice(-5).reverse(),
  bottom: withScore.slice(0, 5)
  };
  }
  function emptyStats_() {
  return {
  season: "",
  totaux: {},
  moyennes: {},
  records: {},
  par_saison: [],
  par_mois: [],
  par_niveau: [],
  top_clubs: [],
  top_salles: [],
  top_villes: [],
  top_collegues: [],
  evenements_3x3: []
  };
  }
  
  // ---------- API ----------
  return {
    calculer(rows, season, env, config) {
      ROWS = rows || []; if (env) ENV = env; if (config) CONFIG = config;
      return buildStatsForApiBrut_(season || "");
    }
  };
})();
if (typeof module !== "undefined") module.exports = RT_STATS;
