/* Referee Tracker — nouveautés de la version en cours (bandeau automatique 24 h + fenêtre « Ce qui change »).
   Fichier lu par l'app (index.html) ET l'administration (admin.html, page Communication).
   À CHAQUE mise en ligne visible pour les arbitres : changer version (bNNN), sortie (AAAA-MM-JJ), la phrase du bandeau
   et 3 à 5 lignes de la liste ; texte validé par Clément avant la mise en ligne. Le bandeau s'affiche seul 24 h pour chaque arbitre. */
"use strict";
window.RT_NOUV = { version: "b129", sortie: "2026-11-21", texte: "Nouvelle version : filière en échelle, rapports plus clairs, exemples à toucher dans Règlement et Accueil plus lisible sur téléphone." };
window.RT_NOUVEAUTES = [
  ["▲", "Filière en échelle", "Les grades déjà franchis sont cochés et ta place est mise en avant, avec « Toi »."],
  ["i", "Bulles d'aide", "Un « i » explique chaque page (Progression, e-Licence, Rapports, Équipement…). Touche « Compris » pour le fermer."],
  ["!", "Rapports", "Chaque formulaire officiel a sa couleur et son délai d'envoi bien visible."],
  ["?", "Règlement", "Touche un exemple pour le copier dans ta question."],
  ["⌂", "Accueil sur téléphone", "Les matchs du week-end sont plus lisibles : heure et montant en haut, équipes sur toute la largeur."]
];
