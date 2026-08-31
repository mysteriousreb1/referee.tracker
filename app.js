/****************************************************
 * REFEREE TRACKER — VERSION SÉCURISÉE (27/08/2026)
 *
 * Google Sheet connecté :
 * https://docs.google.com/spreadsheets/d/1euFXtXS7vWVBHGKbY0Wv0X9M4uWwCuC04PmfReZgmFc/edit
 *
 * Google Calendar connecté :
 * 14a0edc54f3b05223c45a259beed853a5013d248fe6ccf81de60bd4a8e4b6407@group.calendar.google.com
 *
 * Fonctions visibles :
 * setup()
 * auto()
 * testMailInstant()
 * testerOcrIsole()
 *
 * ---------------------------------------------------------------------
 * MODIFICATIONS DU 27/08/2026 (sécurité + réglages)
 *
 * A. doGet ne sert plus les données. L'ancien accès en GET les délivrait
 *    à qui connaissait la clé API — laquelle était en clair dans app.js,
 *    sur un dépôt GitHub public. Les données transitent désormais par
 *    doPost (Auth.gs), protégé par un jeton de session.
 *    RT.doGet est conservé tel quel : Auth.gs l'appelle en interne et
 *    lui fournit la clé côté serveur, où elle reste réellement secrète.
 *
 * B. Les réglages modifiables (adresse, véhicules, tarifs) viennent de
 *    Config.gs et sont pilotables depuis l'écran « Mon profil ».
 *    _syncConfig_() les recharge en début de traitement.
 *
 * C. vehicleForDate_ s'appuie sur un HISTORIQUE DATÉ de véhicules :
 *    un match reste calculé avec la voiture en service à SA date.
 *    Changer de voiture n'altère jamais un calcul déjà fait.
 * ---------------------------------------------------------------------
 *
 * CORRECTIONS ANTÉRIEURES (22/07/2026), validées contre 5 vraies
 * convocations : comité, ligue régionale, coupe, amical, observateur.
 *
 * 1. "Niveau administratif" était déduit du CODE de compétition
 *    (regex sur DFU/RMU/etc.) → pour les Coupes (CPE) le code ne
 *    matchait rien, niveau = "" → mauvais calendrier de paiement.
 *    -> Nouveau : déduit de l'ORGANISME émetteur (2e ligne du
 *    document : "COMITE DU ..." / "LIGUE REGIONALE ...") + code
 *    "AMI" pour les amicaux. C'est écrit noir sur blanc dans le
 *    PDF, donc fiable à 100%.
 *
 * 2. Le type et la date de paiement étaient aussi déduits du
 *    niveau administratif → même bug en cascade pour les Coupes.
 *    -> Nouveau : déduits directement du texte littéral
 *    "C. Arbitre INDEMNISES PAR : ..." qui dit explicitement qui
 *    paie (comité / ligue / club recevant).
 *
 * 3. "Observateur :" ne matchait jamais — le vrai libellé FFBB est
 *    "Observateur Arb :". Corrigé.
 *
 * 4. Extraction de l'adresse de la salle fragile : le texte extrait
 *    du PDF est en réalité "entrelacé" (mise en page 2 colonnes lue
 *    par blocs), donc l'adresse n'est pas forcément juste après le
 *    libellé "Adresse de la salle :". Corrigé en cherchant, dans
 *    toute la zone jusqu'à "A. GROUPEMENT SPORTIF RECEVANT", la
 *    ligne qui ressemble vraiment à une adresse (code postal +
 *    ville), au lieu de prendre le texte immédiatement après le
 *    libellé.
 *
 * 5. Un match déjà marqué "Reçu" pouvait être repassé à "À vérifier"
 *    si une convocation MODIFICATIVE du même match était retraitée
 *    et ne retrouvait pas le montant. Corrigé : on ne rétrograde
 *    plus jamais un statut de paiement déjà avancé.
 *    (Les convocations modificatives sont gérées nativement : même
 *    N° de rencontre + même saison = même UID = mise à jour de la
 *    même ligne, pas de doublon. Rien à faire de spécial pour ça.)
 *
 * 6. Le libellé de compétition capturait parfois du texte parasite
 *    en fin de document ("Signature 1er arbitre..."). Corrigé.
 ****************************************************/

function setup() {
  RT.setup();
}

function auto() {
  RT.auto();
}

function testMailInstant() {
  RT.testMailInstant();
}

/**
 * MODIFICATION A — l'accès en GET ne sert plus aucune donnée.
 *
 * Auparavant, cette fonction déléguait à RT2_route puis RT.doGet, qui
 * renvoyaient matchs, salles, collègues et montants à toute requête
 * portant la clé API. Cette clé étant publique, l'endpoint l'était aussi.
 *
 * Les données passent maintenant par doPost (Auth.gs), qui vérifie un
 * jeton de session puis rejoue exactement le même enchaînement en interne.
 */
