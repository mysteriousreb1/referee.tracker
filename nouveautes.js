/* Referee Tracker — nouveautés de la version en cours (bandeau automatique 24 h + fenêtre « Ce qui change »).
   Fichier lu par l'app (index.html) ET l'administration (admin.html, page Communication).
   À CHAQUE mise en ligne visible pour les arbitres : changer version (bNNN), sortie (AAAA-MM-JJ), la phrase du bandeau
   et 3 à 5 lignes de la liste ; texte validé par Clément avant la mise en ligne. Le bandeau s'affiche seul 24 h pour chaque arbitre. */
"use strict";
window.RT_NOUV = { version: "b128", sortie: "2026-11-20", texte: "Nouvelle version : niveau à choisir dans une liste, Progression plus claire et une confirmation rapide à la connexion." };
window.RT_NOUVEAUTES = [
  ["▾", "Niveau dans une liste", "Dans Mon profil, ton niveau se choisit maintenant dans la liste officielle de la filière : plus de saisie à la main."],
  ["★", "Progression", "Les notes sont des estimations calculées à partir de tes fiches, c'est maintenant indiqué. Ta place dans la filière est marquée « Toi »."],
  ["✓", "Une confirmation à la connexion", "On te demande une fois de confirmer que Referee Tracker est un outil indépendant, non officiel."],
  ["⌂", "Inscription", "Les arbitres départementaux ne sont plus inscrits d'office en ligue régionale."]
];
