/* rt-paiements.js — GÉNÉRÉ depuis Paiement.gs + Echeancier.gs (test/build-rt-paiements.js).
   Ne pas modifier à la main. Moteur de paiement exécuté dans le navigateur :
   même code que le serveur, la feuille Google est remplacée par une feuille
   virtuelle en mémoire. Aucun secret ici. */
const RT_PAIEMENTS = (function () {
  "use strict";
  // ---------- feuille virtuelle ----------
  let HEADERS_ = [], DATA_ = [];
  function colsMax_() { return Math.max(HEADERS_.length, ...DATA_.map(r => r.length), 1); }
  function range_(r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    const lire = () => { const out = []; for (let i = 0; i < nr; i++) { const ligne = r + i === 1 ? HEADERS_ : (DATA_[r + i - 2] || []); const l = []; for (let j = 0; j < nc; j++) { const v = ligne[c + j - 1]; l.push(v === undefined ? "" : v); } out.push(l); } return out; };
    const ecrire = vals => { for (let i = 0; i < vals.length; i++) { let ligne; if (r + i === 1) ligne = HEADERS_; else { while (DATA_.length < r + i - 1) DATA_.push([]); ligne = DATA_[r + i - 2]; } for (let j = 0; j < vals[i].length; j++) ligne[c + j - 1] = vals[i][j]; } };
    return { getValues: lire, getDisplayValues: () => lire().map(l => l.map(v => v == null ? "" : String(v))), setValues: ecrire, getValue: () => lire()[0][0], setValue: v => ecrire([[v]]), setDataValidation() { return this; }, setNumberFormat() { return this; } };
  }
  const SHEET_ = { getRange: range_, getLastColumn: colsMax_, getLastRow: () => DATA_.length + 1, getMaxRows: () => DATA_.length + 1, getName: () => "MATCHS" };
  // ---------- shims Apps Script ----------
  const SpreadsheetApp = { openById: () => ({ getSheetByName: () => SHEET_ }), newDataValidation: () => { const b = { requireValueInList() { return b; }, setAllowInvalid() { return b; }, build() { return b; } }; return b; } };
  const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {}, tryLock() { return true; } }) };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) };
  const Logger = { log() {} };
  const RT = undefined; const envoyerNotif_ = undefined;
  // ---------- Echeancier.gs ----------
  /* =====================================================================
     Echeancier.gs — b19 (08/10/2026)
     Dates de paiement attendues des payeurs institutionnels.
     Une seule source de vérité : modifier les tableaux ci-dessous chaque
     saison, rien d'autre. Aucun secret dans ce fichier.
  
     - CD67 (régime cd67)        : échéancier officiel du Comité, payé le 11 du
                                   mois qui suit le mois de la période.
     - Ligue LRGEB (region)      : caisse de péréquation, paiement la semaine qui
                                   suit chaque bloc d'environ 4 week-ends.
     - FFBB CF séniors (federation) : période = mois civil (du 1er au 30/31),
                                   versement au cours du mois suivant.
     La date attendue = jour à partir duquel un paiement manquant est EN RETARD.
     ===================================================================== */
  
  /* CD67 — saison 2026/2027 (échéancier officiel reçu le 08/10/2026).
     [début, fin, date de paiement]. Paiement = 11 du mois suivant la période. */
  var ECH_CD67 = {
    "2026/2027": [
      ["01/09/2026", "27/09/2026", "11/10/2026"],
      ["28/09/2026", "01/11/2026", "11/11/2026"],
      ["02/11/2026", "29/11/2026", "11/12/2026"],
      ["30/11/2026", "31/12/2026", "11/01/2027"],
      ["01/01/2027", "31/01/2027", "11/02/2027"],
      ["01/02/2027", "28/02/2027", "11/03/2027"],
      ["01/03/2027", "28/03/2027", "11/04/2027"],
      ["29/03/2027", "25/04/2027", "11/05/2027"],
      ["26/04/2027", "30/05/2027", "11/06/2027"],
      ["31/05/2027", "13/06/2027", "11/07/2027"]
    ]
  };
  
  /* Ligue LRGEB — [début, fin, lundi de la semaine de paiement].
     2024/2025 : calendrier officiel. 2026/2027 : ESTIMÉ sur le même principe
     (blocs de ~4 week-ends calés sur les vacances zone B 2026/27) en attendant
     le calendrier officiel de la saison — remplacer dès réception. */
  var ECH_LIGUE = {
    "2024/2025": [
      ["09/09/2024", "20/10/2024", "21/10/2024"],
      ["21/10/2024", "24/11/2024", "25/11/2024"],
      ["25/11/2024", "22/12/2024", "23/12/2024"],
      ["23/12/2024", "02/02/2025", "03/02/2025"],
      ["03/02/2025", "23/02/2025", "24/02/2025"],
      ["24/02/2025", "30/03/2025", "31/03/2025"],
      ["31/03/2025", "20/04/2025", "21/04/2025"],
      ["21/04/2025", "25/05/2025", "26/05/2025"],
      ["26/05/2025", "15/06/2025", "16/06/2025"]
    ],
    "2026/2027": [   // ESTIMÉ
      ["01/09/2026", "18/10/2026", "19/10/2026"],
      ["19/10/2026", "22/11/2026", "23/11/2026"],
      ["23/11/2026", "20/12/2026", "21/12/2026"],
      ["21/12/2026", "31/01/2027", "01/02/2027"],
      ["01/02/2027", "07/03/2027", "08/03/2027"],
      ["08/03/2027", "04/04/2027", "05/04/2027"],
      ["05/04/2027", "25/04/2027", "26/04/2027"],
      ["26/04/2027", "30/05/2027", "31/05/2027"],
      ["31/05/2027", "20/06/2027", "21/06/2027"]
    ]
  };
  var ECH_LIGUE_ESTIME = { "2026/2027": true };
  var ECH_LIGUE_MARGE_JOURS = 4;   // virement attendu au plus tard le vendredi de la semaine de paiement
  
  function ech_date_(v) {
    if (!v) return null;
    if (Object.prototype.toString.call(v) === "[object Date]") return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    var s = String(v).trim(), m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function ech_saison_(d) {
    var y = d >= new Date(d.getFullYear(), 6, 30) ? d.getFullYear() : d.getFullYear() - 1;
    return y + "/" + (y + 1);
  }
  function ech_cherche_(table, d) {
    var lignes = table[ech_saison_(d)];
    if (!lignes) return null;
    for (var i = 0; i < lignes.length; i++) {
      var deb = ech_date_(lignes[i][0]), fin = ech_date_(lignes[i][1]);
      if (d >= deb && d <= fin) return { periode: i + 1, debut: deb, fin: fin, paiement: ech_date_(lignes[i][2]) };
    }
    return null;
  }
  
  /* Renvoie { date: Date, source: "echeancier"|"estime"|"regle" } ou null.
     regime : "cd67" | "region" | "federation". */
  function echeanceInstitutionnelle_(regime, dateMatch) {
    var d = ech_date_(dateMatch);
    if (!d) return null;
    if (regime === "cd67") {
      var p = ech_cherche_(ECH_CD67, d);
      if (p) return { date: p.paiement, source: "echeancier", periode: p.periode };
      return { date: new Date(d.getFullYear(), d.getMonth() + 1, 11), source: "regle" };   // hors échéancier connu
    }
    if (regime === "region") {
      var q = ech_cherche_(ECH_LIGUE, d);
      if (q) {
        var j = new Date(q.paiement); j.setDate(j.getDate() + ECH_LIGUE_MARGE_JOURS);
        return { date: j, source: ECH_LIGUE_ESTIME[ech_saison_(d)] ? "estime" : "echeancier", periode: q.periode };
      }
      var r = new Date(d); r.setDate(r.getDate() + 35);
      return { date: r, source: "regle" };
    }
    if (regime === "federation") {
      // Mois civil du match, versé au cours du mois suivant : en retard après le dernier jour de M+1.
      return { date: new Date(d.getFullYear(), d.getMonth() + 2, 0), source: "regle" };
    }
    return null;
  }
  function echeanceTexte_(regime, dateMatch) {
    var e = echeanceInstitutionnelle_(regime, dateMatch);
    if (!e) return "";
    var p = function (n) { return String(n).padStart(2, "0"); };
    return p(e.date.getDate()) + "/" + p(e.date.getMonth() + 1) + "/" + e.date.getFullYear();
  }
  
  /* Contrôle depuis l'éditeur : affiche la date attendue pour quelques exemples. */
  function TEST_ECHEANCIER() {
    [["cd67", "04/10/2026"], ["cd67", "30/11/2026"], ["region", "10/10/2026"], ["region", "21/11/2026"], ["federation", "17/10/2026"]].forEach(function (x) {
      var e = echeanceInstitutionnelle_(x[0], x[1]);
      Logger.log(x[0] + " · match " + x[1] + " → " + echeanceTexte_(x[0], x[1]) + " (" + e.source + ")");
    });
  }
  
  // ---------- Paiement.gs ----------
  var PAIEMENTS = (function () {
    var SS_ID = "feuille-virtuelle";
    var SHEET_NAME = "MATCHS";
    var MODES = ["", "Espèces", "Chèque", "Virement"];
    var REGIMES = ["", "cd67", "region", "federation", "parts_egales", "recevante", "benevole"];
    // b18 — Ligue / FFBB : « sous 4 week-ends de championnat » ≈ 35 jours.
    var DELAI_INSTITUTIONNEL_JOURS = 35;
    var HEADERS = [
      "Régime", "Date attendue",
      "Attendu recevant", "Reçu recevant", "Mode recevant", "Date reçu recevant",
      "Attendu visiteur", "Reçu visiteur", "Mode visiteur", "Date reçu visiteur",
      "À trancher", "Raison à trancher", "Note paiement", "Statut manuel"
    ];
  
    function norm_(v) {
      return String(v == null ? "" : v)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toUpperCase().replace(/\s+/g, " ").trim();
    }
  
    function key_(v) {
      return norm_(v).replace(/[^A-Z0-9]/g, "");
    }
  
    function nombre_(v) {
      if (v === "" || v === null || v === undefined) return 0;
      var n = Number(String(v).replace(/\s/g, "").replace(",", "."));
      return isFinite(n) ? Math.round(n * 100) / 100 : 0;
    }
  
    function centimes_(v) {
      return Math.round(nombre_(v) * 100);
    }
  
    function safe_(v) { return typeof v === "string" && /^(?:[=@]|[+\-][^\d\s.,()])/.test(v) ? "'" + v : v; }
    function date_(v) {
      if (!v) return null;
      if (v instanceof Date) return isNaN(v) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
      var t = String(v).trim(), m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
      m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);   // accepte aussi « 2026-04-30 0:00:00 »
      if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
      var d = new Date(t);
      return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
  
    function formatDate_(d) {
      if (!(d instanceof Date) || isNaN(d.getTime())) return "";
      var p = function (n) { return String(n).padStart(2, "0"); };
      return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear();
    }
  
    function plusJours_(v, n) {
      var d = date_(v);
      if (!d) return "";
      d.setDate(d.getDate() + n);
      return formatDate_(d);
    }
  
    function sheet_() {
      var sh = SpreadsheetApp.openById(SS_ID).getSheetByName(SHEET_NAME);
      if (!sh) throw new Error("Onglet MATCHS introuvable");
      return sh;
    }
  
    function mapEntetes_(sh) {
      var lastCol = Math.max(sh.getLastColumn(), 1);
      var values = sh.getRange(1, 1, 1, lastCol).getValues()[0];
      var map = {};
      values.forEach(function (h, i) { if (h !== "") map[key_(h)] = i + 1; });
      return map;
    }
  
    function assurerEntetes_(sh) {
      var map = mapEntetes_(sh);
      HEADERS.forEach(function (h) {
        if (!map[key_(h)]) {
          var col = sh.getLastColumn() + 1;
          sh.getRange(1, col).setValue(h);
          map[key_(h)] = col;
        }
      });
      return mapEntetes_(sh);
    }
  
    function val_(row, map, nom) {
      var c = map[key_(nom)];
      return c ? row[c - 1] : "";
    }
  
    function set_(row, map, nom, valeur) {
      var c = map[key_(nom)];
      if (c) row[c - 1] = valeur;
    }
  
    function regimeDepuis_(row, map, ignorerBenevole) {
      var statut = norm_(val_(row, map, "Statut paiement"));
      if (!ignorerBenevole && statut === "BENEVOLE") return "benevole";
  
      var par = norm_(val_(row, map, "Indemnisé par"));
      var type = norm_(val_(row, map, "Paiement Type"));
      var niveau = norm_(val_(row, map, "Niveau administratif"));
      var texte = par + " " + type;
  
      if (texte.indexOf("PARTS EGALES") !== -1) return "parts_egales";
      if (texte.indexOf("ASSOCIATION RECEVANTE") !== -1 || texte.indexOf("PAIEMENT CLUB") !== -1) return "recevante";
      if (texte.indexOf("FEDERATION") !== -1) return "federation";
      if (texte.indexOf("LIGUE") !== -1 || texte.indexOf("REGION") !== -1) return "region";
      if (texte.indexOf("COMITE DEPARTEMENTAL") !== -1 || texte.indexOf("DEPARTEMENTAL") !== -1 || texte.indexOf("CD67") !== -1) return "cd67";
  
      if (texte.indexOf("CAISSE DE PEREQUATION") !== -1) {
        if (niveau.indexOf("FRANCE") !== -1 || niveau.indexOf("NATIONAL") !== -1) return "federation";
        if (niveau.indexOf("REGION") !== -1 || niveau.indexOf("PRE-NATIONAL") !== -1) return "region";
        if (niveau.indexOf("DEPART") !== -1) return "cd67";
      }
      return "";
    }
  
    function repartition_(regime, total) {
      var cents = centimes_(total);
      if (regime === "parts_egales") {
        var r = Math.floor(cents / 2);
        return { recevant: r / 100, visiteur: (cents - r) / 100 };
      }
      return { recevant: cents / 100, visiteur: 0 };
    }
  
    function dateAttendue_(row, map, regime, modeR, modeV) {
      var existante = val_(row, map, "Date paiement") || val_(row, map, "Date attendue");
      if (regime === "cd67" || regime === "region" || regime === "federation") {
        // b19 — l'échéancier officiel (Echeancier.gs) prime sur toute date stockée.
        if (typeof echeanceTexte_ === "function") {
          var ech = echeanceTexte_(regime, val_(row, map, "Date match"));
          if (ech) return ech;
        }
        if (existante) return formatDate_(date_(existante));
        // b18 — repli : sans date lue sur la convocation, la mission n'avait
        // jamais d'échéance, donc ne passait jamais « En retard ».
        var dm = val_(row, map, "Date match");
        if (regime === "cd67") {
          var d0 = date_(dm);
          return d0 ? formatDate_(new Date(d0.getFullYear(), d0.getMonth() + 1, 11)) : "";
        }
        return plusJours_(dm, DELAI_INSTITUTIONNEL_JOURS);
      }
      if (regime === "recevante" || regime === "parts_egales") {
        var match = val_(row, map, "Date match");
        var aVirement = norm_(modeR).indexOf("VIREMENT") !== -1 || norm_(modeV).indexOf("VIREMENT") !== -1;
        var modeManquant = !String(modeR || "").trim() || (regime === "parts_egales" && !String(modeV || "").trim());
        // Délai club : J+1 est le premier jour, fin du délai à J+4,
        // warning manuel à partir de J+5.
        return aVirement || modeManquant ? plusJours_(match, 4) : formatDate_(date_(match));
      }
      return "";
    }
  
    function estEchu_(dateAttendue) {
      var d = date_(dateAttendue);
      if (!d) return false;
      d.setHours(23, 59, 59, 999);
      return new Date().getTime() > d.getTime();
    }
  
    function calculer_(data) {
      if (data.benevole) {
        return { statut: "Bénévole", aTrancher: "", raison: "", totalRecu: 0, retard: false };
      }
      if (!data.regime) {
        return { statut: "À vérifier", aTrancher: "Oui", raison: "Régime de paiement à choisir", totalRecu: data.recuR + data.recuV, retard: false };
      }
      var du = centimes_(data.total);
      var recu = centimes_(data.recuR) + centimes_(data.recuV);
      var retard = estEchu_(data.dateAttendue) && recu < du;
      var raisons = [];
      if (recu < du && (data.regime === "recevante" || data.regime === "parts_egales") && !data.modeR) raisons.push("Mode recevant à choisir");
      if (recu < du && data.regime === "parts_egales" && !data.modeV) raisons.push("Mode visiteur à choisir");
      if (data.forceVerifier) raisons.push("Vérification manuelle demandée");
      if (recu > du) raisons.push("Montant reçu supérieur au montant dû");
  
      var statut = "À recevoir";
      if (data.forceVerifier || recu > du) statut = "À vérifier";
      else if (du > 0 && recu === du) statut = "Reçu";
      else if (recu > 0) statut = "Reçu partiel";
      else if (retard) statut = "En retard";
  
      return {
        statut: statut,
        aTrancher: raisons.length ? "Oui" : "",
        raison: raisons.join(" | "),
        totalRecu: recu / 100,
        retard: retard
      };
    }
  
    function invaliderCache_() {
      try {
        var p = PropertiesService.getScriptProperties();
        var v = Number(p.getProperty("RT_CACHE_V") || "1");
        p.setProperty("RT_CACHE_V", String(v + 1));
      } catch (e) { /* optimisation uniquement */ }
    }
  
    function appliquerValidations_(sh, map) {
      var maxRows = Math.max(sh.getMaxRows() - 1, 1);
      var cModeR = map[key_("Mode recevant")];
      var cModeV = map[key_("Mode visiteur")];
      var cRegime = map[key_("Régime")];
      if (cModeR) sh.getRange(2, cModeR, maxRows, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(MODES.filter(String), true).setAllowInvalid(false).build()
      );
      if (cModeV) sh.getRange(2, cModeV, maxRows, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(MODES.filter(String), true).setAllowInvalid(false).build()
      );
      if (cRegime) sh.getRange(2, cRegime, maxRows, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(REGIMES.filter(String), true).setAllowInvalid(false).build()
      );
    }
  
    function installerEtMigrer() {
      var sh = sheet_();
      var map = assurerEntetes_(sh);
      appliquerValidations_(sh, map);
      var lastRow = sh.getLastRow();
      if (lastRow < 2) return { lignes: 0, migrees: 0, preservees: 0 };
  
      var lastCol = sh.getLastColumn();
      var rows = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
      var migrees = 0, preservees = 0;
  
      rows.forEach(function (row) {
        if (!String(val_(row, map, "UID") || "").trim()) return;
        if (norm_(val_(row, map, "Format")) === "ALERTE") return;
  
        var statutAvant = String(val_(row, map, "Statut paiement") || "").trim();
        var ferme = statutAvant === "Reçu" || statutAvant === "Bénévole";
        var regime = String(val_(row, map, "Régime") || "").trim() || regimeDepuis_(row, map);
        var total = nombre_(val_(row, map, "Indemnité totale"));
        var rep = repartition_(regime, total);
        var modeAncien = String(val_(row, map, "Mode paiement") || "").trim();
        var modeR = String(val_(row, map, "Mode recevant") || "").trim() || modeAncien;
        var modeV = String(val_(row, map, "Mode visiteur") || "").trim();
  
        set_(row, map, "Régime", regime);
        if (val_(row, map, "Attendu recevant") === "") set_(row, map, "Attendu recevant", rep.recevant);
        if (val_(row, map, "Attendu visiteur") === "") set_(row, map, "Attendu visiteur", rep.visiteur);
        if (!val_(row, map, "Mode recevant") && modeR) set_(row, map, "Mode recevant", modeR);
        if (!val_(row, map, "Date attendue")) set_(row, map, "Date attendue", dateAttendue_(row, map, regime, modeR, modeV));
  
        if (ferme) {
          preservees++;
          if (statutAvant === "Reçu") {
            var dejaRecu = nombre_(val_(row, map, "Montant reçu"));
            if (!dejaRecu) dejaRecu = total;
            if (!nombre_(val_(row, map, "Reçu recevant")) && !nombre_(val_(row, map, "Reçu visiteur"))) {
              set_(row, map, "Reçu recevant", dejaRecu);
              set_(row, map, "Date reçu recevant", val_(row, map, "Date réception") || "");
            }
          }
          if (statutAvant === "Bénévole") set_(row, map, "Régime", "benevole");
          return;
        }
  
        // Statut forcé manuellement : on ne recalcule pas, on le préserve.
        var manuelExistant = String(val_(row, map, "Statut manuel") || "").trim();
        if (manuelExistant) {
          set_(row, map, "Statut paiement", manuelExistant);
          migrees++;
          return;
        }
  
        var calc = calculer_({
          regime: regime,
          benevole: false,
          total: total,
          recuR: nombre_(val_(row, map, "Reçu recevant")) || nombre_(val_(row, map, "Montant reçu")),
          recuV: nombre_(val_(row, map, "Reçu visiteur")),
          modeR: modeR,
          modeV: modeV,
          dateAttendue: val_(row, map, "Date attendue")
        });
        set_(row, map, "Statut paiement", calc.statut);
        set_(row, map, "Montant reçu", calc.totalRecu || "");
        set_(row, map, "À trancher", calc.aTrancher);
        set_(row, map, "Raison à trancher", calc.raison);
        migrees++;
      });
  
      sh.getRange(2, 1, rows.length, lastCol).setValues(rows);
      invaliderCache_();
      return { lignes: rows.length, migrees: migrees, preservees: preservees };
    }
  
    function trouverLigne_(sh, map, uid) {
      var c = map[key_("UID")];
      if (!c) throw new Error("Colonne UID introuvable");
      var lastRow = sh.getLastRow();
      if (lastRow < 2) throw new Error("Aucun match");
      var ids = sh.getRange(2, c, lastRow - 1, 1).getDisplayValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(uid).trim()) return i + 2;
      }
      throw new Error("UID introuvable : " + uid);
    }
  
    // Verrou : deux écritures simultanées (validation en série du rapprochement bancaire,
    // double clic, plusieurs onglets) ne doivent jamais s'écraser sur la même ligne.
    function mettreAJour(params) {
      var verrou = LockService.getScriptLock();
      verrou.waitLock(20000);
      try { return mettreAJourSansVerrou_(params); }
      finally { verrou.releaseLock(); }
    }
  
    function mettreAJourSansVerrou_(params) {
      params = params || {};
      if (!params.uid) throw new Error("UID manquant");
      var sh = sheet_();
      var map = assurerEntetes_(sh);
      var rowNumber = trouverLigne_(sh, map, params.uid);
      var lastCol = sh.getLastColumn();
      var row = sh.getRange(rowNumber, 1, 1, lastCol).getValues()[0];
  
      var ancienStatut = String(val_(row, map, "Statut paiement") || "");
      var benevole = String(params.benevole || "") === "1";
      var retirerBenevole = String(params.benevole || "") === "0";
      var regime = String(params.regime || val_(row, map, "Régime") || regimeDepuis_(row, map)).trim();
      if (benevole) regime = "benevole";
      if (retirerBenevole && regime === "benevole") regime = regimeDepuis_(row, map, true) || "";
      if (REGIMES.indexOf(regime) === -1) throw new Error("Régime non autorisé : " + regime);
  
      var total = nombre_(val_(row, map, "Indemnité totale"));
      var rep = repartition_(regime, total);
      var recuR = params.recu_recevant !== undefined ? nombre_(params.recu_recevant) : nombre_(val_(row, map, "Reçu recevant"));
      var recuV = params.recu_visiteur !== undefined ? nombre_(params.recu_visiteur) : nombre_(val_(row, map, "Reçu visiteur"));
      var modeR = params.mode_recevant !== undefined ? String(params.mode_recevant) : String(val_(row, map, "Mode recevant") || val_(row, map, "Mode paiement") || "");
      var modeV = params.mode_visiteur !== undefined ? String(params.mode_visiteur) : String(val_(row, map, "Mode visiteur") || "");
      if (MODES.indexOf(modeR) === -1 || MODES.indexOf(modeV) === -1) throw new Error("Mode de paiement non autorisé");
  
      var dateR = params.date_recu_recevant !== undefined ? formatDate_(date_(params.date_recu_recevant)) : String(val_(row, map, "Date reçu recevant") || "");
      var dateV = params.date_recu_visiteur !== undefined ? formatDate_(date_(params.date_recu_visiteur)) : String(val_(row, map, "Date reçu visiteur") || "");
      var aujourdHui = formatDate_(new Date());
      var dateMarquage = params.date_reception ? formatDate_(date_(params.date_reception)) : aujourdHui;
      if (recuR > 0 && !dateR) dateR = aujourdHui;
      if (recuV > 0 && !dateV) dateV = aujourdHui;
      if (recuR === 0) dateR = "";
      if (recuV === 0) dateV = "";
  
      // Action rapide du monde institutionnel : le montant exact est prérempli.
      if (String(params.marquer_recu || "") === "1") {
        recuR = total;
        recuV = 0;
        // La date réelle du virement (date_recu_recevant) prime sur la date de marquage.
        dateR = params.date_recu_recevant ? (formatDate_(date_(params.date_recu_recevant)) || dateMarquage || aujourdHui) : (dateMarquage || aujourdHui);
        if (!modeR) modeR = "Virement";
      }
  
      var dateAttendue = dateAttendue_(row, map, regime, modeR, modeV);
      var calc = calculer_({
        regime: regime,
        benevole: benevole || (!retirerBenevole && ancienStatut === "Bénévole"),
        total: total,
        recuR: recuR,
        recuV: recuV,
        modeR: modeR,
        modeV: modeV,
        dateAttendue: dateAttendue,
        forceVerifier: String(params.a_verifier || "") === "1"
      });
  
      // --- Statut manuel (01/10/2026) : verrou utilisateur sur le statut ---
      // Le front envoie forcer_statut=<statut> pour verrouiller, ou
      // liberer_statut=1 pour rendre la main au calcul automatique.
      var STATUTS_MANUELS = ["À recevoir", "Reçu partiel", "Reçu", "À vérifier", "En retard", "Bénévole"];
      var manuel = String(val_(row, map, "Statut manuel") || "").trim();
      if (String(params.liberer_statut || "") === "1") {
        manuel = "";
      } else if (params.forcer_statut !== undefined && String(params.forcer_statut).trim() !== "") {
        var fStatut = String(params.forcer_statut).trim();
        if (STATUTS_MANUELS.indexOf(fStatut) === -1) throw new Error("Statut manuel non autorisé : " + fStatut);
        manuel = fStatut;
      }
      var statutFinal = manuel || calc.statut;
      var aTrFinal = calc.aTrancher, raisonFinal = calc.raison;
      if (manuel) {
        aTrFinal = (manuel === "À vérifier") ? "Oui" : "";
        raisonFinal = (manuel === "À vérifier") ? "Vérification manuelle" : "Statut forcé manuellement";
      }
  
      set_(row, map, "Régime", calc.statut === "Bénévole" ? "benevole" : regime);
      set_(row, map, "Date attendue", calc.statut === "Bénévole" ? "" : dateAttendue);
      set_(row, map, "Attendu recevant", calc.statut === "Bénévole" ? 0 : rep.recevant);
      set_(row, map, "Attendu visiteur", calc.statut === "Bénévole" ? 0 : rep.visiteur);
      set_(row, map, "Reçu recevant", calc.statut === "Bénévole" ? 0 : recuR);
      set_(row, map, "Reçu visiteur", calc.statut === "Bénévole" ? 0 : recuV);
      set_(row, map, "Mode recevant", calc.statut === "Bénévole" ? "" : modeR);
      set_(row, map, "Mode visiteur", calc.statut === "Bénévole" ? "" : modeV);
      set_(row, map, "Date reçu recevant", calc.statut === "Bénévole" ? "" : dateR);
      set_(row, map, "Date reçu visiteur", calc.statut === "Bénévole" ? "" : dateV);
      set_(row, map, "Statut paiement", statutFinal);
      set_(row, map, "Statut manuel", manuel);
      set_(row, map, "Montant reçu", calc.totalRecu || 0);
      set_(row, map, "Date réception", calc.totalRecu > 0 ? (dateV || dateR || aujourdHui) : "");
      set_(row, map, "À trancher", aTrFinal);
      set_(row, map, "Raison à trancher", raisonFinal);
      if (params.note !== undefined) set_(row, map, "Note paiement", safe_(String(params.note || "").trim().slice(0, 500)));
      set_(row, map, "Dernière MAJ", new Date());
  
      sh.getRange(rowNumber, 1, 1, lastCol).setValues([row]);
      invaliderCache_();
      return {
        uid: String(params.uid),
        rowNumber: rowNumber,
        statut: statutFinal,
        statutManuel: manuel,
        regime: calc.statut === "Bénévole" ? "benevole" : regime,
        montantRecu: calc.totalRecu,
        retard: calc.retard,
        aTrancher: calc.aTrancher,
        raison: calc.raison
      };
    }
  
    /* b18 — RECALCUL AUTOMATIQUE QUOTIDIEN.
       Avant : le statut n'était recalculé qu'au moment où tu cliquais sur une
       mission. Une mission « À recevoir » dont l'échéance passait restait
       « À recevoir » dans le Sheet (seul l'affichage la voyait en retard), et
       les convocations importées sans régime ni date attendue n'étaient jamais
       complétées. Désormais, chaque matin :
         - complète régime, attendus et date attendue manquants ;
         - recalcule le statut des missions ouvertes (jamais Reçu, Bénévole,
           Annulé, Alerte ni statut forcé à la main) ;
         - n'écrit QUE si quelque chose change, en une seule écriture ;
         - renvoie la liste des missions qui viennent de passer en retard. */
    function recalculerTout() {
      var verrou = LockService.getScriptLock();
      verrou.waitLock(30000);
      try {
        var sh = sheet_();
        var map = assurerEntetes_(sh);
        var lastRow = sh.getLastRow();
        if (lastRow < 2) return { lignes: 0, modifiees: 0, nouveauxRetards: [] };
        var lastCol = sh.getLastColumn();
        var rng = sh.getRange(2, 1, lastRow - 1, lastCol);
        var rows = rng.getValues();
        var modifiees = 0, nouveauxRetards = [], completees = 0;
        var auj = new Date(); auj.setHours(0, 0, 0, 0);
  
        rows.forEach(function (row) {
          if (!String(val_(row, map, "UID") || "").trim()) return;
          if (norm_(val_(row, map, "Format")) === "ALERTE") return;
          if (/ANNUL|IGNOR/.test(norm_(val_(row, map, "Statut")))) return;
          var statutAvant = String(val_(row, map, "Statut paiement") || "").trim();
          if (statutAvant === "Reçu" || statutAvant === "Bénévole") return;
          if (String(val_(row, map, "Statut manuel") || "").trim()) return;
          if (/VERIFICATION MANUELLE/.test(norm_(val_(row, map, "Raison à trancher")))) return;
  
          var avant = JSON.stringify(row);
          // b21 — date de match au format brut (« 2026-04-30 0:00:00 ») : normalisée en jj/mm/aaaa.
          var dmBrut = val_(row, map, "Date match");
          if (typeof dmBrut === "string" && /^\d{4}-\d{2}-\d{2}/.test(dmBrut)) { var dmN = date_(dmBrut); if (dmN) set_(row, map, "Date match", formatDate_(dmN)); }
          var regime = String(val_(row, map, "Régime") || "").trim() || regimeDepuis_(row, map);
          var total = nombre_(val_(row, map, "Indemnité totale"));
          var rep = repartition_(regime, total);
          var modeR = String(val_(row, map, "Mode recevant") || val_(row, map, "Mode paiement") || "").trim();
          var modeV = String(val_(row, map, "Mode visiteur") || "").trim();
          if (MODES.indexOf(modeR) === -1) modeR = "";
          if (MODES.indexOf(modeV) === -1) modeV = "";
  
          if (regime && !String(val_(row, map, "Régime") || "").trim()) { set_(row, map, "Régime", regime); completees++; }
          if (val_(row, map, "Attendu recevant") === "" && regime) set_(row, map, "Attendu recevant", rep.recevant);
          if (val_(row, map, "Attendu visiteur") === "" && regime) set_(row, map, "Attendu visiteur", rep.visiteur);
          var brutAtt = val_(row, map, "Date attendue");
          var dateAtt = brutAtt instanceof Date ? formatDate_(brutAtt) : String(brutAtt || "").trim();
          // b19 — rétroactif : chaque matin, la date attendue des missions ouvertes
          // CD67 / Ligue / FFBB est réalignée sur l'échéancier en vigueur.
          if ((regime === "cd67" || regime === "region" || regime === "federation") && typeof echeanceTexte_ === "function") {
            var ech = echeanceTexte_(regime, val_(row, map, "Date match"));
            if (ech && ech !== dateAtt) { dateAtt = ech; set_(row, map, "Date attendue", ech); }
          }
          if (!dateAtt && regime) {
            dateAtt = dateAttendue_(row, map, regime, modeR, modeV);
            if (dateAtt) set_(row, map, "Date attendue", dateAtt);
          }
  
          var calc = calculer_({
            regime: regime,
            benevole: false,
            total: total,
            recuR: nombre_(val_(row, map, "Reçu recevant")) || nombre_(val_(row, map, "Montant reçu")),
            recuV: nombre_(val_(row, map, "Reçu visiteur")),
            modeR: modeR, modeV: modeV,
            dateAttendue: dateAtt
          });
          // Un « Écart à vérifier » posé par le relevé FFBB reste en place tant
          // que rien n'a été encaissé : c'est une vraie question à trancher.
          var garderEcart = statutAvant === "Écart à vérifier" && calc.statut !== "Reçu";
          // Mission future : jamais en retard, quoi qu'il arrive.
          var dm = date_(val_(row, map, "Date match"));
          if (dm && dm > auj && calc.statut === "En retard") calc.statut = "À recevoir";
  
          if (!garderEcart) {
            set_(row, map, "Statut paiement", calc.statut);
            set_(row, map, "À trancher", calc.aTrancher);
            set_(row, map, "Raison à trancher", calc.raison);
          }
          if (JSON.stringify(row) !== avant) {
            modifiees++;
            if (!garderEcart && calc.statut === "En retard" && statutAvant !== "En retard") {
              nouveauxRetards.push({
                uid: String(val_(row, map, "UID")),
                date: formatDate_(date_(val_(row, map, "Date match"))),
                code: String(val_(row, map, "Code compétition") || val_(row, map, "Format") || ""),
                reste: Math.max(0, total - (nombre_(val_(row, map, "Reçu recevant")) + nombre_(val_(row, map, "Reçu visiteur"))))
              });
            }
          }
        });
  
        if (modifiees) {
          rng.setValues(rows);
          invaliderCache_();
        }
        return { lignes: rows.length, modifiees: modifiees, completees: completees, nouveauxRetards: nouveauxRetards };
      } finally { verrou.releaseLock(); }
    }
  
    /* b19 — SOLDER LES SAISONS PASSÉES.
       Tous les virements des saisons terminées ont été reçus : chaque mission
       d'une saison antérieure à la saison en cours, encore ouverte, passe en
       « Reçu » pour son montant exact (recevant + visiteur). Date de réception
       = date attendue (ou date du match). Rien n'est supprimé ; Bénévole,
       Annulé, Alerte et lignes à 0 € sont laissés tels quels.
       dryRun=true (défaut) : liste seulement. */
    function solderSaisonsPassees(dryRun) {
      dryRun = dryRun !== false;
      var verrou = LockService.getScriptLock();
      verrou.waitLock(30000);
      try {
        var sh = sheet_();
        var map = assurerEntetes_(sh);
        var lastRow = sh.getLastRow();
        if (lastRow < 2) return { dryRun: dryRun, soldees: [] };
        var lastCol = sh.getLastColumn();
        var rng = sh.getRange(2, 1, lastRow - 1, lastCol);
        var rows = rng.getValues();
        var now = new Date();
        var debut = new Date(now.getFullYear(), 6, 30);           // bascule de saison : 30 juillet
        if (now < debut) debut = new Date(now.getFullYear() - 1, 6, 30);
        var soldees = [], ignorees = 0;
        rows.forEach(function (row) {
          if (!String(val_(row, map, "UID") || "").trim()) return;
          if (norm_(val_(row, map, "Format")) === "ALERTE") return;
          if (/ANNUL|IGNOR/.test(norm_(val_(row, map, "Statut")))) return;
          var dm = date_(val_(row, map, "Date match"));
          if (!dm || dm >= debut) return;
          var st = String(val_(row, map, "Statut paiement") || "").trim();
          if (st === "Reçu" || st === "Bénévole") return;
          var total = nombre_(val_(row, map, "Indemnité totale"));
          if (!(total > 0)) { ignorees++; return; }
          var regime = String(val_(row, map, "Régime") || "").trim() || regimeDepuis_(row, map) || "cd67";
          if (regime === "benevole") return;
          var rep = repartition_(regime, total);
          var brut = val_(row, map, "Date attendue");
          var dRecu = (brut instanceof Date ? formatDate_(brut) : String(brut || "").trim()) || formatDate_(dm);
          soldees.push({ uid: String(val_(row, map, "UID")), date: formatDate_(dm), code: String(val_(row, map, "Code compétition") || val_(row, map, "Format") || ""), montant: total, avant: st || "(vide)" });
          if (dryRun) return;
          set_(row, map, "Régime", regime);
          set_(row, map, "Attendu recevant", rep.recevant);
          set_(row, map, "Attendu visiteur", rep.visiteur);
          set_(row, map, "Reçu recevant", rep.recevant);
          set_(row, map, "Reçu visiteur", rep.visiteur);
          if (!String(val_(row, map, "Mode recevant") || "").trim()) set_(row, map, "Mode recevant", "Virement");
          if (rep.visiteur > 0 && !String(val_(row, map, "Mode visiteur") || "").trim()) set_(row, map, "Mode visiteur", "Virement");
          set_(row, map, "Date reçu recevant", dRecu);
          set_(row, map, "Date reçu visiteur", rep.visiteur > 0 ? dRecu : "");
          set_(row, map, "Montant reçu", total);
          set_(row, map, "Date réception", dRecu);
          set_(row, map, "Statut paiement", "Reçu");
          set_(row, map, "Statut manuel", "");
          set_(row, map, "À trancher", "");
          set_(row, map, "Raison à trancher", "Soldé : saison terminée");
          set_(row, map, "Dernière MAJ", new Date());
        });
        if (!dryRun && soldees.length) { rng.setValues(rows); invaliderCache_(); }
        return { dryRun: dryRun, avant: formatDate_(debut), soldees: soldees, total: soldees.reduce(function (t, x) { return t + x.montant; }, 0), lignesA0: ignorees };
      } finally { verrou.releaseLock(); }
    }
  
    return {
      installerEtMigrer: installerEtMigrer,
      mettreAJour: mettreAJour,
      recalculerTout: recalculerTout,
      solderSaisonsPassees: solderSaisonsPassees
    };
  })();
  // ---------- API ----------
  function charger_(rows) {
    const set = new Set(); rows.forEach(r => Object.keys(r).forEach(k => { if (k.charAt(0) !== "_") set.add(k); }));
    HEADERS_ = [...set];
    DATA_ = rows.map(r => HEADERS_.map(h => r[h] === undefined || r[h] === null ? "" : r[h]));
  }
  function exporter_() { return DATA_.map(l => { const o = {}; HEADERS_.forEach((h, i) => { o[h] = l[i] === undefined ? "" : l[i]; }); return o; }); }
  return {
    /* Met à jour UNE ligne (objet clé = en-tête). Renvoie { result, row } ; row = ligne recalculée. */
    mettreAJour(rowObj, params) { charger_([rowObj]); const result = PAIEMENTS.mettreAJour(params); return { result, row: exporter_()[0] }; },
    /* Recalcule toutes les lignes (équivalent RECALCULER_PAIEMENTS). Renvoie { result, rows }. */
    recalculerTout(rows) { charger_(rows); const result = PAIEMENTS.recalculerTout(); return { result, rows: exporter_() }; },
    echeanceTexte: echeanceTexte_
  };
})();
if (typeof module !== "undefined") module.exports = RT_PAIEMENTS;
