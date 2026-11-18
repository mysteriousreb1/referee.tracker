/* Referee Tracker — nouveautés de la version en cours (bandeau automatique 24 h + fenêtre « Ce qui change »).
   Fichier lu par l'app (index.html) ET l'administration (admin.html, page Communication).
   À CHAQUE mise en ligne visible pour les arbitres : changer version (bNNN), sortie (AAAA-MM-JJ), la phrase du bandeau
   et 3 à 5 lignes de la liste ; texte validé par Clément avant la mise en ligne. Le bandeau s'affiche seul 24 h pour chaque arbitre. */
"use strict";
window.RT_NOUV = { version: "b121", sortie: "2026-11-18", texte: "Nouvelle version : Accueil repensé, notes sur 100, cartes de match plus claires et nouvel écran de connexion." };
window.RT_NOUVEAUTES = [
  ["◔", "Accueil repensé", "Un anneau montre ce que tu as reçu et ce qui reste à venir sur la saison, avec la courbe de ton net mois par mois."],
  ["★", "Notes sur 100", "Toutes tes notes d'observation s'affichent maintenant sur 100, plus faciles à comparer."],
  ["▦", "Cartes de match plus claires", "La date en petit calendrier, ton rôle, les km et « dans 3 j » d'un coup d'œil."],
  ["▤", "Graphiques", "Dans Analyse, « Par mois » et « Par niveau » deviennent des graphiques à barres."],
  ["⇄", "App plus fluide", "Pages qui glissent, chiffres qui défilent, chargements plus doux. Coupé si ton téléphone demande moins d'animations."]
];
