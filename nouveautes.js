/* Referee Tracker — nouveautés de la version en cours (bandeau automatique 24 h + fenêtre « Ce qui change »).
   Fichier lu par l'app (index.html) ET l'administration (admin.html, page Communication).
   À CHAQUE mise en ligne visible pour les arbitres : changer version (bNNN), sortie (AAAA-MM-JJ), la phrase du bandeau
   et 3 à 5 lignes de la liste ; texte validé par Clément avant la mise en ligne. Le bandeau s'affiche seul 24 h pour chaque arbitre. */
"use strict";
window.RT_NOUV = { version: "b157", sortie: "2026-11-21", texte: "Nouvelle version : montants plus fiables au rechargement, animations plus discrètes, recherche plus légère." };
window.RT_NOUVEAUTES = [
  ["€", "Montants fiables", "Les montants affichés ne bougent plus quand tu recharges l'app."],
  ["◎", "Animations plus discrètes", "Les chiffres et les graphiques s'animent une seule fois, quand tu arrives sur une page."],
  ["⌕", "Recherche plus légère", "Le panneau Recherche & Filtre s'ouvre à la place de la loupe, en verre transparent."],
  ["+", "Ajouter un match", "Un bouton sur la liste des matchs explique comment ajouter une convocation, nouvelle ou ancienne."]
];

/* b136 — CATALOGUE DES MODIFICATIONS visibles pour les arbitres (le plus récent en haut).
   Sert à l'admin (Envois › Mail « Les grandes nouveautés ») : Clément y choisit jusqu'à 5 modifications, dans l'ordre,
   et le mail se remplit tout seul. grande: true = grande nouveauté (proposée en premier).
   À CHAQUE version visible : ajouter une ligne ici (date, titre court, une phrase pour l'arbitre). */
window.RT_MODIFS = [
  { id: "montants-fiables", date: "2026-11-21", grande: false, titre: "Des montants fiables", texte: "Les montants affichés ne bougent plus quand tu recharges l'app." },
  { id: "ajout-match", date: "2026-11-21", grande: false, titre: "Ajouter un match, simplement", texte: "Un bouton sur la liste des matchs explique comment ajouter une convocation, nouvelle ou ancienne." },
  { id: "connexion-terrain", date: "2026-11-21", grande: false, titre: "Connexion sur un terrain de basket", texte: "L'écran de connexion se pose au centre d'un terrain, et l'écran des conditions est plus simple à cocher." },
  { id: "filiere-echelle", date: "2026-11-21", grande: false, titre: "Ta filière en échelle", texte: "Dans Progression, les grades franchis sont cochés et ta place est marquée « Toi »." },
  { id: "rapports-clairs", date: "2026-11-21", grande: false, titre: "Des rapports plus clairs", texte: "Chaque formulaire officiel a sa couleur et son délai d'envoi bien visible (sous 24 h, sous 72 h)." },
  { id: "aide-i", date: "2026-11-21", grande: false, titre: "Des bulles d'aide sur chaque page", texte: "Un « i » explique à quoi sert chaque page : Progression, e-Licence, Rapports, Équipement…" },
  { id: "accueil-tel", date: "2026-11-21", grande: false, titre: "L'Accueil plus lisible sur téléphone", texte: "Tes matchs du week-end : l'heure et le montant en haut, les équipes sur toute la largeur." },
  { id: "niveau-liste", date: "2026-11-20", grande: false, titre: "Ton niveau dans une liste", texte: "Plus de saisie à la main : choisis ton grade dans la liste officielle de la filière, dans Mon profil." },
  { id: "progression", date: "2026-11-20", grande: true, titre: "Une nouvelle Progression", texte: "Tes fiches d'observation sont mieux lues : notes sur 100, points forts, axes de travail et ta place dans la filière d'un coup d'œil." },
  { id: "reglement-3x3", date: "2026-11-19", grande: true, titre: "Le règlement 3x3", texte: "Le règlement 3x3 est disponible dans l'onglet Règlement : pose ta question, l'IA te répond avec les articles à l'appui." },
  { id: "ref-clips", date: "2026-11-19", grande: true, titre: "REF CLIPS", texte: "Des vidéos d'actions de match pour t'entraîner à prendre la bonne décision, comme sur le terrain." },
  { id: "agenda-perso", date: "2026-11-18", grande: true, titre: "Ton agenda rien qu'à toi", texte: "Tes matchs arrivent dans ton propre agenda « Referee Tracker », partagé avec toi : plus de mélange avec d'autres arbitres." },
  { id: "annulations", date: "2026-11-18", grande: true, titre: "Les annulations repérées toutes seules", texte: "Quand une désignation est annulée par mail, l'app retrouve le bon match et le passe en annulé, même si plusieurs matchs se ressemblent." },
  { id: "3x3-journee", date: "2026-11-18", grande: false, titre: "3x3 : journée ou demi-journée", texte: "Pour un tournoi 3x3, indique si tu es là la journée ou la demi-journée : le bon barème est appliqué." },
  { id: "estimations", date: "2026-11-18", grande: true, titre: "Des estimations revues", texte: "Le calcul de ce que tu vas toucher a été revu : indemnités, km, trajets en passager et reste à percevoir sont estimés plus justement." },
  { id: "retablir", date: "2026-11-18", grande: false, titre: "Rétablir une mission retirée", texte: "Une mission retirée par erreur se rétablit en un clic dans Analyse › Suivi › Matchs annulés." },
  { id: "app-rapide", date: "2026-11-18", grande: false, titre: "Une app plus rapide", texte: "Démarrage plus rapide, moins d'attente au chargement et une déconnexion plus propre." }
];