/**
 * Point d'entrée GET.
 *
 * Le site n'utilise plus cette porte : il passe par doPost (Auth.gs) avec un
 * jeton de session. Elle ne sert plus qu'au skill Claude « arbitrage ».
 *
 * Sécurité : l'ancienne clé "REFEREE_TRACKER_2026_PRIVATE" a été publiée en
 * clair sur GitHub, elle ne peut donc plus servir de laissez-passer. Une clé
 * distincte, stockée dans les propriétés du script (jamais dans le code, jamais
 * dans un dépôt), garde l'entrée. Une fois franchie, la requête est rejouée
 * telle quelle sur la logique d'origine, à qui l'on fournit la clé interne.
 *
 * Sans paramètre `key`, la réponse reste un simple "pong" : aucune donnée.
 */
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  if (!params.key) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, message: "pong", auth: "required" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var attendue = PropertiesService.getScriptProperties().getProperty("RT_CLAUDE_KEY");

  if (!attendue) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: "Accès Claude non configuré — lancer AUTORISER_CLAUDE() dans l'éditeur" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (params.key !== attendue) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: "Clé API invalide" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Requête rejouée à l'identique, la clé interne étant fournie côté serveur.
  // `wkey` passe intact : c'est RT2 qui contrôle les écritures, comme avant.
  var q = {};
  Object.keys(params).forEach(function (k) { q[k] = params[k]; });
  q.key = "REFEREE_TRACKER_2026_PRIVATE";

  var e2 = { parameter: q, parameters: q };

  try {
    if (typeof RT2_route === "function") {
      var v2 = RT2_route(e2);
      if (v2) return v2;
    }
    return RT.doGet(e2);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: String(err && err.message ? err.message : err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * À lancer une fois depuis l'éditeur : génère la clé d'accès du skill Claude,
 * l'enregistre dans les propriétés du script et l'affiche dans le journal.
 * Relancer cette fonction révoque la clé précédente.
 */
function AUTORISER_CLAUDE() {
  var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  var cle = "RTC_";
  for (var i = 0; i < 32; i++) {
    cle += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  PropertiesService.getScriptProperties().setProperty("RT_CLAUDE_KEY", cle);

  Logger.log("=================================================");
  Logger.log("Clé d'accès Claude (read_key) :");
  Logger.log(cle);
  Logger.log("=================================================");
  Logger.log("À recopier dans config.json du skill « arbitrage ».");
  Logger.log("Toute clé précédente est désormais refusée.");
  return cle;
}

/**
 * Marque comme "Reçu" tous les paiements prévus jusqu'à la date indiquée.
 * Modifie les 2 dates ci-dessous puis exécute cette fonction à la main.
 */
function marquerPaiementsRecus() {
  RT.marquerPaiementsRecusJusquA_("01/05/2026", "01/05/2026");
}

/**
 * Complète les kilomètres manquants via OpenStreetMap (gratuit).
 * Lent (~1 ligne/seconde). Traite 20 lignes par exécution par défaut.
 */
function completerKmManquants() {
  RT.backfillKmManquants_(20);
}

/**
 * Récupère le prix E10 moyen actuel autour du domicile (API gouvernementale
 * gratuite) et le met en cache pour valoriser les matchs à venir.
 * Installé automatiquement en hebdomadaire par auto().
 */
function majPrixCarburant() {
  RT.majPrixCarburantActuel_();
}

/**
 * Remplit les colonnes Genre et Catégorie d'âge sur toute la base,
 * à partir du code et du libellé de compétition.
 * Rapide, aucun appel réseau. À lancer une fois après la mise à jour.
 */
function completerGenreEtCategorie() {
  RT.backfillGenreCategorie_();
}

/**
 * Nettoie rétroactivement les noms de clubs déjà enregistrés.
 * Retire la couleur de maillot et le nom du correspondant qui avaient été
 * avalés par l'ancien parser. Idempotent : relançable sans risque.
 */
/**
 * Met à jour la liste déroulante « Statut paiement » de l'onglet MATCHS.
 * À lancer une fois après avoir collé ce fichier — puis à chaque fois
 * qu'un statut est ajouté à PAYMENT_STATUSES.
 *
 * La validation est appliquée sur toute la colonne, lignes futures comprises,
 * et remplace la liste existante sans toucher aux valeurs déjà saisies.
 */
function MAJ_LISTE_STATUTS_PAIEMENT() {
  var statuts = ["À recevoir", "Reçu", "Bénévole", "Écart à vérifier", "À vérifier"];

  // Ce projet Apps Script est autonome : il n'est rattaché à aucun classeur.
  // getActiveSpreadsheet() y renvoie null — on ouvre donc le classeur par son id.
  var ss = SpreadsheetApp.openById("1euFXtXS7vWVBHGKbY0Wv0X9M4uWwCuC04PmfReZgmFc");
  var sheet = ss.getSheetByName("MATCHS");
  if (!sheet) throw new Error("Onglet MATCHS introuvable dans « " + ss.getName() + " »");

  var entetes = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = -1;
  for (var i = 0; i < entetes.length; i++) {
    if (String(entetes[i]).trim().toLowerCase() === "statut paiement") { col = i + 1; break; }
  }
  if (col === -1) throw new Error("Colonne « Statut paiement » introuvable");

  var nbLignes = Math.max(sheet.getMaxRows() - 1, 1);
  var plage = sheet.getRange(2, col, nbLignes, 1);

  var regle = SpreadsheetApp.newDataValidation()
    .requireValueInList(statuts, true)
    .setAllowInvalid(false)
    .setHelpText("Bénévole = arbitré gratuitement en accord avec le club recevant : aucune indemnité attendue.")
    .build();

  plage.setDataValidation(regle);

  // Signale les valeurs déjà présentes qui ne figurent pas dans la liste :
  // elles resteraient affichées mais deviendraient invalides.
  var valeurs = plage.getValues();
  var horsListe = {};
  for (var r = 0; r < valeurs.length; r++) {
    var v = String(valeurs[r][0] || "").trim();
    if (v && statuts.indexOf(v) === -1) horsListe[v] = (horsListe[v] || 0) + 1;
  }

  Logger.log("Liste déroulante appliquée sur %s ligne(s) : %s", nbLignes, statuts.join(" / "));
  var restes = Object.keys(horsListe);
  if (restes.length) {
    Logger.log("ATTENTION — valeurs déjà saisies hors liste :");
    restes.forEach(function (v) { Logger.log("  %s (%s ligne(s))", v, horsListe[v]); });
  } else {
    Logger.log("Aucune valeur existante hors liste.");
  }
}

function nettoyerNomsClubs() {
  RT.backfillNomsClubs_();
}

/**
 * Test isolé de l'OCR, indépendant du reste du système.
 * Prend le PDF le plus récent trouvé dans un mail avec pièce jointe
 * PDF, tente l'OCR, et logue le résultat (succès + extrait de texte,
 * ou l'erreur précise). Ne touche à rien dans le Sheet.
 * À exécuter manuellement depuis l'éditeur Apps Script pour vérifier
 * que le service Drive avancé + OCR fonctionne AVANT de lancer auto().
 */
function testerOcrIsole() {
  const threads = GmailApp.search("has:attachment filename:pdf", 0, 5);

  if (threads.length === 0) {
    Logger.log("Aucun mail avec PDF trouvé.");
    return;
  }

  let attachment = null;
  let foundSubject = "";

  outer:
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      for (const att of msg.getAttachments()) {
        if (/\.pdf$/i.test(att.getName() || "")) {
          attachment = att;
          foundSubject = msg.getSubject();
          break outer;
        }
      }
    }
  }

  if (!attachment) {
    Logger.log("Pas de PDF trouvé dans les 5 threads les plus récents avec pièce jointe.");
    return;
  }

  Logger.log("Mail : " + foundSubject);
  Logger.log("PDF : " + attachment.getName());

  let file;
  try {
    file = Drive.Files.create(
      { name: "TEST_OCR_" + new Date().getTime(), mimeType: MimeType.GOOGLE_DOCS },
      attachment.copyBlob(),
      { ocr: true, ocrLanguage: "fr" }
    );

    const doc = DocumentApp.openById(file.id);
    const text = doc.getBody().getText();

    Logger.log("=== OCR RÉUSSI ===");
    Logger.log(text.substring(0, 800));

    DriveApp.getFileById(file.id).setTrashed(true);

  } catch (e) {
    Logger.log("=== OCR A ÉCHOUÉ ===");
    Logger.log("Message : " + e.message);
    Logger.log("Stack : " + (e.stack || "(non disponible)"));
    Logger.log("");
    Logger.log("Vérifie : Services (icône +) > Drive API doit apparaître dans la liste.");
    Logger.log("Si absent : Services > Ajouter un service > Drive API > Ajouter.");

    if (file && file.id) {
      try { DriveApp.getFileById(file.id).setTrashed(true); } catch (ignore) {}
    }
  }
}

const RT = (() => {
  /*************** CONFIGURATION ***************/

  const SPREADSHEET_ID = "1euFXtXS7vWVBHGKbY0Wv0X9M4uWwCuC04PmfReZgmFc";
  const CALENDAR_ID = "14a0edc54f3b05223c45a259beed853a5013d248fe6ccf81de60bd4a8e4b6407@group.calendar.google.com";
  const API_PRIVATE_KEY = "REFEREE_TRACKER_2026_PRIVATE";

  const REFEREE_NAME_NORM = "REBHOLZ CLEMENT";
  const REFEREE_EMAIL = "gabel.carine@orange.fr";

  // MODIFICATION B — `var` et non `const` : _syncConfig_() les remplace par
  // les valeurs saisies dans « Mon profil ». Ce qui suit sert de repli si
  // Config.gs venait à manquer.
  var START_ADDRESS = "14 Rue des Faisans, 67240 Kaltenhouse";
  var START_COORDS = { lat: 48.8241, lon: 7.8069 }; // Kaltenhouse (fallback si géocodage indispo)
  const FBI_URL = "https://extranet.ffbb.com/fbi/connexion.fbi";

  // ===== VÉHICULES / CARBURANT (modifiable depuis « Mon profil ») =====
  // Le taux FFBB (ce qui est REMBOURSÉ) est fixe : 0,40 €/km, sans lien avec les CV.
  // Le coût RÉEL sert uniquement à calculer le bénéfice net réel.
  var RATE_PER_KM_FFBB = 0.40;

  // Prix du carburant par défaut, utilisé si aucune donnée historique ni temps réel.
  var FUEL_PRICE_PER_L = 1.95;

  // ===== HISTORIQUE DU PRIX E10 (€/L, par mois) =====
  // Sources : archives officielles data.gouv.fr (prix relevés dans les
  // 39-41 stations situées à moins de 15 km de Kaltenhouse), ajustées de
  // -0,058 €/L pour refléter les stations réellement fréquentées, et
  // relevés réels des pleins pour août 2025 → juin 2026.
  // Un mois passé ne change plus : cette table est figée par construction,
  // et reste volontairement dans le code — la rendre modifiable
  // n'ouvrirait que la porte à une corruption de l'historique.
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
    "2026-06": 1.868
  };

  // Prix relevé en temps réel (rempli par majPrixCarburantActuel_), utilisé
  // pour les matchs à venir tant que leur date n'est pas passée.
  const CACHE_PRIX_ACTUEL = "RT_PRIX_E10_ACTUEL";

  // Repli si Config.gs est absent. L'historique réel des véhicules vit
  // désormais dans Config.gs, au format { nom, conso, cv, depuis }.
  var VEHICLES = [
    { name: "Peugeot 108", cutoverBefore: "2026-08-01", consoL100: 6.58, cv: 4 },
    { name: "Audi A3 35 TFSI", consoL100: 6.0, cv: 8 }
  ];

  // Barème kilométrique fiscal 2025 (info seulement, JAMAIS utilisé pour l'indemnité) :
  // d = distance annuelle. Ici on donne juste le coef "par km" simplifié par tranche CV
  // pour un KPI indicatif "équivalent barème fiscal".
  const BAREME_FISCAL_PAR_KM = { 3: 0.529, 4: 0.606, 5: 0.636, 6: 0.665, 7: 0.697, 8: 0.697 };

  // Lieux connus comme étant exclusivement 3x3 (pour les stats)
  const LIEUX_3X3 = ["BASKET CENTER"];

  // Durées forfaitaires (heures) pour le KPI €/heure — trajet ajouté dynamiquement
  const DUREE_MATCH_H = { "5x5": 1.5, "3x3": 6, "default": 1.5 };

  // Usure/entretien du véhicule (pneus, vidanges, décote), hors carburant
  // qui est déjà compté à part. Modifiable depuis « Mon profil » — n'est
  // versé par personne, sert uniquement à calculer un "net réel tout
  // compris" plus honnête.
  var COUT_USURE_PAR_KM = 0.12;

  // kg de CO2 par litre d'E10 (SP95-E10) — valeur ADEME / Base Carbone.
  const CO2_KG_PAR_LITRE_E10 = 2.28;

  // Saison sportive : début (1er septembre) et fin (31 juillet), pour la projection.
  const SAISON_DEBUT_MOIS = 9;  // septembre
  const SAISON_FIN_MOIS = 7;    // juillet (bascule le 30/07, cf getSeasonStartYear_)

  /**
   * MODIFICATION B — recharge les réglages saisis dans « Mon profil ».
   *
   * Apps Script réévalue tout le script à chaque requête : un appel en
   * début de traitement suffit à prendre en compte la dernière config.
   * Si Config.gs est absent, on conserve les valeurs ci-dessus.
   */
  function _syncConfig_() {
    if (typeof CFG === "undefined") return;

    var c = CFG.tout();

    RATE_PER_KM_FFBB  = c.tarifs.indemnite_km;
    COUT_USURE_PAR_KM = c.tarifs.usure_km;
    FUEL_PRICE_PER_L  = c.tarifs.carburant_defaut;

    START_ADDRESS = [c.profil.adresse, c.profil.code_postal, c.profil.ville]
                      .filter(String).join(", ");
    START_COORDS  = { lat: c.profil.lat, lon: c.profil.lon };

    VEHICLES = c.vehicules.map(function (v) {
      return { name: v.nom, consoL100: v.conso, cv: v.cv, depuis: v.depuis };
    });
  }

  const SHEET_MATCHS = "MATCHS";
  const SHEET_LOGS = "LOGS";
  const SHEET_PROCESSED = "PROCESSED_MESSAGES";

  const LABEL_TRAITE = "RefereeTracker_Traite";
  const LABEL_A_VERIFIER = "RefereeTracker_A_Verifier";
  const LABEL_ANOMALIE = "RefereeTracker_Anomalie";

  const MATCH_HEADERS = [
    "UID", "Source", "Format", "Saison", "Statut", "Date match", "Heure/RDV",
    "Niveau administratif", "Type compétition", "Code compétition", "Libellé compétition",
    "Genre", "Catégorie d'âge",
    "N° rencontre", "Recevant", "Visiteur / événement", "Salle", "Adresse", "Ville",
    "Code e-Marque", "Mon rôle", "Collègue nom", "Collègue rôle", "Collègue téléphone",
    "Référent 3x3", "Observateur", "Km A/R stats", "Indemnité totale", "Indemnisé par",
    "Paiement Type", "Date paiement", "Statut paiement", "Date réception", "Montant reçu",
    "Warning général", "Warning finance", "Warning FBI", "Agenda Event ID", "Dernière MAJ",
    "Sujet mail", "Gmail Message ID"
  ];

  const PROCESSED_HEADERS = ["Date traitement", "Processing Key", "Gmail Message ID", "UID", "Statut traitement", "Sujet"];
  /* "Bénévole" : match arbitré gratuitement, en accord avec le club recevant.
     Aucune indemnité n'est due — la ligne ne doit donc jamais apparaître
     dans ce qui reste à encaisser ni dans les retards de paiement. */
  const PAYMENT_STATUSES = ["À recevoir", "Reçu", "Bénévole", "Écart à vérifier", "À vérifier"];

  // Statuts de paiement rangés par "niveau d'avancement" — sert à ne jamais
  // rétrograder un paiement suite au retraitement d'une convocation modificative.
  const PAYMENT_RANK = { "À vérifier": 0, "À recevoir": 1, "Écart à vérifier": 1, "Reçu": 2, "Bénévole": 2 };

  /*************** CACHE DES RÉPONSES API ***************/
  // Chaque appel relisait toute la feuille MATCHS — deux fois pour les stats.
  // On garde le résultat en cache 6 h, invalidé par un numéro de version :
  // toute écriture l'incrémente, les anciennes entrées deviennent
  // inatteignables et expirent seules. Impossible de servir du périmé.
  //
  // CacheService plafonne à 100 Ko par clé : on découpe en tranches.

  const CACHE_VERSION_KEY = "RT_CACHE_V";
  const CACHE_TTL = 21600;          // 6 h, le maximum autorisé
  const CACHE_CHUNK = 90000;        // marge sous la limite de 100 Ko
  var _cacheDejaInvalide = false;   // remis à false à chaque exécution

  function _cacheVersion_() {
    try { return PropertiesService.getScriptProperties().getProperty(CACHE_VERSION_KEY) || "1"; }
    catch (e) { return "1"; }
  }

  /** Rend inatteignable tout ce qui a été mis en cache jusqu'ici. */
  function _cacheInvalider_() {
    if (_cacheDejaInvalide) return;   // une seule fois par exécution
    try {
      const p = PropertiesService.getScriptProperties();
      p.setProperty(CACHE_VERSION_KEY, String(Number(_cacheVersion_()) + 1));
      _cacheDejaInvalide = true;
    } catch (e) { /* le cache n'est qu'une optimisation, jamais bloquant */ }
  }

  function _cacheLire_(nom) {
    try {
      const c = CacheService.getScriptCache();
      const cle = nom + ":" + _cacheVersion_();
      const nb = c.get(cle + ":n");
      if (!nb) return null;

      const clesTranches = [];
      for (var i = 0; i < Number(nb); i++) clesTranches.push(cle + ":" + i);

      const tranches = c.getAll(clesTranches);
      let json = "";
      for (var j = 0; j < Number(nb); j++) {
        const t = tranches[cle + ":" + j];
        if (t === undefined || t === null) return null;   // tranche expirée : on repart du Sheet
        json += t;
      }
      return JSON.parse(json);
    } catch (e) { return null; }
  }

  function _cacheEcrire_(nom, valeur) {
    try {
      const c = CacheService.getScriptCache();
      const cle = nom + ":" + _cacheVersion_();
      const json = JSON.stringify(valeur);

      const paquet = {};
      let nb = 0;
      for (var i = 0; i < json.length; i += CACHE_CHUNK) {
        paquet[cle + ":" + nb] = json.substring(i, i + CACHE_CHUNK);
        nb++;
      }
      if (nb > 40) return valeur;   // volume anormal : on ne met pas en cache

      paquet[cle + ":n"] = String(nb);
      c.putAll(paquet, CACHE_TTL);
    } catch (e) { /* silencieux */ }
    return valeur;
  }

  /*************** FONCTIONS PUBLIQUES ***************/

  function setup() {
    ensureLabels_();
    ensureSheets_();
    log_("SETUP", "Installation terminée");
  }

  function auto() {
    setup();

    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === "testMailInstant") ScriptApp.deleteTrigger(t);
    });

    ScriptApp.newTrigger("testMailInstant").timeBased().everyMinutes(10).create();

    // Prix du carburant : une fois par semaine suffit (il bouge lentement)
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === "majPrixCarburant") ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger("majPrixCarburant").timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();

    majPrixCarburantActuel_();  // première récupération immédiate

    log_("AUTO", "Déclencheurs installés : mails toutes les 10 min, prix carburant chaque lundi");
  }

  function testMailInstant() {
    _syncConfig_();   // MODIFICATION B

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      log_("LOCK", "Traitement déjà en cours");
      return;
    }

    try {
      setup();
      const processedKeys = getProcessedKeys_();
      const threads = GmailApp.search("newer_than:2000d", 0, 100);

      let processed = 0, skipped = 0, warnings = 0, errors = 0;

      for (const thread of threads) {
        const result = processThread_(thread, processedKeys);
        processed += result.processed;
        skipped += result.skipped;
        warnings += result.warnings;
        errors += result.errors;
      }

      log_("TEST/PROCESS", `${processed} élément(s) traité(s), ${skipped} déjà traité(s), ${warnings} warning(s), ${errors} erreur(s)`);
    } catch (e) {
      log_("ERREUR", e.stack || e.message);
      throw e;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Conservée à l'identique. N'est plus atteignable depuis l'extérieur :
   * seul doPost (Auth.gs) l'appelle, après vérification du jeton de session,
   * en lui fournissant la clé API côté serveur.
   */
  function doGet(e) {
    _syncConfig_();   // MODIFICATION B

    const params = e && e.parameter ? e.parameter : {};
    const callback = params.callback || "";

    try {
      if (params.key !== API_PRIVATE_KEY) return apiResponse_({ success: false, error: "Clé API invalide" }, callback);

      const action = params.action || "matchs";
      if (action === "ping") return apiResponse_({ success: true, message: "pong", date: new Date() }, callback);
      if (action === "matchs") return apiResponse_({ success: true, data: getMatchsForApi_() }, callback);
      if (action === "stats") return apiResponse_({ success: true, stats: buildStatsForApi_(params.season || "") }, callback);
      if (action === "config") {
        return apiResponse_({
          success: true,
          config: {
            start_address: START_ADDRESS,
            rate_per_km_ffbb: RATE_PER_KM_FFBB,
            fuel_price_per_l: FUEL_PRICE_PER_L,
            // Prix E10 temps réel relevé autour du domicile. Le front s'en sert
            // pour valoriser les matchs à venir exactement comme le serveur :
            // sans lui, les deux calculs divergent sur toute la saison en cours.
            prix_e10_actuel: lirePrixActuel_() || FUEL_PRICE_PER_L,
            vehicles: VEHICLES,
            lieux_3x3: LIEUX_3X3
          }
        }, callback);
      }
      if (action === "updatePaymentStatus") {
        return apiResponse_({ success: true, result: updatePaymentStatusForApi_(params.uid, params.status) }, callback);
      }
      return apiResponse_({ success: false, error: "Action inconnue" }, callback);
    } catch (err) {
      return apiResponse_({ success: false, error: err.message, stack: err.stack }, callback);
    }
  }

  /*************** GMAIL ***************/

  function processThread_(thread, processedKeys) {
    let processed = 0, skipped = 0, warnings = 0, errors = 0;
    let threadHasProcessed = false, threadHasWarning = false, threadHasError = false;

    const messages = thread.getMessages();

    for (const message of messages) {
      const messageId = message.getId();
      const subject = message.getSubject() || "";
      const body = getMessageText_(message);

      const attachments = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
      let pdfCount = 0;

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        const name = att.getName() || `attachment_${i}`;
        const contentType = String(att.getContentType() || "").toLowerCase();
        const isPdf = /\.pdf$/i.test(name) || contentType.includes("pdf");
        if (!isPdf) continue;

        pdfCount++;
        const processingKey = `${messageId}::PDF::${i}::${name}::${att.getSize()}`;
        if (processedKeys.has(processingKey)) { skipped++; continue; }

        try {
          const pdfText = extractPdfText_(att.copyBlob().setName(name));
          const result = processTextSource_(pdfText, subject, messageId, "PDF", name);
          markProcessed_(processingKey, messageId, result.uid, result.status, subject);
          processedKeys.add(processingKey);
          processed++;
          threadHasProcessed = true;
          if (result.warning) { warnings++; threadHasWarning = true; }
        } catch (e) {
          errors++; threadHasError = true; threadHasProcessed = true;
          const alertRow = buildAlertRow_({ subject, body, messageId, warning: `PDF non reconnu ou erreur OCR (${name}) : ${e.message}` });
          upsertMatch_(alertRow);
          markProcessed_(processingKey, messageId, alertRow["UID"], "ANOMALIE", subject);
          processedKeys.add(processingKey);
          log_("PDF_ERROR", e.stack || e.message);
        }
      }

      if (pdfCount === 0) {
        const processingKey = `${messageId}::BODY`;
        if (processedKeys.has(processingKey)) { skipped++; continue; }

        try {
          const result = processTextSource_(body, subject, messageId, "MAIL", "");
          markProcessed_(processingKey, messageId, result.uid, result.status, subject);
          processedKeys.add(processingKey);
          processed++;
          threadHasProcessed = true;
          if (result.warning) { warnings++; threadHasWarning = true; }
        } catch (e) {
          errors++; threadHasError = true; threadHasProcessed = true;
          const alertRow = buildAlertRow_({ subject, body, messageId, warning: "Erreur traitement mail : " + e.message });
          upsertMatch_(alertRow);
          markProcessed_(processingKey, messageId, alertRow["UID"], "ANOMALIE", subject);
          processedKeys.add(processingKey);
          log_("MAIL_ERROR", e.stack || e.message);
        }
      }
    }

    if (threadHasProcessed) {
      if (threadHasError) thread.addLabel(GmailApp.getUserLabelByName(LABEL_ANOMALIE));
      else if (threadHasWarning) thread.addLabel(GmailApp.getUserLabelByName(LABEL_A_VERIFIER));
      else thread.addLabel(GmailApp.getUserLabelByName(LABEL_TRAITE));
    }

    return { processed, skipped, warnings, errors };
  }

  function processTextSource_(text, subject, messageId, sourceType, sourceName) {
    const full = clean_(subject + " " + text);

    if (is3x3Text_(full)) {
      const row = parse3x3Convocation_(subject, text, messageId, sourceType, sourceName);
      const rowNumber = upsertMatch_(row);
      updateCalendarForRow_(row, rowNumber);
      return { uid: row["UID"], status: row["Warning général"] || row["Warning finance"] ? "A_VERIFIER" : "TRAITE", warning: Boolean(row["Warning général"] || row["Warning finance"]) };
    }

    if (/N°\s*RENCONTRE|N° RENCONTRE|GROUPEMENT SPORTIF RECEVANT/i.test(full)) {
      const row = parse5x5Convocation_(text, subject, messageId, sourceType, sourceName);
      const rowNumber = upsertMatch_(row);
      updateCalendarForRow_(row, rowNumber);
      return { uid: row["UID"], status: row["Warning général"] || row["Warning finance"] ? "A_VERIFIER" : "TRAITE", warning: Boolean(row["Warning général"] || row["Warning finance"] || row["Warning FBI"]) };
    }

    if (isFbiWarningText_(full)) {
      const row = buildFbiWarningRow_(subject, text, messageId);
      upsertMatch_(row);
      return { uid: row["UID"], status: "A_VERIFIER", warning: true };
    }

    if (isCancellationText_(full)) {
      // On tente d'abord l'annulation ciblée : c'est le cas courant, le mail
      // ne contient qu'un numéro de rencontre.
      const numero = extraireNumeroRencontre_(subject + " " + full);
      const indiceDate = extractDateFromText_(subject + " " + full);
      const res = annulerRencontreParNumero_(numero, indiceDate);

      if (res.fait) {
        log_("ANNULATION", "Rencontre " + numero + " annulée (ligne " + res.rowNumber +
             ", " + res.date + ")" + (res.agenda ? " — événement d'agenda supprimé." : " — aucun événement d'agenda à supprimer."));
        return { uid: res.uid, status: "ANNULE", warning: false };
      }

      if (res.raison === "DEJA_ANNULE") {
        log_("ANNULATION", "Rencontre " + numero + " déjà annulée : rien à faire.");
        return { uid: "", status: "ANNULE", warning: false };
      }

      // Identification impossible ou douteuse : on ne devine pas, on alerte.
      log_("ANNULATION", "Annulation non appliquée automatiquement (" +
           (res.raison || "INCONNU") + (numero ? ", n° " + numero : ", aucun numéro lu") + ") — alerte créée.");
      const row = buildCancellationAlertRow_(subject, text, messageId);
      upsertMatch_(row);
      return { uid: row["UID"], status: "A_VERIFIER", warning: true };
    }

    const alertRow = buildAlertRow_({ subject, body: text, messageId, warning: "Mail non reconnu automatiquement" });
    upsertMatch_(alertRow);
    return { uid: alertRow["UID"], status: "A_VERIFIER", warning: true };
  }

  /*************** PARSING 5X5 ***************/

  function parse5x5Convocation_(text, subject, messageId, sourceType, sourceName) {
    const oneLine = String(text || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();

    const main = extractMainMatchLine_(oneLine);
    const date = main.date || "";
    const heure = main.heure || "";
    const numero = main.numero || "";
    const competition = main.competition || "";

    const season = computeSeason_(date);
    const codeCompetition = extractCompetitionCode_(competition);

    // FIX #1 : organisme lu directement dans le texte (ligne juste après
    // l'en-tête), pas deviné à partir du code de compétition.
    const organisme = extractOrganisme_(text);
    const niveauAdmin = classifyNiveau_(codeCompetition, organisme);

    // FIX #7 (27/08/2026) : le nom du club avalait la couleur du maillot ET le
    // nom du correspondant — on voyait « ASA WEYERSHEIM Maillot : GRENAT KAISER
    // ESTELLE » au lieu de « ASA WEYERSHEIM ». On s'arrête désormais aussi sur
    // « Maillot : » et sur le bloc visiteur.
    let receiving = extractBetween_(oneLine, /A\.\s*GROUPEMENT SPORTIF RECEVANT\s*:/i, [
      /Maillot\s*:/i, /Correspondant\s*:/i, /Adresse de la salle\s*:/i,
      /Code\s+e-?Marque/i, /C\.\s*Arbitre/i, /B\.\s*GROUPEMENT SPORTIF VISITEUR/i
    ]);

    let visitor = extractBetween_(oneLine, /B\.\s*GROUPEMENT SPORTIF VISITEUR\s*:/i, [
      /Maillot\s*:/i, /Adresse de la salle\s*:/i, /Correspondant\s*:/i,
      /A\.\s*GROUPEMENT SPORTIF RECEVANT/i
    ]);

    // FIX #8 : le code officiel prime sur le nom lu dans le PDF.
    receiving = nomClubOfficiel_(oneLine, /A\.\s*GROUPEMENT SPORTIF RECEVANT\s*:/i,
      [/C\.\s*Arbitre/i, /B\.\s*GROUPEMENT SPORTIF VISITEUR/i], receiving);

    visitor = nomClubOfficiel_(oneLine, /B\.\s*GROUPEMENT SPORTIF VISITEUR\s*:/i,
      [/C\.\s*Arbitre/i, /A\.\s*GROUPEMENT SPORTIF RECEVANT/i], visitor);

    // FIX #4 : extraction de salle/adresse robuste au texte "entrelacé"
    // (mise en page 2 colonnes) — cherche la ligne d'adresse (code postal +
    // ville) n'importe où dans la zone, plutôt que juste après le libellé.
    const salleAdresse = extractSalleAdresse_(text);
    const ville = extractVilleFromAddress_(salleAdresse.adresse);

    const emarque = extractEmarque_(oneLine);
    const observer = extractObserver_(oneLine); // FIX #3

    const indemnisedBy = extractIndemnisedBy_(oneLine);
    const officials = extractOfficials_(oneLine);

    const userOfficial = officials.find(isUserOfficial_);
    const colleague = officials.find(o => !isUserOfficial_(o));

    let warningGeneral = "";
    let warningFinance = "";
    let kmAR = "";
    let amount = "";

    if (userOfficial) {
      kmAR = userOfficial.kmAller ? Number(userOfficial.kmAller) * 2 : "";
      amount = userOfficial.indemnity || "";
    } else {
      warningGeneral = addWarning_(warningGeneral, "Bloc arbitre REBHOLZ Clement non trouvé");
    }

    if (!amount) warningFinance = addWarning_(warningFinance, "Indemnité manquante");
    if (!kmAR) warningFinance = addWarning_(warningFinance, "Kilométrage manquant");
    if (!salleAdresse.adresse) warningGeneral = addWarning_(warningGeneral, "Adresse salle manquante");

    // FIX #2 : type + date de paiement déduits directement du texte
    // littéral "INDEMNISES PAR", pas du niveau administratif.
    const paymentClass = classifyPayment_(indemnisedBy);
    let paymentType = paymentClass.type;
    let paymentDate = "";

    if (paymentClass.schedule === "departemental") {
      paymentDate = compute11thNextMonth_(date);
    } else if (paymentClass.schedule === "regional") {
      paymentDate = computeRegionalPaymentDate_(date);
    } else if (paymentClass.schedule === "club") {
      warningFinance = addWarning_(warningFinance, "Paiement club à vérifier");
    } else {
      warningFinance = addWarning_(warningFinance, "Indemniseur non reconnu : " + (indemnisedBy || "(vide)"));
    }

    const uid = `5X5_${season}_${numero || hash_(subject + date + heure + competition)}`;

    return {
      "UID": uid,
      "Source": `${sourceType || "Gmail"}${sourceName ? " / " + sourceName : ""}`,
      "Format": "5x5",
      "Saison": season,
      "Statut": "Actif",
      "Date match": date,
      "Heure/RDV": heure,
      "Niveau administratif": niveauAdmin,
      "Type compétition": codeCompetition === "AMI" ? "Amical" : (codeCompetition === "CPE" ? "Coupe" : "Championnat"),
      "Genre": detecterGenre_(codeCompetition, competition),
      "Catégorie d'âge": detecterCategorie_(codeCompetition, competition),
      "Code compétition": codeCompetition,
      "Libellé compétition": competition,
      "N° rencontre": numero,
      "Recevant": receiving,
      "Visiteur / événement": visitor,
      "Salle": salleAdresse.salle,
      "Adresse": salleAdresse.adresse,
      "Ville": ville,
      "Code e-Marque": emarque,
      "Mon rôle": userOfficial ? userOfficial.role : "",
      "Collègue nom": colleague ? colleague.name : "",
      "Collègue rôle": colleague ? colleague.role : "",
      "Collègue téléphone": colleague ? colleague.phone : "",
      "Référent 3x3": "",
      "Observateur": observer,
      "Km A/R stats": kmAR,
      "Indemnité totale": amount,
      "Indemnisé par": indemnisedBy,
      "Paiement Type": paymentType,
      "Date paiement": paymentDate,
      "Statut paiement": amount ? "À recevoir" : "À vérifier",
      "Date réception": "",
      "Montant reçu": "",
      "Warning général": warningGeneral,
      "Warning finance": warningFinance,
      "Warning FBI": "",
      "Agenda Event ID": "",
      "Dernière MAJ": new Date(),
      "Sujet mail": subject,
      "Gmail Message ID": messageId
    };
  }

  function extractMainMatchLine_(oneLine) {
    // Prend la DERNIÈRE occurrence (le pied de page répète l'en-tête) car le
    // libellé de compétition dans l'en-tête peut être tronqué par une
    // coupure de page/colonne (ex: "(Poule" sans le "A)" qui suit) alors que
    // le pied de page est généralement complet.
    const re = /DATE\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*HEURE\s*:\s*(\d{1,2}:\d{2})\s*N°\s*RENCONTRE\s*:?\s*([0-9]+)\s*COMPETITION\s*:?\s*(.+?)(?=\s+LIGUE REGIONALE|\s+COMITE\s|\s+FEDERATION|\s+REBHOLZ|\s+A\.\s*GROUPEMENT|\s+Signature|$)/ig;

    let match;
    let selected = null;

    while ((match = re.exec(oneLine)) !== null) {
      selected = { date: clean_(match[1]), heure: clean_(match[2]), numero: clean_(match[3]), competition: clean_(match[4]) };
    }

    return selected || { date: "", heure: "", numero: "", competition: "" };
  }

  // NOUVEAU : organisme émetteur = ligne autonome juste après l'en-tête,
  // lu depuis le texte BRUT (retours à la ligne réels), pas depuis la
  // version "aplatie" en une seule ligne.
  function extractOrganisme_(rawText) {
    const lines = String(rawText || "").split(/\r?\n/).map(l => clean_(l)).filter(Boolean);
    const line = lines.find(l => /^(COMITE|LIGUE REGIONALE|FEDERATION)/i.test(l));
    return line || "";
  }

  // NOUVEAU : niveau administratif = organisme émetteur (fiable à 100%,
  // c'est écrit dans le document) + code AMI pour les amicaux qui priment.
  /* Déduit le genre du match depuis le code et le libellé de compétition.
     Structure FFBB : niveau (D/R/N, PR/PN) + genre (M/F/MI) + catégorie.
     Couvre aussi les coupes (CPE U18M, CPE CMUT. SM), finales départementales
     (FD - U11M), opens (OPEN 1 - U15MI) et amicaux (AMI RSF-10).
     Validé à 100 % sur les 154 missions 5x5 de la base au 22/07/2026.
     Renvoie "Masculin", "Féminin", "Mixte", ou "" si indéterminable. */
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

  /* Catégorie d'âge : U11, U13, U15, U17, U18, U20, U21, ou "Séniors".
     (U17 et U20 n'existent plus depuis 3 saisons, mais restent dans l'historique.) */
  function detecterCategorie_(code, libelle) {
    const c = normalize_(code);
    const t = (c + " " + normalize_(libelle)).replace(/[_.]+/g, " ").trim();

    // Ni \b avant le U (collé au genre : DMU18), ni après les chiffres (U18M)
    const m = t.match(/U(\d{2})/);
    if (m) return "U" + m[1];

    if (/\bS(M|F)\b/.test(t) || /\bRS(M|F)\b/.test(t)) return "Séniors";
    if (/^(?:D|R|N)(?:M|F)\d/.test(c)) return "Séniors";   // DM2, RF2, NM1
    if (/^(?:PR|PN)(?:M|F)$/.test(c)) return "Séniors";    // PRM, PNF

    return "";
  }

  function classifyNiveau_(codeCompetition, organisme) {
    const code = normalize_(codeCompetition);
    const org = normalize_(organisme);

    if (/^AMI\b/.test(code)) return "Amical";
    if (org.includes("COMITE")) return "Départemental";
    if (org.includes("LIGUE REGIONALE")) return "Régional";
    if (org.includes("FEDERATION") || org.includes("FFBB")) return "Championnat de France";

    return "";
  }

  function extractCompetitionCode_(competition) {
    const txt = clean_(competition);
    const m = txt.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)?)/i);
    return m ? clean_(m[1]).toUpperCase() : "";
  }

  // NOUVEAU : type + calendrier de paiement déduits du texte littéral
  // "INDEMNISES PAR", plus fiable que de re-déduire depuis le niveau admin.
  function classifyPayment_(indemnisedBy) {
    const v = normalize_(indemnisedBy);

    if (v.includes("COMITE")) return { type: "Paiement départemental", schedule: "departemental" };
    if (v.includes("LIGUE REGIONALE")) return { type: "Caisse de péréquation", schedule: "regional" };
    if (v.includes("ASSOCIATION RECEVANTE") || v.includes("CLUB")) return { type: "Warning paiement club", schedule: "club" };

    return { type: "", schedule: "unknown" };
  }

  // CORRIGÉ : cherche toute la zone entre "Adresse de la salle :" et
  // "A. GROUPEMENT SPORTIF RECEVANT" (le texte y est parfois entrelacé à
  // cause de la mise en page 2 colonnes du PDF), puis repère DANS cette
  // zone la ligne qui ressemble vraiment à une adresse (code postal + ville).
  function extractSalleAdresse_(text) {
    const oneLine = String(text || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();

    const chunk = extractBetween_(oneLine, /Adresse de la salle\s*:/i, [
      /A\.\s*GROUPEMENT SPORTIF RECEVANT/i,
      /Code\s+e-?Marque/i,
      /C\.\s*Arbitre/i
    ]);

    if (!chunk) return { salle: "", adresse: "" };

    const m = chunk.match(/([A-ZÀ-Ÿ0-9][A-ZÀ-Ÿ0-9'".\-\s]{2,80}?\d{5}\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ'\-\s]+?)(?=\s*\(T[ée]l|\s+Correspondant|\s+T[ée]l[ée]phone|$)/i);

    if (!m) return { salle: "", adresse: "" };

    return splitSalleAndAdresse_(clean_(m[1]));
  }

  function splitSalleAndAdresse_(raw) {
    const txt = clean_(raw);

    // Gère aussi les numéros en plage type "4-6 RUE ..."
    const streetStartRegex =
      /\b\d{1,4}(?:\s*-\s*\d{1,4})?\s*(?:BIS|TER)?\s+(?:RUE|AVENUE|AV\.?|BOULEVARD|BD|ROUTE|RTE|CHEMIN|PLACE|IMPASSE|ALL[ÉE]E|ALLEE|QUAI|SQUARE|PASSAGE|ROND[- ]POINT|FAUBOURG|PARC|VOIE)\b/i;

    let m = txt.match(streetStartRegex);
    if (m && m.index > 0) return { salle: clean_(txt.substring(0, m.index)), adresse: clean_(txt.substring(m.index)) };

    const streetNoNumberRegex =
      /\b(?:RUE|AVENUE|AV\.?|BOULEVARD|BD|ROUTE|RTE|CHEMIN|PLACE|IMPASSE|ALL[ÉE]E|ALLEE|QUAI|SQUARE|PASSAGE|ROND[- ]POINT|FAUBOURG|PARC|VOIE)\b/i;

    m = txt.match(streetNoNumberRegex);
    if (m && m.index > 0) return { salle: clean_(txt.substring(0, m.index)), adresse: clean_(txt.substring(m.index)) };

    const postal = txt.match(/\b\d{5}\b/);
    if (postal && postal.index > 0) return { salle: clean_(txt.substring(0, postal.index)), adresse: clean_(txt) };

    return { salle: txt, adresse: txt };
  }

  function extractVilleFromAddress_(adresse) {
    const txt = clean_(adresse);
    let m = txt.match(/\b\d{5}\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\s']+)$/i);
    if (m) return clean_(m[1]);
    m = txt.match(/\b(?:à|a)\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\s']+)$/i);
    if (m) return clean_(m[1]);
    return "";
  }

  function extractOfficials_(oneLine) {
    const text = String(oneLine || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    const sectionMatch = text.match(/C\.\s*Arbitre[\s\S]+$/i);
    if (!sectionMatch) return [];

    const section = sectionMatch[0];
    const officials = [];
    // Arrêt explicite sur "D. OTM" et "E. Evaluateur" (au lieu du générique
    // "OTM" seul) pour ne jamais capturer les blocs OTM/observateur comme
    // s'ils étaient des arbitres.
    const re = /Arbitre\s*:\s*([\s\S]*?)(?=\s+Arbitre\s*:|\s+D\.\s*OTM|\s+E\.\s*Evaluateur|\s+Observateur|\s+Signature|\s+RECU|$)/gi;

    let match;
    let index = 0;

    while ((match = re.exec(section)) !== null) {
      const block = clean_(match[1]);
      const nameMatch = block.match(/^(.+?)(?=\s*\(Licence|\s*\(Mail|\s+Téléphone|\s+Telephone|\s+Nbre|\s+Indemnit|$)/i);
      const name = nameMatch ? clean_(nameMatch[1]) : "";

      const emailMatch = block.match(/\(Mail\s*:\s*([^)]+)\)/i);
      const email = emailMatch ? clean_(emailMatch[1]) : "";

      const phoneMatch = block.match(/Portable\s*:?\s*([0-9 .-]{8,})/i);
      const phone = phoneMatch ? cleanPhone_(phoneMatch[1]) : "";

      const kmMatch = block.match(/Nbre\s+de\s+kms\s+aller\s*:?\s*([0-9]+(?:[,.][0-9]+)?)/i);
      const kmAller = kmMatch ? toNumber_(kmMatch[1]) : "";

      const indemnityMatch = block.match(/Indemnit[ée]?\s*:?\s*([0-9]+(?:[,.][0-9]+)?)\s*€/i);
      const indemnity = indemnityMatch ? toNumber_(indemnityMatch[1]) : "";

      if (name) {
        officials.push({ name, email, phone, kmAller, indemnity, role: roleFromOfficialIndex_(index) });
        index++;
      }
    }

    return officials;
  }

  function roleFromOfficialIndex_(index) {
    if (index === 0) return "Crew Chief";
    if (index === 1) return "Arbitre n°2";
    return `Arbitre n°${index + 1}`;
  }

  function isUserOfficial_(official) {
    const nameNorm = normalize_(official.name || "");
    const email = String(official.email || "").toLowerCase();
    return nameNorm.includes(REFEREE_NAME_NORM) || email.includes(REFEREE_EMAIL);
  }

  function extractIndemnisedBy_(oneLine) {
    const m = oneLine.match(/C\.\s*Arbitre\s+INDEMNISES PAR\s*:\s*(.+?)(?=\s+Arbitre\s*:|\s+Observateur|\s+D\.\s*OTM|$)/i);
    return m ? clean_(m[1]) : "";
  }

  // CORRIGÉ : le vrai libellé FFBB est "Observateur Arb :", pas
  // "Observateur :" — [^():]* absorbe le mot "Arb" (ou toute variante)
  // entre "Observateur" et les deux-points.
  function extractObserver_(oneLine) {
    const m = oneLine.match(/Observateur[^():]*:\s*([^()]+?)(?=\s*\(|\s+Téléphone|\s+Nbre|\s+Indemnité|$)/i);
    return m ? clean_(m[1]) : "";
  }

  function extractEmarque_(oneLine) {
    const m = oneLine.match(/Code\s+e-?Marque\s*(?:V2)?\s*:?\s*([A-Z0-9]+)/i);
    return m ? clean_(m[1]) : "";
  }

  /*************** PARSING 3X3 ***************/

  function is3x3Text_(text) {
    return /3x3|OPEN PLUS|CORPORATE SERIES|CONVOCATION.*3X3/i.test(text);
  }

  function parse3x3Convocation_(subject, body, messageId, sourceType, sourceName) {
    const text = clean_(subject + " " + body);

    const date = extractDateFromText_(text);
    const rdv = extractRdvTime_(text);
    const season = computeSeason_(date);

    const eventName = extract3x3EventName_(subject, text);
    const address = extract3x3Address_(text);
    const ville = extractVilleFromAddress_(address);

    const fixedAmount = extractFixed3x3Amount_(text);
    const kmAR = estimateKmRoundTrip_(address);
    const travelAmount = kmAR ? Number(kmAR) * 0.40 : 0;
    const amount = fixedAmount ? Number((Number(fixedAmount) + travelAmount).toFixed(2)) : "";

    const referent = extract3x3Referent_(text);

    let warningGeneral = "";
    let warningFinance = "";

    if (!date) warningGeneral = addWarning_(warningGeneral, "Date 3x3 non trouvée");
    if (!rdv) warningGeneral = addWarning_(warningGeneral, "Heure de RDV 3x3 non trouvée");
    if (!address) warningGeneral = addWarning_(warningGeneral, "Adresse 3x3 non trouvée");
    if (!kmAR) warningFinance = addWarning_(warningFinance, "Kilométrage 3x3 à vérifier");
    if (!fixedAmount) warningFinance = addWarning_(warningFinance, "Indemnité fixe 3x3 non trouvée");

    const uid = `3X3_${season}_${date || hash_(subject)}_${hash_(eventName + date + rdv)}`;

    return {
      "UID": uid,
      "Source": `${sourceType || "Gmail"}${sourceName ? " / " + sourceName : ""}`,
      "Format": "3x3",
      "Saison": season,
      "Statut": "Actif",
      "Date match": date,
      "Heure/RDV": rdv,
      "Niveau administratif": "3x3",
      "Type compétition": "3x3",
      "Genre": detecterGenre_("", eventName),
      "Catégorie d'âge": detecterCategorie_("", eventName),
      "Code compétition": "3X3",
      "Libellé compétition": eventName,
      "N° rencontre": "",
      "Recevant": eventName,
      "Visiteur / événement": eventName,
      "Salle": "",
      "Adresse": address,
      "Ville": ville,
      "Code e-Marque": "",
      "Mon rôle": "Arbitre 3x3",
      "Collègue nom": "",
      "Collègue rôle": "",
      "Collègue téléphone": "",
      "Référent 3x3": referent,
      "Observateur": "",
      "Km A/R stats": kmAR,
      "Indemnité totale": amount,
      "Indemnisé par": "",
      "Paiement Type": "Paiement départemental / 3x3",
      "Date paiement": compute11thNextMonth_(date),
      "Statut paiement": amount ? "À recevoir" : "À vérifier",
      "Date réception": "",
      "Montant reçu": "",
      "Warning général": warningGeneral,
      "Warning finance": warningFinance,
      "Warning FBI": "",
      "Agenda Event ID": "",
      "Dernière MAJ": new Date(),
      "Sujet mail": subject,
      "Gmail Message ID": messageId
    };
  }

  function extract3x3EventName_(subject, text) {
    const subj = clean_(subject);
    const fromSubject = subj.replace(/^Objet\s*:\s*/i, "").replace(/CONVOCATION\s*:\s*/i, "").replace(/\s+\/\/\s+.*/i, "").trim();
    if (fromSubject && /3x3|OPEN|CORPORATE/i.test(fromSubject)) return fromSubject;
    const m = text.match(/(OPEN PLUS ACCESS|FINALES BC CORPORATE SERIES|CORPORATE SERIES|OPEN PLUS).{0,80}/i);
    return m ? clean_(m[0]) : "Mission 3x3";
  }

  function extract3x3Address_(text) {
    const t = clean_(text);

    let m = t.match(/rendez-vous\s+à\s+\d{1,2}[H:]\d{0,2}\s+sur\s+le\s+(.+?)(?=\.\s+Tu|\.\s+Indemnit|\.\s+Le planning|Tu voudras|Indemnit|Le planning|$)/i);
    if (m) return clean3x3Address_(m[1]);

    m = t.match(/RDV\s*[:\-]?\s*\d{1,2}[H:]\d{0,2}\s+(.+?)(?=\.\s+Tu|\.\s+Indemnit|\.\s+Le planning|Tu voudras|Indemnit|Le planning|$)/i);
    if (m) return clean3x3Address_(m[1]);

    m = t.match(/(?:Adresse|Lieu|Salle)\s*[:\-]\s*(.+?)(?=\s+RDV|\s+Rendez-vous|\s+Indemnité|\s+Merci|\s*$)/i);
    if (m) return clean3x3Address_(m[1]);

    const postal = t.match(/(.{0,80}\b\d{5}\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\s']+)/i);
    return postal ? clean3x3Address_(postal[1]) : "";
  }

  function clean3x3Address_(value) {
    return clean_(value).replace(/\s+à\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\s']+)$/i, ", $1").replace(/\s+a\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\s']+)$/i, ", $1");
  }

  function extractFixed3x3Amount_(text) {
    const t = clean_(text);
    let m = t.match(/Indemnit[ée]s?\s+d[’']?arbitrage\s*:\s*([0-9]+(?:[,.][0-9]+)?)\s*€/i);
    if (m) return toNumber_(m[1]);
    m = t.match(/([0-9]+(?:[,.][0-9]+)?)\s*€\s*(?:uros)?\s*\+\s*d[ée]placement/i);
    if (m) return toNumber_(m[1]);
    m = t.match(/([0-9]+(?:[,.][0-9]+)?)\s*€/);
    return m ? toNumber_(m[1]) : "";
  }

  function extract3x3Referent_(text) {
    const t = clean_(text);
    const m = t.match(/r[ée]f[ée]rent des [‘'"]?OFFICIELS[’'"]?\s+est\s+(.+?)\s*:/i);
    return m ? clean_(m[1]) : "";
  }

  /*************** ALERTES ***************/

  function isFbiWarningText_(text) {
    return /V[ÉE]RIFIER FBI|REVERIFIER VOS DESIGNATIONS|CONSULTER FBI|CHANGEMENTS DE DERNIERE MINUTE|NOUVELLES CONVOCATIONS|COLLEGUE A ETE REMPLACE|MODIFICATION DE DESIGNATION/i.test(normalize_(text));
  }

  /*************** ANNULATION AUTOMATIQUE ***************/
  /* Un mail d'annulation ne porte souvent qu'un numéro de rencontre :
       Sujet : « Annulation rencontre 461 »
       Corps : « La rencontre 461 du 19/09 est annulée. »
     On récupère ce numéro, on cherche la ligne correspondante et on l'annule
     — mais seulement si l'identification est certaine. Dans le doute, on
     retombe sur l'ancien comportement : une alerte à traiter à la main.
     Aucune ligne n'est jamais supprimée : elle passe en statut « Annulé ». */

  function extraireNumeroRencontre_(texte) {
    const t = clean_(texte);
    const motifs = [
      /(?:annulation|report)[^0-9]{0,20}?(?:rencontre|match)\s*(?:n\s*°|no|num[ée]ro)?\s*:?\s*(\d{1,7})\b/i,
      /\b(?:la\s+)?(?:rencontre|match)\s*(?:n\s*°|no|num[ée]ro)?\s*:?\s*(\d{1,7})\b/i,
      /\bn\s*°\s*(?:de\s+)?(?:rencontre|match)\s*:?\s*(\d{2,7})\b/i
    ];
    for (let i = 0; i < motifs.length; i++) {
      const m = t.match(motifs[i]);
      if (m) return m[1].replace(/^0+(?=\d)/, "");
    }
    return "";
  }

  /* Supprime l'événement d'agenda d'une ligne, s'il existe. */
  function supprimerEvenement_(eventId, rowObj) {
    if (!eventId) return false;
    try {
      const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
      if (!calendar) return false;
      const event = calendar.getEventById(eventId);
      if (!event) return false;
      event.deleteEvent();
      return true;
    } catch (e) {
      log_("CALENDAR_ERROR", "Suppression événement impossible : " + (e.message || e));
      return false;
    }
  }

  /**
   * Annule la rencontre portant ce numéro.
   * @return {Object} { fait, raison, uid, rowNumber, agenda }
   *   fait=false et raison="INTROUVABLE" ou "AMBIGU" laissent le mail
   *   suivre le chemin normal de l'alerte.
   */
  function annulerRencontreParNumero_(numero, dateIndice) {
    if (!numero) return { fait: false, raison: "PAS_DE_NUMERO" };

    const sheet = getSS_().getSheetByName(SHEET_MATCHS);
    const headerMap = getHeaderMap_(sheet);

    const cNum    = headerMap[normalizeHeader_("N° rencontre")];
    const cStatut = headerMap[normalizeHeader_("Statut")];
    const cUid    = headerMap[normalizeHeader_("UID")];
    const cDate   = headerMap[normalizeHeader_("Date match")];
    const cFormat = headerMap[normalizeHeader_("Format")];
    const cWarn   = headerMap[normalizeHeader_("Warning général")];
    const cAgenda = headerMap[normalizeHeader_("Agenda Event ID")];
    const cMaj    = headerMap[normalizeHeader_("Dernière MAJ")];

    if (!cNum || !cStatut) return { fait: false, raison: "COLONNES_MANQUANTES" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { fait: false, raison: "INTROUVABLE" };

    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const cible = String(numero).replace(/^0+(?=\d)/, "");

    const candidats = [];
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (String(row[cFormat - 1] || "") === "Alerte") continue;

      const num = String(row[cNum - 1] || "").split(".")[0].replace(/^0+(?=\d)/, "").trim();
      if (!num || num !== cible) continue;

      const statut = normalize_(String(row[cStatut - 1] || ""));
      if (statut.indexOf("ANNUL") >= 0) return { fait: false, raison: "DEJA_ANNULE", rowNumber: i + 2 };

      candidats.push({ i: i, rowNumber: i + 2, row: row, date: String(row[cDate - 1] || "") });
    }

    if (!candidats.length) return { fait: false, raison: "INTROUVABLE" };

    // Plusieurs lignes portent ce numéro : on départage par la date si le mail
    // en donne une (« du 19/09 »). Sinon on refuse d'agir au hasard.
    let choisi = candidats[0];
    if (candidats.length > 1) {
      const parDate = dateIndice
        ? candidats.filter(c => memeJourEtMois_(c.date, dateIndice))
        : [];
      if (parDate.length !== 1) {
        return { fait: false, raison: "AMBIGU", nb: candidats.length };
      }
      choisi = parDate[0];
    }

    const r = choisi.rowNumber;
    sheet.getRange(r, cStatut).setValue("Annulé");
    if (cWarn)  sheet.getRange(r, cWarn).setValue("Annulée par mail du " + formatDate_(new Date()));
    if (cMaj)   sheet.getRange(r, cMaj).setValue(new Date());

    let agenda = false;
    if (cAgenda) {
      const eventId = String(sheet.getRange(r, cAgenda).getValue() || "");
      agenda = supprimerEvenement_(eventId);
      if (agenda) sheet.getRange(r, cAgenda).setValue("");
    }

    _cacheInvalider_();

    return {
      fait: true,
      uid: cUid ? String(choisi.row[cUid - 1] || "") : "",
      rowNumber: r,
      date: choisi.date,
      agenda: agenda
    };
  }

  /* Compare deux dates sur le jour et le mois seulement : le mail écrit
     « du 19/09 » sans l'année. */
  function memeJourEtMois_(dateFr, indice) {
    const a = String(dateFr).match(/(\d{1,2})\/(\d{1,2})/);
    const b = String(indice).match(/(\d{1,2})\/(\d{1,2})/);
    if (!a || !b) return false;
    return Number(a[1]) === Number(b[1]) && Number(a[2]) === Number(b[2]);
  }

  function isCancellationText_(text) {
    return /ANNULEE|ANNULÉE|ANNULE|ANNULER|REPORTEE|REPORTÉE|RETIRE CETTE DESIGNATION|RETIRÉ CETTE DÉSIGNATION/i.test(normalize_(text));
  }

  function buildFbiWarningRow_(subject, body, messageId) {
    const date = extractDateFromText_(subject + " " + body);
    const season = computeSeason_(date);
    return buildGenericAlertRow_("ALERTE_FBI", "Alerte FBI", "Alerte mail : vérifier FBI", "Vérifier les désignations FBI", subject, body, messageId, date, season);
  }

  function buildCancellationAlertRow_(subject, body, messageId) {
    const date = extractDateFromText_(subject + " " + body);
    const season = computeSeason_(date);
    return buildGenericAlertRow_("ALERTE_ANNULATION", "Annulation / report", "Mail d’annulation / report à vérifier", "", subject, body, messageId, date, season);
  }

  function buildAlertRow_(params) {
    const subject = params.subject || "";
    const body = params.body || "";
    const messageId = params.messageId || "";
    const warning = params.warning || "À vérifier";
    const date = extractDateFromText_(subject + " " + body);
    const season = computeSeason_(date);
    return buildGenericAlertRow_("ALERTE", "Alerte", warning, "", subject, body, messageId, date, season);
  }

  function buildGenericAlertRow_(prefix, typeCompetition, warningGeneral, warningFbi, subject, body, messageId, date, season) {
    return {
      "UID": `${prefix}_${season}_${date || hash_(subject)}_${hash_(messageId + warningGeneral)}`,
      "Source": "Gmail / Alerte", "Format": "Alerte", "Saison": season, "Statut": "À vérifier",
      "Date match": date, "Heure/RDV": "", "Niveau administratif": "Alerte", "Type compétition": typeCompetition,
      "Genre": "", "Catégorie d'âge": "",
      "Code compétition": "", "Libellé compétition": subject, "N° rencontre": "", "Recevant": "",
      "Visiteur / événement": subject, "Salle": "", "Adresse": "", "Ville": "", "Code e-Marque": "",
      "Mon rôle": "", "Collègue nom": "", "Collègue rôle": "", "Collègue téléphone": "", "Référent 3x3": "",
      "Observateur": "", "Km A/R stats": "", "Indemnité totale": "", "Indemnisé par": "", "Paiement Type": "",
      "Date paiement": "", "Statut paiement": "À vérifier", "Date réception": "", "Montant reçu": "",
      "Warning général": warningGeneral, "Warning finance": "", "Warning FBI": warningFbi, "Agenda Event ID": "",
      "Dernière MAJ": new Date(), "Sujet mail": subject, "Gmail Message ID": messageId
    };
  }

  /*************** SHEETS ***************/

  function ensureSheets_() {
    const ss = getSS_();
    let matchs = ss.getSheetByName(SHEET_MATCHS);
    if (!matchs) matchs = ss.insertSheet(SHEET_MATCHS);
    ensureHeaders_(matchs, MATCH_HEADERS);

    let logs = ss.getSheetByName(SHEET_LOGS);
    if (!logs) logs = ss.insertSheet(SHEET_LOGS);
    ensureHeaders_(logs, ["Date", "Type", "Message"]);

    let processed = ss.getSheetByName(SHEET_PROCESSED);
    if (!processed) processed = ss.insertSheet(SHEET_PROCESSED);
    ensureHeaders_(processed, PROCESSED_HEADERS);
  }

  function ensureHeaders_(sheet, headers) {
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

    if (sheet.getLastRow() === 0 || current.every(v => !v)) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    const existingNorm = current.map(h => normalizeHeader_(h));
    headers.forEach(header => {
      if (!existingNorm.includes(normalizeHeader_(header))) {
        const newCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, newCol).setValue(header);
        existingNorm.push(normalizeHeader_(header));
      }
    });
  }

  function upsertMatch_(rowObj) {
    ensureSheets_();
    const sheet = getSS_().getSheetByName(SHEET_MATCHS);
    const headerMap = getHeaderMap_(sheet);

    const uidCol = headerMap[normalizeHeader_("UID")];
    if (!uidCol) throw new Error("Colonne UID introuvable");

    const uid = rowObj["UID"];
    if (!uid) throw new Error("UID manquant");

    const lastRow = Math.max(sheet.getLastRow(), 1);
    const uidValues = lastRow > 1 ? sheet.getRange(2, uidCol, lastRow - 1, 1).getValues().flat() : [];

    let targetRow = -1;
    let existingRowFound = false;

    for (let i = 0; i < uidValues.length; i++) {
      if (String(uidValues[i]).trim() === uid) { targetRow = i + 2; existingRowFound = true; break; }
    }

    if (targetRow === -1) targetRow = findFirstEmptyUidRow_(sheet, uidCol);
    if (targetRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), targetRow - sheet.getMaxRows());

    const lastCol = sheet.getLastColumn();
    const existingValues = targetRow <= sheet.getLastRow() ? sheet.getRange(targetRow, 1, 1, lastCol).getValues()[0] : new Array(lastCol).fill("");
    const newValues = existingValues.slice();

    const statutPaiementCol = headerMap[normalizeHeader_("Statut paiement")];
    const agendaCol = headerMap[normalizeHeader_("Agenda Event ID")];
    const dateReceptionCol = headerMap[normalizeHeader_("Date réception")];
    const montantRecuCol = headerMap[normalizeHeader_("Montant reçu")];

    Object.keys(rowObj).forEach(key => {
      const col = headerMap[normalizeHeader_(key)];
      if (!col) return;

      const incomingValue = rowObj[key];
      const existingValue = existingValues[col - 1];
      const keyNorm = normalizeHeader_(key);

      // Ne pas écraser l'Event ID existant.
      if (existingRowFound && agendaCol && col === agendaCol && !incomingValue && existingValue) return;

      // FIX #5 : ne JAMAIS rétrograder un statut de paiement déjà avancé
      // (ex: "Reçu" ne doit jamais repasser à "À recevoir" ou "À vérifier"
      // suite au retraitement d'une convocation modificative du même match).
      if (existingRowFound && statutPaiementCol && col === statutPaiementCol && existingValue) {
        const existingRank = PAYMENT_RANK[existingValue] !== undefined ? PAYMENT_RANK[existingValue] : -1;
        const incomingRank = PAYMENT_RANK[incomingValue] !== undefined ? PAYMENT_RANK[incomingValue] : -1;
        if (incomingRank < existingRank) return;
      }

      // Ne pas vider une réception déjà saisie.
      if (existingRowFound && (col === dateReceptionCol || col === montantRecuCol) && !incomingValue && existingValue) return;

      newValues[col - 1] = incomingValue;
    });

    sheet.getRange(targetRow, 1, 1, lastCol).setValues([newValues]);
    _cacheInvalider_();
    return targetRow;
  }

  function findFirstEmptyUidRow_(sheet, uidCol) {
    const maxRows = Math.max(sheet.getMaxRows(), 2);
    const values = sheet.getRange(2, uidCol, maxRows - 1, 1).getValues().flat();
    for (let i = 0; i < values.length; i++) {
      if (!String(values[i] || "").trim()) return i + 2;
    }
    return sheet.getLastRow() + 1;
  }

  function getHeaderMap_(sheet) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const map = {};
    headers.forEach((h, i) => { if (h) map[normalizeHeader_(h)] = i + 1; });
    return map;
  }

  function getRowObject_(sheet, rowNumber) {
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i]);
    return obj;
  }

  /*************** PROCESSED ***************/

  function getProcessedKeys_() {
    const sheet = getSS_().getSheetByName(SHEET_PROCESSED);
    const headerMap = getHeaderMap_(sheet);
    const col = headerMap[normalizeHeader_("Processing Key")];
    const keys = new Set();
    if (!col || sheet.getLastRow() < 2) return keys;
    const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues().flat();
    values.forEach(v => { const key = String(v || "").trim(); if (key) keys.add(key); });
    return keys;
  }

  function markProcessed_(processingKey, messageId, uid, status, subject) {
    const sheet = getSS_().getSheetByName(SHEET_PROCESSED);
    const rowObj = { "Date traitement": new Date(), "Processing Key": processingKey, "Gmail Message ID": messageId, "UID": uid || "", "Statut traitement": status || "", "Sujet": subject || "" };
    const row = [];
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    headers.forEach(h => row.push(rowObj[h] || ""));
    sheet.appendRow(row);
  }

  /*************** CALENDAR ***************/

  function updateCalendarForRow_(rowObj, rowNumber) {
    try {
      const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
      if (!calendar) { log_("CALENDAR", "Agenda introuvable : " + CALENDAR_ID); return; }

      const sheet = getSS_().getSheetByName(SHEET_MATCHS);
      if (rowNumber) rowObj = Object.assign({}, rowObj, getRowObject_(sheet, rowNumber));

      const date = parseDate_(rowObj["Date match"]);
      if (!date) return;

      const time = rowObj["Heure/RDV"] || "12:00";
      const start = combineDateAndTime_(date, time);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

      const title = rowObj["Format"] === "3x3"
        ? `🏀 3x3 - ${rowObj["Visiteur / événement"] || rowObj["Recevant"] || "Mission"}`
        : `🏀 ${rowObj["Niveau administratif"] || ""} - ${rowObj["Recevant"] || ""}`;

      const location = rowObj["Adresse"] || "";
      const description = buildCalendarDescription_(rowObj);

      const headerMap = getHeaderMap_(sheet);
      const eventCol = headerMap[normalizeHeader_("Agenda Event ID")];

      let eventId = rowObj["Agenda Event ID"] || "";
      let event = null;

      if (eventId) {
        try { event = calendar.getEventById(eventId); } catch (e) { event = null; }
      }

      if (!event) event = findExistingCalendarEvent_(calendar, rowObj, title, start, location);

      if (event) {
        event.setTitle(title);
        event.setTime(start, end);
        event.setLocation(location);
        event.setDescription(description);
      } else {
        event = calendar.createEvent(title, start, end, { location, description });
      }

      if (eventCol && rowNumber && event) sheet.getRange(rowNumber, eventCol).setValue(event.getId());
    } catch (e) {
      log_("CALENDAR_ERROR", e.stack || e.message);
    }
  }

  function findExistingCalendarEvent_(calendar, rowObj, title, start, location) {
    const uid = String(rowObj["UID"] || "").trim();
    const matchNumber = String(rowObj["N° rencontre"] || "").trim();

    const dayStart = new Date(start.getTime()); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(start.getTime()); dayEnd.setHours(23, 59, 59, 999);

    const events = calendar.getEvents(dayStart, dayEnd);

    for (const event of events) {
      const eventTitle = clean_(event.getTitle());
      const eventLocation = clean_(event.getLocation());
      const eventDescription = clean_(event.getDescription());
      const eventStart = event.getStartTime();

      if (uid && eventDescription.includes("UID : " + uid)) return event;
      if (uid && eventDescription.includes("UID: " + uid)) return event;
      if (matchNumber && eventDescription.includes("N° rencontre : " + matchNumber)) return event;

      const sameTitle = normalize_(eventTitle) === normalize_(title);
      const sameLocation = !location || normalize_(eventLocation) === normalize_(location);
      const sameStart = Math.abs(eventStart.getTime() - start.getTime()) < 5 * 60 * 1000;

      if (sameTitle && sameStart && sameLocation) return event;
    }

    return null;
  }

  function buildCalendarDescription_(row) {
    const lines = [];
    lines.push("Referee Tracker");
    lines.push("UID : " + (row["UID"] || ""));
    lines.push("");
    lines.push("Format : " + (row["Format"] || ""));
    lines.push("Saison : " + (row["Saison"] || ""));
    lines.push("Compétition : " + (row["Libellé compétition"] || ""));
    lines.push("N° rencontre : " + (row["N° rencontre"] || ""));
    lines.push("Mon rôle : " + (row["Mon rôle"] || ""));
    lines.push("Recevant : " + (row["Recevant"] || ""));
    lines.push("Visiteur / événement : " + (row["Visiteur / événement"] || ""));
    lines.push("Salle : " + (row["Salle"] || ""));
    lines.push("Adresse : " + (row["Adresse"] || ""));
    lines.push("");
    lines.push("Collègue : " + (row["Collègue nom"] || ""));
    lines.push("Rôle collègue : " + (row["Collègue rôle"] || ""));
    lines.push("Téléphone collègue : " + (row["Collègue téléphone"] || ""));
    lines.push("Référent 3x3 : " + (row["Référent 3x3"] || ""));
    lines.push("Code e-Marque : " + (row["Code e-Marque"] || ""));
    lines.push("");
    lines.push("Indemnité : " + (row["Indemnité totale"] || ""));
    lines.push("KM A/R : " + (row["Km A/R stats"] || ""));
    lines.push("Paiement prévu : " + (row["Date paiement"] || ""));
    lines.push("");
    lines.push("FBI : " + FBI_URL);
    return lines.join("\n");
  }

  /*************** API ***************/

  function apiResponse_(obj, callback) {
    const json = JSON.stringify(obj);
    if (callback) return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  }

  function getMatchsForApi_() {
    const enCache = _cacheLire_("matchs");
    if (enCache) return enCache;
    return _cacheEcrire_("matchs", getMatchsForApiBrut_());
  }

  function getMatchsForApiBrut_() {
    const sheet = getSS_().getSheetByName(SHEET_MATCHS);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
    const headers = values[0];
    return values.slice(1).filter(row => String(row[0] || "").trim()).map(row => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = row[i] || "");
      return obj;
    });
  }

  function updatePaymentStatusForApi_(uid, status) {
    if (!uid) throw new Error("UID manquant");
    if (!status) throw new Error("Statut paiement manquant");
    if (!PAYMENT_STATUSES.includes(status)) throw new Error("Statut paiement non autorisé : " + status);

    const sheet = getSS_().getSheetByName(SHEET_MATCHS);
    const headerMap = getHeaderMap_(sheet);

    const uidCol = headerMap[normalizeHeader_("UID")];
    const statusCol = headerMap[normalizeHeader_("Statut paiement")];
    const dateReceptionCol = headerMap[normalizeHeader_("Date réception")];
    const montantRecuCol = headerMap[normalizeHeader_("Montant reçu")];
    const montantAttenduCol = headerMap[normalizeHeader_("Indemnité totale")];
    const majCol = headerMap[normalizeHeader_("Dernière MAJ")];

    if (!uidCol || !statusCol) throw new Error("Colonnes UID ou Statut paiement introuvables");

    const lastRow = sheet.getLastRow();
    const uids = sheet.getRange(2, uidCol, Math.max(lastRow - 1, 1), 1).getValues().flat();

    let rowNumber = -1;
    for (let i = 0; i < uids.length; i++) {
      if (String(uids[i]).trim() === uid) { rowNumber = i + 2; break; }
    }
    if (rowNumber === -1) throw new Error("UID introuvable : " + uid);

    sheet.getRange(rowNumber, statusCol).setValue(status);

    if (status === "Reçu") {
      if (dateReceptionCol) sheet.getRange(rowNumber, dateReceptionCol).setValue(new Date());
      if (montantRecuCol && montantAttenduCol) {
        const currentReceived = sheet.getRange(rowNumber, montantRecuCol).getValue();
        const expected = sheet.getRange(rowNumber, montantAttenduCol).getValue();
        if (!currentReceived && expected) sheet.getRange(rowNumber, montantRecuCol).setValue(expected);
      }
    }

    if (status === "À recevoir") {
      if (dateReceptionCol) sheet.getRange(rowNumber, dateReceptionCol).setValue("");
      if (montantRecuCol) sheet.getRange(rowNumber, montantRecuCol).setValue("");
    }

    // Bénévole : rien n'est dû, rien ne sera reçu. Le montant encaissé
    // est explicitement mis à 0 pour ne pas laisser croire à un impayé.
    if (status === "Bénévole") {
      if (dateReceptionCol) sheet.getRange(rowNumber, dateReceptionCol).setValue("");
      if (montantRecuCol) sheet.getRange(rowNumber, montantRecuCol).setValue(0);
    }

    if (majCol) sheet.getRange(rowNumber, majCol).setValue(new Date());
    _cacheInvalider_();
    return { uid, status, rowNumber };
  }

  /*************** PAIEMENTS ***************/

  function compute11thNextMonth_(dateStr) {
    const d = parseDate_(dateStr);
    if (!d) return "";
    const payment = new Date(d.getFullYear(), d.getMonth() + 1, 11);
    return formatDate_(payment);
  }

  function computeRegionalPaymentDate_(dateStr) {
    const d = parseDate_(dateStr);
    if (!d) return "";
    const year = getSeasonStartYear_(d);

    const periods = [
      ["09/09", "20/10", "21/10"], ["21/10", "24/11", "25/11"], ["25/11", "22/12", "23/12"],
      ["23/12", "02/02", "03/02"], ["03/02", "23/02", "24/02"], ["24/02", "30/03", "31/03"],
      ["31/03", "20/04", "21/04"], ["21/04", "25/05", "26/05"], ["26/05", "15/06", "16/06"]
    ];

    for (const p of periods) {
      const start = makeSeasonDate_(p[0], year);
      let end = makeSeasonDate_(p[1], year);
      const pay = makeSeasonDate_(p[2], year);
      if (end < start) end = new Date(end.getFullYear() + 1, end.getMonth(), end.getDate());
      if (d >= start && d <= end) return formatDate_(pay);
    }

    return compute11thNextMonth_(dateStr);
  }

  function makeSeasonDate_(ddmm, seasonYear) {
    const parts = ddmm.split("/");
    const day = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const year = month >= 8 ? seasonYear : seasonYear + 1;
    return new Date(year, month, day);
  }

  /*************** PDF OCR ***************/

  function extractPdfText_(blob) {
    let file;
    try {
      if (Drive.Files && Drive.Files.create) {
        file = Drive.Files.create({ name: "OCR_" + new Date().getTime(), mimeType: MimeType.GOOGLE_DOCS }, blob, { ocr: true, ocrLanguage: "fr" });
      } else if (Drive.Files && Drive.Files.insert) {
        file = Drive.Files.insert({ title: "OCR_" + new Date().getTime(), mimeType: MimeType.GOOGLE_DOCS }, blob, { ocr: true, ocrLanguage: "fr" });
      } else {
        throw new Error("Service avancé Drive non disponible");
      }

      const doc = DocumentApp.openById(file.id);
      const text = doc.getBody().getText();
      DriveApp.getFileById(file.id).setTrashed(true);
      return text;
    } catch (e) {
      if (file && file.id) { try { DriveApp.getFileById(file.id).setTrashed(true); } catch (ignore) {} }
      throw e;
    }
  }

  /*************** OUTILS ***************/

  function getMessageText_(message) {
    let body = "";
    try { body = message.getPlainBody(); } catch (e) { body = ""; }
    if (!body) { try { body = message.getBody().replace(/<[^>]+>/g, " "); } catch (e) { body = ""; } }
    return clean_(body);
  }

  function ensureLabels_() {
    [LABEL_TRAITE, LABEL_A_VERIFIER, LABEL_ANOMALIE].forEach(name => {
      if (!GmailApp.getUserLabelByName(name)) GmailApp.createLabel(name);
    });
  }

  function extractBetween_(text, startRegex, endRegexes) {
    const start = text.search(startRegex);
    if (start < 0) return "";
    const after = text.substring(start).replace(startRegex, "");
    let endIndex = after.length;
    endRegexes.forEach(re => { const idx = after.search(re); if (idx >= 0 && idx < endIndex) endIndex = idx; });
    return clean_(after.substring(0, endIndex));
  }

  /* FIX #8 (28/08/2026) — nom de club par CODE OFFICIEL FFBB.
     La convocation porte, en face de chaque groupement sportif, son code
     officiel (3 lettres de ligue + 7 chiffres, ex. GES0051055). On le lit et
     on demande le nom exact au référentiel (ClubResolver.gs / onglet
     CLUBS_REF). Le nom lu dans le PDF ne sert plus que de repli. */

  var RE_CODE_CLUB_ = /\b(?:ARA|BFC|BRE|COR|CVL|GES|HDF|IDF|NAQ|NOR|OCC|PDL|SUD|GUA|GUY|MAR|MAY|REU|NCA|PFR|WEF|SPM|HAN|LNB)\d{7}\b/;

  function codeClubDansZone_(oneLine, startRegex, endRegexes) {
    const zone = extractBetween_(oneLine, startRegex, endRegexes);
    const m = String(zone).toUpperCase().match(RE_CODE_CLUB_);
    return m ? m[0] : "";
  }

  /* Le code officiel ne doit jamais rester collé au nom du club. */
  var RE_CODE_CLUB_G_ = new RegExp(RE_CODE_CLUB_.source, "gi");

  function sansCodeClub_(nom) {
    return clean_(String(nom || "").replace(RE_CODE_CLUB_G_, " "));
  }

  function nomClubOfficiel_(oneLine, startRegex, endRegexes, nomLu) {
    const repli = sansCodeClub_(nomLu);
    if (typeof CR === "undefined") return repli;          // ClubResolver.gs absent
    const code = codeClubDansZone_(oneLine, startRegex, endRegexes);
    if (!code) return repli;                              // pas de code : on garde le PDF
    try {
      const officiel = CR.nom(code, "");
      return officiel || repli;                           // code inconnu : on garde le PDF
    } catch (e) {
      return repli;                                       // référentiel HS : jamais bloquant
    }
  }

  function extractDateFromText_(text) {
    const t = clean_(text);

    let numeric = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (numeric) return `${pad2_(numeric[1])}/${pad2_(numeric[2])}/${numeric[3]}`;

    numeric = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
    if (numeric) return `${pad2_(numeric[1])}/${pad2_(numeric[2])}/20${numeric[3]}`;

    const months = {
      JANVIER: "01", FEVRIER: "02", FÉVRIER: "02", MARS: "03", AVRIL: "04", MAI: "05", JUIN: "06",
      JUILLET: "07", AOUT: "08", AOÛT: "08", SEPTEMBRE: "09", OCTOBRE: "10", NOVEMBRE: "11", DECEMBRE: "12", DÉCEMBRE: "12"
    };

    const re = /\b(\d{1,2})\s+(JANVIER|FEVRIER|FÉVRIER|MARS|AVRIL|MAI|JUIN|JUILLET|AOUT|AOÛT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE|DÉCEMBRE)\s+(\d{4})\b/i;
    const m = t.match(re);
    if (m) return `${pad2_(m[1])}/${months[m[2].toUpperCase()]}/${m[3]}`;

    return "";
  }

  function extractRdvTime_(text) {
    const t = clean_(text);
    let m = t.match(/(?:RDV|rendez-vous)\s*(?:à|a|:|-)?\s*(\d{1,2})[H:](\d{0,2})/i);
    if (m) return `${pad2_(m[1])}:${pad2_(m[2] || "00")}`;
    m = t.match(/\b(\d{1,2})[H:](\d{2})\b/);
    if (m) return `${pad2_(m[1])}:${pad2_(m[2])}`;
    return "";
  }

  function estimateKmRoundTrip_(destination) {
    if (!destination) return "";
    try {
      const directions = Maps.newDirectionFinder().setOrigin(START_ADDRESS).setDestination(destination).setMode(Maps.DirectionFinder.Mode.DRIVING).getDirections();
      const meters = directions.routes[0].legs[0].distance.value;
      const kmOneWay = meters / 1000;
      return Math.round(kmOneWay * 2);
    } catch (e) {
      return "";
    }
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
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return null;
  }

  function combineDateAndTime_(date, timeStr) {
    const d = new Date(date.getTime());
    const m = String(timeStr || "12:00").match(/(\d{1,2})[:hH](\d{0,2})/);
    if (m) d.setHours(Number(m[1]), Number(m[2] || 0), 0, 0);
    else d.setHours(12, 0, 0, 0);
    return d;
  }

  function formatDate_(date) {
    return `${pad2_(date.getDate())}/${pad2_(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  function getSS_() {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  function clean_(value) {
    return String(value || "").replace(/\u00A0/g, " ").replace(/[ \t\r\n]+/g, " ").trim();
  }

  function normalize_(value) {
    return clean_(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  }

  function normalizeHeader_(value) {
    return normalize_(value).replace(/[^A-Z0-9]/g, "");
  }

  function cleanPhone_(value) {
    let digits = String(value || "").replace(/[^\d]/g, "");
    if (digits.length === 9) digits = "0" + digits;
    if (/^0+$/.test(digits)) return "";
    return digits;
  }

  function toNumber_(value) {
    if (value === "" || value === null || value === undefined) return "";
    const n = Number(String(value).replace(",", ".").replace(/[^\d.]/g, ""));
    return isNaN(n) ? "" : n;
  }

  function pad2_(value) {
    return String(value || "0").padStart(2, "0");
  }

  function hash_(value) {
    const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(value || ""));
    return raw.map(b => (b + 256).toString(16).slice(-2)).join("").substring(0, 10).toUpperCase();
  }

  function addWarning_(existing, warning) {
    if (!warning) return existing || "";
    if (!existing) return warning;
    if (existing.indexOf(warning) >= 0) return existing;
    return existing + " | " + warning;
  }

  function log_(type, message) {
    try {
      const ss = getSS_();
      let sh = ss.getSheetByName(SHEET_LOGS);
      if (!sh) { sh = ss.insertSheet(SHEET_LOGS); sh.appendRow(["Date", "Type", "Message"]); }
      sh.appendRow([new Date(), type, message]);
    } catch (e) {
      console.log(type + " - " + message);
    }
  }

  /*************** VÉHICULE / COÛT RÉEL CARBURANT ***************/

  /**
   * MODIFICATION C — véhicule en service à la DATE DU MATCH.
   *
   * Config.gs conserve un historique daté : chaque voiture a une date
   * « depuis ». On retient la dernière dont la date précède celle du match.
   * Conséquence : ajouter une voiture ne modifie AUCUN calcul déjà fait.
   *
   * Repli sur la liste écrite en dur (ancien format cutoverBefore) si
   * Config.gs est absent.
   */
  function vehicleForDate_(dateStr) {
    if (typeof CFG !== "undefined") {
      var v = CFG.vehiculePour(parseDate_(dateStr));
      if (v) return { name: v.nom, consoL100: v.conso, cv: v.cv };
    }

    var d = parseDate_(dateStr);
    if (!d) return VEHICLES[VEHICLES.length - 1];
    for (var i = 0; i < VEHICLES.length; i++) {
      var cut = VEHICLES[i].cutoverBefore ? parseDate_(VEHICLES[i].cutoverBefore) : null;
      if (cut && d < cut) return VEHICLES[i];
    }
    return VEHICLES[VEHICLES.length - 1];
  }

  /* Prix du litre applicable à une date donnée.
     - Match passé  : prix historique du mois (figé, ne bougera plus)
     - Match à venir : prix temps réel le plus récent connu
     - À défaut      : constante FUEL_PRICE_PER_L */
  function prixCarburantPour_(dateStr) {
    const d = parseDate_(dateStr);
    if (!d) return FUEL_PRICE_PER_L;

    const cle = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");

    // 1. Le mois figure dans l'historique : c'est la valeur définitive
    if (PRIX_E10_HISTORIQUE[cle]) return PRIX_E10_HISTORIQUE[cle];

    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);

    // 2. Match passé hors historique : on prend le mois connu le plus proche
    if (d < aujourdhui) {
      const mois = Object.keys(PRIX_E10_HISTORIQUE).sort();
      if (!mois.length) return FUEL_PRICE_PER_L;
      let proche = mois[0];
      let ecartMin = Infinity;
      mois.forEach(m => {
        const ecart = Math.abs(moisEnNombre_(m) - moisEnNombre_(cle));
        if (ecart < ecartMin) { ecartMin = ecart; proche = m; }
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

  function lirePrixActuel_() {
    try {
      const v = PropertiesService.getScriptProperties().getProperty(CACHE_PRIX_ACTUEL);
      const n = Number(v);
      return (n > 0.5 && n < 4) ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  // Coût réel carburant pour un aller-retour donné (km A/R déjà doublés).
  function realFuelCost_(kmAR, dateStr) {
    const km = Number(kmAR) || 0;
    if (!km) return 0;
    const v = vehicleForDate_(dateStr);
    const prix = prixCarburantPour_(dateStr);
    return Number(((km * v.consoL100 / 100) * prix).toFixed(2));
  }

  /* Récupère le prix E10 moyen actuel dans un rayon de 15 km autour du
     domicile, via l'API open data du ministère de l'Économie (gratuite,
     sans clé). Stocké en cache pour les matchs à venir.
     À lancer une fois par semaine par déclencheur. */
  function majPrixCarburantActuel_() {
    try {
      _syncConfig_();   // MODIFICATION B : utilise l'adresse à jour

      const lat = START_COORDS.lat, lon = START_COORDS.lon;
      const url = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/"
        + "prix-des-carburants-en-france-flux-instantane-v2/records"
        + "?select=prix_e10&where=distance(geom%2C%20geom%27POINT(" + lon + "%20" + lat + ")%27%2C%2015km)"
        + "&limit=100";

      const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) {
        log_("PRIX_CARBURANT", "API indisponible (code " + resp.getResponseCode() + ")");
        return;
      }

      const data = JSON.parse(resp.getContentText());
      const prix = (data.results || [])
        .map(r => Number(r.prix_e10))
        .filter(v => v > 0.5 && v < 4);

      if (!prix.length) {
        log_("PRIX_CARBURANT", "Aucun prix E10 exploitable dans le rayon");
        return;
      }

      const moyenne = prix.reduce((t, v) => t + v, 0) / prix.length;
      PropertiesService.getScriptProperties().setProperty(CACHE_PRIX_ACTUEL, String(moyenne.toFixed(4)));
      log_("PRIX_CARBURANT", moyenne.toFixed(3) + " €/L sur " + prix.length + " station(s)");
    } catch (e) {
      log_("PRIX_CARBURANT_ERROR", e.message);
    }
  }

  // Équivalent barème fiscal (KPI info seulement — jamais versé).
  function baremeFiscalCost_(kmAR, dateStr) {
    const km = Number(kmAR) || 0;
    if (!km) return 0;
    const v = vehicleForDate_(dateStr);
    const coef = BAREME_FISCAL_PAR_KM[v.cv] || BAREME_FISCAL_PAR_KM[5];
    return Number((km * coef).toFixed(2));
  }

  /*************** GÉOCODAGE OSM (Nominatim) + DISTANCE (OSRM) ***************/
  // 100% gratuit, sans clé ni CB. Utilisé seulement si "Km A/R stats" est vide
  // (les convocations 5x5 fournissent déjà le km ; utile surtout pour le 3x3).

  function geocodeOSM_(address) {
    if (!address) return null;
    try {
      const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(address);
      const resp = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { "User-Agent": "RefereeTracker/1.0 (contact: arbitrage)" }
      });
      if (resp.getResponseCode() !== 200) return null;
      const data = JSON.parse(resp.getContentText());
      if (!data || !data.length) return null;
      return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
    } catch (e) {
      log_("GEOCODE_ERROR", e.message);
      return null;
    }
  }

  function osrmRoundTripKm_(destAddress) {
    const dest = geocodeOSM_(destAddress);
    if (!dest) return "";
    Utilities.sleep(1100); // Nominatim : max 1 req/s, on respecte
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${START_COORDS.lon},${START_COORDS.lat};${dest.lon},${dest.lat}?overview=false`;
      const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      if (resp.getResponseCode() !== 200) return "";
      const data = JSON.parse(resp.getContentText());
      if (!data.routes || !data.routes.length) return "";
      const oneWayKm = data.routes[0].distance / 1000;
      return Math.round(oneWayKm * 2);
    } catch (e) {
      log_("OSRM_ERROR", e.message);
      return "";
    }
  }

  /*************** STATS SERVEUR (endpoint action=stats) ***************/

  function buildStatsForApi_(seasonFilter) {
    const nom = "stats:" + (seasonFilter || "*");
    const enCache = _cacheLire_(nom);
    if (enCache) return enCache;
    return _cacheEcrire_(nom, buildStatsForApiBrut_(seasonFilter));
  }

  function buildStatsForApiBrut_(seasonFilter) {
    _syncConfig_();   // MODIFICATION B

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
      const niveau = r[idx["Niveau administratif"]] || "";
      // Genre/catégorie : lus de la colonne si présente, sinon recalculés à la volée
      // (permet d'avoir les stats même sur les lignes historiques non enrichies)
      const codeComp = r[idx["Code compétition"]] || "";
      const libComp = r[idx["Libellé compétition"]] || "";
      const genre = (idx["Genre"] !== undefined && r[idx["Genre"]]) ? r[idx["Genre"]] : detecterGenre_(codeComp, libComp);
      const categorie = (idx["Catégorie d'âge"] !== undefined && r[idx["Catégorie d'âge"]]) ? r[idx["Catégorie d'âge"]] : detecterCategorie_(codeComp, libComp);
      const collegue = r[idx["Collègue nom"]] || "";
      const paiementType = r[idx["Paiement Type"]] || "";
      const datePaiementPrevu = r[idx["Date paiement"]] || "";
      const dateReception = r[idx["Date réception"]] || "";

      const coutReel = realFuelCost_(kmAR, dateStr);
      const bareme = baremeFiscalCost_(kmAR, dateStr);
      const remboursementKm = Number((kmAR * RATE_PER_KM_FFBB).toFixed(2));
      const netReel = Number((indemnite - coutReel).toFixed(2));
      const veh = vehicleForDate_(dateStr).name;

      // Usure/entretien (hors carburant) et empreinte carbone
      const coutUsure = round2_(kmAR * COUT_USURE_PAR_KM);
      const netReelToutCompris = round2_(indemnite - coutReel - coutUsure);
      const litres = round2_(kmAR * vehicleForDate_(dateStr).consoL100 / 100);
      const co2Kg = round2_(litres * CO2_KG_PAR_LITRE_E10);

      const dureeH = (DUREE_MATCH_H[format] || DUREE_MATCH_H.default) + (kmAR ? kmAR / 70 : 0); // trajet ~70km/h
      const eurParHeure = dureeH > 0 ? Number((netReel / dureeH).toFixed(2)) : 0;
      const eurParKm = kmAR > 0 ? Number((indemnite / kmAR).toFixed(2)) : 0;

      // Délai réel de paiement, si le match est encaissé et les deux dates connues
      const dPrevu = parseDate_(datePaiementPrevu);
      const dRecu = parseDate_(dateReception);
      const delaiJours = (dPrevu && dRecu) ? Math.round((dRecu - dPrevu) / 86400000) : null;

      const dMatch = parseDate_(dateStr);
      const jourSemaine = dMatch ? dMatch.getDay() : null; // 0 = dimanche ... 6 = samedi

      const is3x3 = format === "3x3";
      const isBasketCenter = LIEUX_3X3.some(l => normUpper_(recevant).includes(l) || normUpper_(salle).includes(l));

      return {
        format, statut, dateStr, season, kmAR, indemnite, indemniteTheorique, estBenevole,
        statutPaiement, recevant, salle, ville, niveau, collegue,
        genre, categorie, paiementType,
        coutReel, bareme, remboursementKm, netReel, veh, dureeH, eurParHeure, eurParKm, is3x3, isBasketCenter,
        coutUsure, netReelToutCompris, litres, co2Kg, delaiJours, jourSemaine, dateReception,
        isActive: !statut.includes("annul") && format !== "Alerte",
        date: parseDate_(dateStr)
      };
    }).filter(e => e.isActive);

    const filtered = (seasonFilter && seasonFilter !== "Toutes les saisons")
      ? enriched.filter(e => e.season === seasonFilter)
      : enriched;

    const five = filtered.filter(e => e.format === "5x5");
    const three = filtered.filter(e => e.format === "3x3");

    const sum = (arr, k) => arr.reduce((t, e) => t + (Number(e[k]) || 0), 0);
    const avg = (arr, k) => { const v = arr.filter(e => Number(e[k]) > 0); return v.length ? sum(v, k) / v.length : 0; };

    const totalIndemnite = sum(filtered, "indemnite");
    const totalCoutReel = sum(filtered, "coutReel");
    const totalNetReel = sum(filtered, "netReel");
    const totalKm = sum(filtered, "kmAR");
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
    const parNiveau = aggregate_(filtered, e => e.niveau || "Inconnu");
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
    const projection = calculerProjection_(seasonFilter, filtered, totalNetReel);

    // ===== Score de rentabilité par mission (0-100, relatif aux missions affichées) =====
    const classementRentabilite = classerRentabilite_(filtered);

    // Records
    const maxKm = maxByKey_(filtered, "kmAR");
    const maxIndemnite = maxByKey_(filtered, "indemnite");
    const maxNet = maxByKey_(filtered, "netReel");
    const minEurHeure = minByKey_(filtered.filter(e => e.eurParHeure > 0), "eurParHeure");

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
        recu_total: round2_(sum(recu, "indemnite")),
        a_recevoir_total: round2_(sum(aRecevoir, "indemnite")),
        nb_recu: recu.length,
        nb_a_recevoir: aRecevoir.length,
        nb_benevole: benevoles.length,
        benevolat_total: round2_(sum(benevoles, "indemnite"))
      },
      moyennes: {
        indemnite_par_5x5: round2_(avg(five, "indemnite")),
        indemnite_par_3x3: round2_(avg(three, "indemnite")),
        net_reel_par_mission: round2_(avg(filtered, "netReel")),
        km_par_5x5: round2_(avg(five, "kmAR")),
        km_par_3x3: round2_(avg(three, "kmAR")),
        eur_par_km: round2_(totalKm > 0 ? totalIndemnite / totalKm : 0),
        eur_par_heure_moyen: round2_(avg(filtered, "eurParHeure")),
        cout_reel_par_100km: round2_(totalKm > 0 ? (totalCoutReel / totalKm) * 100 : 0)
      },
      cout_complet: {
        cout_usure_total: round2_(totalUsure),
        net_reel_tout_compris: round2_(totalNetToutCompris),
        cout_usure_par_km: COUT_USURE_PAR_KM,
        km_equilibre: kmEquilibre,
        note: "Le carburant est le seul coût réellement décaissé au fil de l'eau. L'usure (pneus, entretien, décote) est une estimation à " + COUT_USURE_PAR_KM.toFixed(2) + " €/km, non versée par personne — elle sert à donner un net réel plus complet."
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
        note: dateReceptionSuspecte_
          ? "La date " + dateReceptionSuspecte_ + " revient sur un grand nombre de paiements — probablement une correction en lot passée plutôt que de vraies dates de réception. Exclue du calcul de délai."
          : ""
      },
      regularite: regularite,
      fidelite_geographique: fidelite,
      projection_saison: projection,
      classement_rentabilite: classementRentabilite,
      records: {
        plus_gros_deplacement: maxKm ? { km: maxKm.kmAR, lieu: maxKm.recevant || maxKm.salle, date: maxKm.dateStr } : null,
        plus_grosse_indemnite: maxIndemnite ? { montant: maxIndemnite.indemnite, lieu: maxIndemnite.recevant, date: maxIndemnite.dateStr } : null,
        meilleur_net_reel: maxNet ? { net: maxNet.netReel, lieu: maxNet.recevant, date: maxNet.dateStr } : null,
        pire_rentabilite_horaire: minEurHeure ? { eur_heure: minEurHeure.eurParHeure, lieu: minEurHeure.recevant || minEurHeure.salle, date: minEurHeure.dateStr } : null
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
      vehicules: VEHICLES.map(v => ({ nom: v.name, conso: v.consoL100, cv: v.cv })),
      prix_carburant: FUEL_PRICE_PER_L,
      note_3x3: "Les lieux " + LIEUX_3X3.join(", ") + " sont exclusivement 3x3 — comptés uniquement dans les stats 3x3."
    };
  }

  function aggregate_(arr, keyFn) {
    const map = {};
    arr.forEach(e => {
      const key = String(keyFn(e) || "").trim();
      if (!key || key === "Sans date") return;
      if (!map[key]) map[key] = { label: key, count: 0, indemnite: 0, cout_reel: 0, net_reel: 0, km: 0 };
      map[key].count++;
      map[key].indemnite += e.indemnite || 0;
      map[key].cout_reel += e.coutReel || 0;
      map[key].net_reel += e.netReel || 0;
      map[key].km += e.kmAR || 0;
    });
    return Object.values(map)
      .map(m => ({ label: m.label, count: m.count, indemnite: round2_(m.indemnite), cout_reel: round2_(m.cout_reel), net_reel: round2_(m.net_reel), km: round2_(m.km) }))
      .sort((a, b) => b.count - a.count || b.indemnite - a.indemnite);
  }

  function maxByKey_(arr, k) { let best = null, bv = -Infinity; arr.forEach(e => { const v = Number(e[k]) || 0; if (v > bv) { bv = v; best = e; } }); return bv > 0 ? best : null; }
  function minByKey_(arr, k) { let best = null, bv = Infinity; arr.forEach(e => { const v = Number(e[k]) || 0; if (v < bv) { bv = v; best = e; } }); return best; }

  function monthKey_(date) {
    if (!date) return "Sans date";
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }

  function normSeason_(value, dateStr) {
    if (value && value.includes("/")) return value;
    const d = parseDate_(dateStr);
    if (d) { const sy = getSeasonStartYear_(d); return sy + "/" + (sy + 1); }
    return "";
  }

  function num_(v) {
    if (v === "" || v === null || v === undefined) return 0;
    const n = Number(String(v).replace(",", ".").replace(/[^\d.-]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  function round2_(n) { return Number((Number(n) || 0).toFixed(2)); }
  function normUpper_(v) { return normalize_(v); }

  /* Détecte une date de réception "en lot" : si une seule date représente
     30% ou plus des paiements reçus avec délai calculable, elle est très
     probablement issue d'une correction en masse plutôt que de vraies
     dates individuelles. Renvoie cette date (ou "" si rien de suspect). */
  function detecterDateSuspecte_(filtered) {
    const avecDate = filtered.filter(e => e.delaiJours !== null);
    if (avecDate.length < 5) return "";

    const freq = {};
    avecDate.forEach(e => { freq[e.dateReception] = (freq[e.dateReception] || 0) + 1; });

    let dateTop = "", maxCount = 0;
    Object.entries(freq).forEach(([d, c]) => { if (c > maxCount) { maxCount = c; dateTop = d; } });

    return (maxCount / avecDate.length >= 0.30) ? dateTop : "";
  }

  /* Délai réel de paiement (jours entre date prévue et date de réception),
     regroupé par type de paiement (comité / ligue / club). */
  function aggregerDelais_(avecDelai) {
    const map = {};
    avecDelai.forEach(e => {
      const key = e.paiementType || "Non précisé";
      if (!map[key]) map[key] = { label: key, delais: [], enRetard: 0 };
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

  /* Régularité des revenus : coefficient de variation mensuel, jour de la
     semaine dominant, écart-type. Un coefficient de variation élevé
     signifie une activité "en dents de scie", faible = régulière. */
  function calculerRegularite_(moisAgg, filtered) {
    const nets = moisAgg.map(m => m.net_reel);
    const n = nets.length;

    if (n < 2) {
      return { coefficient_variation: null, ecart_type_mensuel: null, mois_analyses: n, jour_dominant: "", repartition_jours: [] };
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
      if (!parJour[nom]) parJour[nom] = { label: nom, count: 0, net: 0 };
      parJour[nom].count++;
      parJour[nom].net += e.netReel;
    });
    const repartitionJours = Object.values(parJour)
      .map(j => ({ label: j.label, count: j.count, net_reel: round2_(j.net) }))
      .sort((a, b) => b.count - a.count);

    return {
      coefficient_variation: coefVariation,
      ecart_type_mensuel: round2_(ecartType),
      mois_analyses: n,
      jour_dominant: repartitionJours.length ? repartitionJours[0].label : "",
      repartition_jours: repartitionJours
    };
  }

  /* Fidélité géographique : nombre de lieux distincts, et indice de
     concentration (proche de 100 = toujours les mêmes salles, proche de 0
     = très dispersé). Basé sur un indice de Herfindahl simplifié. */
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
      return { salles_distinctes: 0, villes_distinctes: 0, indice_concentration: null, salle_principale: null, part_salle_principale: null };
    }

    const parts = Object.values(parSalle).map(c => c / total);
    const indiceConcentration = round2_(parts.reduce((t, p) => t + p * p, 0) * 100);

    let salleTop = "", maxCount = 0;
    Object.entries(parSalle).forEach(([s, c]) => { if (c > maxCount) { maxCount = c; salleTop = s; } });

    return {
      salles_distinctes: salles.length,
      villes_distinctes: villesUniques.size,
      indice_concentration: indiceConcentration,
      salle_principale: salleTop || null,
      part_salle_principale: salleTop ? round2_((maxCount / total) * 100) : null
    };
  }

  /* Projection de fin de saison : extrapole le net réel probable en fin de
     saison sportive, à partir du rythme actuel. Ne s'applique que si la
     saison choisie est la saison EN COURS (sinon la saison est déjà connue
     dans son intégralité, une projection n'aurait pas de sens). */
  function calculerProjection_(seasonFilter, filtered, totalNetReel) {
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

    const joursEcoules = Math.max(1, Math.round((aujourdhui - debut) / 86400000));
    const joursTotal = Math.round((fin - debut) / 86400000);
    const fractionEcoulee = joursEcoules / joursTotal;

    if (fractionEcoulee < 0.05) return null; // trop tôt dans la saison pour extrapoler

    const projectionNet = round2_(totalNetReel / fractionEcoulee);
    const projectionMissions = Math.round(filtered.length / fractionEcoulee);

    return {
      saison: saisonActuelle,
      pourcentage_saison_ecoule: round2_(fractionEcoulee * 100),
      net_reel_actuel: round2_(totalNetReel),
      net_reel_projete_fin_saison: projectionNet,
      missions_actuelles: filtered.length,
      missions_projetees_fin_saison: projectionMissions
    };
  }

  /* Score de rentabilité par mission (0-100), basé sur le rang percentile
     du €/heure au sein des missions analysées. 100 = la plus rentable de
     la période, 0 = la moins rentable. Renvoie le top 5 et le bottom 5. */
  function classerRentabilite_(filtered) {
    const avecTaux = filtered.filter(e => e.eurParHeure !== 0 && e.kmAR > 0);
    if (avecTaux.length < 3) return { top: [], bottom: [] };

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
    return { season: "", totaux: {}, moyennes: {}, records: {}, par_saison: [], par_mois: [], par_niveau: [], top_clubs: [], top_salles: [], top_villes: [], top_collegues: [], evenements_3x3: [] };
  }

  /*************** PAIEMENTS EN LOT (ancien 2e script, fusionné + verrou) ***************/
  // Marque comme "Reçu" tous les paiements prévus jusqu'à une date donnée.
  // Protégé par le même verrou que le scan mail (jamais d'écriture concurrente).
  // À exécuter manuellement quand tu reçois un lot de paiements.

  function marquerPaiementsRecusJusquA_(dateLimiteStr, dateReceptionStr) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { log_("LOCK", "Paiements : traitement déjà en cours"); return; }

    try {
      const sheet = getSS_().getSheetByName(SHEET_MATCHS);
      if (!sheet) throw new Error("Onglet MATCHS introuvable.");

      const dateLimite = parseDate_(dateLimiteStr) || new Date();
      const dateReception = dateReceptionStr || formatDate_(new Date());

      const values = sheet.getDataRange().getValues();
      if (values.length < 2) { log_("PAIEMENTS", "Aucune donnée."); return; }

      const headers = values[0].map(h => String(h).trim());
      const cDatePaiement = headers.indexOf("Date paiement");
      const cStatutPaiement = headers.indexOf("Statut paiement");
      const cDateReception = headers.indexOf("Date réception");
      const cMontantRecu = headers.indexOf("Montant reçu");
      const cIndemnite = headers.indexOf("Indemnité totale");
      const cStatut = headers.indexOf("Statut");

      [["Date paiement", cDatePaiement], ["Statut paiement", cStatutPaiement], ["Date réception", cDateReception], ["Montant reçu", cMontantRecu], ["Indemnité totale", cIndemnite]]
        .forEach(([n, i]) => { if (i === -1) throw new Error("Colonne manquante : " + n); });

      let updated = 0, skipped = 0;

      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const statut = cStatut !== -1 ? String(row[cStatut] || "").toLowerCase() : "";
        if (statut.includes("annul")) { skipped++; continue; }

        const dp = parseDate_(row[cDatePaiement]);
        if (!dp || dp > dateLimite) { skipped++; continue; }

        // Ne pas rétrograder / ne pas réécrire ce qui est déjà reçu
        if (normUpper_(row[cStatutPaiement]) === "RECU") { skipped++; continue; }

        const rowNumber = i + 1;
        sheet.getRange(rowNumber, cStatutPaiement + 1).setValue("Reçu");
        sheet.getRange(rowNumber, cDateReception + 1).setValue(dateReception);
        if (row[cMontantRecu] === "" || row[cMontantRecu] === null) {
          sheet.getRange(rowNumber, cMontantRecu + 1).setValue(row[cIndemnite]);
        }
        updated++;
      }

      _cacheInvalider_();
      log_("PAIEMENTS", updated + " passé(s) en Reçu, " + skipped + " ignoré(s).");
    } catch (e) {
      log_("PAIEMENTS_ERROR", e.stack || e.message);
      throw e;
    } finally {
      lock.releaseLock();
    }
  }

  /*************** BACKFILL GENRE / CATÉGORIE ***************/
  // Remplit les colonnes Genre et Catégorie d'âge sur toutes les lignes
  // existantes, à partir du code et du libellé de compétition.
  // Rapide (aucun appel réseau) : traite toute la base en une exécution.

  function backfillGenreCategorie_() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { log_("LOCK", "Backfill genre déjà en cours"); return; }

    try {
      ensureSheets_();
      const sheet = getSS_().getSheetByName(SHEET_MATCHS);
      const headerMap = getHeaderMap_(sheet);

      const genreCol = headerMap[normalizeHeader_("Genre")];
      const catCol = headerMap[normalizeHeader_("Catégorie d'âge")];
      const codeCol = headerMap[normalizeHeader_("Code compétition")];
      const libCol = headerMap[normalizeHeader_("Libellé compétition")];

      if (!genreCol || !catCol || !codeCol || !libCol) {
        log_("BACKFILL_GENRE", "Colonnes manquantes — exécute setup() d'abord");
        return;
      }

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;

      const nb = lastRow - 1;
      const codes = sheet.getRange(2, codeCol, nb, 1).getDisplayValues();
      const libs = sheet.getRange(2, libCol, nb, 1).getDisplayValues();
      const genres = sheet.getRange(2, genreCol, nb, 1).getValues();
      const cats = sheet.getRange(2, catCol, nb, 1).getValues();

      let done = 0;
      for (let i = 0; i < nb; i++) {
        const g = detecterGenre_(codes[i][0], libs[i][0]);
        const c = detecterCategorie_(codes[i][0], libs[i][0]);
        if (g && genres[i][0] !== g) { genres[i][0] = g; done++; }
        if (c && cats[i][0] !== c) { cats[i][0] = c; }
      }

      // Écriture en un seul bloc : bien plus rapide que cellule par cellule
      sheet.getRange(2, genreCol, nb, 1).setValues(genres);
      sheet.getRange(2, catCol, nb, 1).setValues(cats);

      _cacheInvalider_();
      log_("BACKFILL_GENRE", done + " ligne(s) enrichie(s) en genre/catégorie.");
    } catch (e) {
      log_("BACKFILL_GENRE_ERROR", e.stack || e.message);
    } finally {
      lock.releaseLock();
    }
  }

  /*************** BACKFILL NOMS DE CLUBS ***************/
  // Répare les lignes enregistrées avant le FIX #7 : « ASA WEYERSHEIM Maillot :
  // GRENAT KAISER ESTELLE » redevient « ASA WEYERSHEIM ».
  // Purement textuel — aucun OCR, aucun appel réseau : toute la base en une
  // exécution. Idempotent : une ligne déjà propre n'est pas retouchée.

  function nettoyerNomClub_(valeur) {
    var v = clean_(valeur);
    if (!v) return v;

    // Tout ce qui suit « Maillot : » appartient au maillot puis au correspondant
    v = v.replace(/\s*Maillot\s*:.*$/i, "");
    // Résidus éventuels selon les mises en page
    v = v.replace(/\s*\(Mail\s*:.*$/i, "");
    v = v.replace(/\s*Correspondant\s*:.*$/i, "");
    v = v.replace(/\s*T[ée]l[ée]phone\s*:.*$/i, "");
    // FIX #8 : un code officiel resté collé au nom n'a rien à faire ici
    if (typeof sansCodeClub_ === "function") v = sansCodeClub_(v);

    return clean_(v).replace(/[\s:;,-]+$/, "").trim();
  }

  function backfillNomsClubs_() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { log_("LOCK", "Nettoyage noms déjà en cours"); return; }

    try {
      const sheet = getSS_().getSheetByName(SHEET_MATCHS);
      const headerMap = getHeaderMap_(sheet);

      const colRecevant = headerMap[normalizeHeader_("Recevant")];
      const colVisiteur = headerMap[normalizeHeader_("Visiteur / événement")];
      if (!colRecevant || !colVisiteur) { log_("BACKFILL_NOMS", "Colonnes introuvables"); return; }

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      const nb = lastRow - 1;

      const recevants = sheet.getRange(2, colRecevant, nb, 1).getValues();
      const visiteurs = sheet.getRange(2, colVisiteur, nb, 1).getValues();

      let corriges = 0;
      const exemples = [];

      for (let i = 0; i < nb; i++) {
        [recevants, visiteurs].forEach(function (col) {
          const avant = String(col[i][0] || "");
          const apres = nettoyerNomClub_(avant);
          if (apres && apres !== avant) {
            if (exemples.length < 5) exemples.push(avant + "  ->  " + apres);
            col[i][0] = apres;
            corriges++;
          }
        });
      }

      // Écriture en un seul bloc par colonne : bien plus rapide
      sheet.getRange(2, colRecevant, nb, 1).setValues(recevants);
      sheet.getRange(2, colVisiteur, nb, 1).setValues(visiteurs);

      exemples.forEach(function (e) { Logger.log(e); });
      Logger.log("%s nom(s) de club corrigé(s) sur %s ligne(s).", corriges, nb);
      _cacheInvalider_();
      log_("BACKFILL_NOMS", corriges + " nom(s) de club corrigé(s).");
    } catch (e) {
      log_("BACKFILL_NOMS_ERROR", e.stack || e.message);
      throw e;
    } finally {
      lock.releaseLock();
    }
  }

  /*************** BACKFILL KM MANQUANTS (OSM) ***************/
  // Passe sur les lignes sans "Km A/R stats" et les remplit via OSM.
  // À exécuter manuellement de temps en temps (lent : ~1 req/s pour respecter Nominatim).

  function backfillKmManquants_(maxLignes) {
    _syncConfig_();   // MODIFICATION B : part de l'adresse à jour

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) { log_("LOCK", "Backfill KM déjà en cours"); return; }

    try {
      const sheet = getSS_().getSheetByName(SHEET_MATCHS);
      const headerMap = getHeaderMap_(sheet);
      const kmCol = headerMap[normalizeHeader_("Km A/R stats")];
      const adrCol = headerMap[normalizeHeader_("Adresse")];
      const villeCol = headerMap[normalizeHeader_("Ville")];
      if (!kmCol || !adrCol) { log_("BACKFILL", "Colonnes manquantes"); return; }

      const lastRow = sheet.getLastRow();
      const limit = maxLignes || 20;
      let done = 0;

      for (let r = 2; r <= lastRow && done < limit; r++) {
        const km = sheet.getRange(r, kmCol).getValue();
        if (km) continue;
        const adr = sheet.getRange(r, adrCol).getDisplayValue();
        const ville = villeCol ? sheet.getRange(r, villeCol).getDisplayValue() : "";
        const query = [adr, ville].filter(Boolean).join(" ");
        if (!query) continue;

        const kmAR = osrmRoundTripKm_(query);
        if (kmAR) { sheet.getRange(r, kmCol).setValue(kmAR); done++; }
      }

      _cacheInvalider_();
      log_("BACKFILL", done + " ligne(s) KM complétée(s) via OSM.");
    } catch (e) {
      log_("BACKFILL_ERROR", e.stack || e.message);
    } finally {
      lock.releaseLock();
    }
  }

  return { setup, auto, testMailInstant, doGet, marquerPaiementsRecusJusquA_,
         backfillKmManquants_, backfillGenreCategorie_, backfillNomsClubs_,
         nettoyerNomClub_, majPrixCarburantActuel_,
         buildStatsForApi_, realFuelCost_ };
})();
