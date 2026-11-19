/* Referee Tracker — nouveautés de la version en cours (bandeau automatique 24 h + fenêtre « Ce qui change »).
   Fichier lu par l'app (index.html) ET l'administration (admin.html, page Communication).
   À CHAQUE mise en ligne visible pour les arbitres : changer version (bNNN), sortie (AAAA-MM-JJ), la phrase du bandeau
   et 3 à 5 lignes de la liste ; texte validé par Clément avant la mise en ligne. Le bandeau s'affiche seul 24 h pour chaque arbitre. */
"use strict";
window.RT_NOUV = { version: "b130", sortie: "2026-11-21", texte: "Nouvelle version : écran de connexion sur un terrain de basket, filière en échelle, rapports plus clairs et Accueil plus lisible sur téléphone." };
window.RT_NOUVEAUTES = [
  ["◎", "Connexion sur le terrain", "L'écran de connexion se pose au centre d'un terrain de basket. L'écran d'accueil des conditions est aussi plus simple à cocher."],
  ["▲", "Filière en échelle", "Les grades déjà franchis sont cochés et ta place est mise en avant, avec « Toi »."],
  ["i", "Bulles d'aide", "Un « i » explique chaque page (Progression, e-Licence, Rapports, Équipement…). Touche « Compris » pour le fermer."],
  ["!", "Rapports et Règlement", "Chaque formulaire officiel a sa couleur et son délai. Dans Règlement, touche un exemple pour le copier dans ta question."],
  ["⌂", "Accueil sur téléphone", "Les matchs du week-end sont plus lisibles : heure et montant en haut, équipes sur toute la largeur."]
];
