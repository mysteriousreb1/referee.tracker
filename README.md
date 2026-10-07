# Referee Tracker

Suivi complet de l'arbitrage basket FFBB : convocations 5×5 et 3×3 lues automatiquement depuis la boîte mail, base Google Sheets, agenda, paiements, statistiques et **revenu net réel** (indemnités − carburant − entretien).

Site : https://mysteriousreb1.github.io/referee.tracker/

© 2026 Clément REBHOLZ — Tous droits réservés. Reproduction, copie ou réutilisation interdites sans autorisation écrite de l'auteur.

---

## 1. Architecture

```
Boîte mail dédiée (convocations, annulations, relevés FFBB)
        ↓  scan automatique toutes les 10 min (mails hors sujet ignorés)
Apps Script privé  ──────────►  Google Sheets (MATCHS, LOGS, PROCESSED_MESSAGES…)
   │                                   │
   │  API POST authentifiée            ├──►  Google Agenda
   │  (doPost + jeton de session)      └──►  Notifications push (Pushover)
   ↓
GitHub Pages (index.html, app.js, rt-auth.js, style.css, manifest.json)
   │
   └──►  Carte OpenStreetMap (Leaflet) + itinéraire OSRM — gratuit, sans clé
```

- **Ce dépôt ne contient que l'interface.** Le code Apps Script, les données et toute clé restent privés.
- **Connexion obligatoire** : e-mail + mot de passe (PBKDF2), jeton de session de 30 jours envoyé dans le corps des requêtes POST, jamais dans l'URL. Blocage après 8 échecs.
- **Cache à deux niveaux** : navigateur (affichage immédiat) + serveur (CacheService), invalidé à chaque écriture et préchauffé après chaque scan des mails.

---

## 2. Fonctionnalités

| Onglet | Contenu |
|---|---|
| Accueil | Prochain match, week-end en cours, KPI de la saison |
| 5×5 / 3×3 | Missions à venir et passées, regroupées par week-end, carte et itinéraire |
| Paiements | À recevoir ce mois-ci, retards, rapprochement bancaire, analyse des versements par mois et par payeur / niveau / format / mode |
| Stats | Vue d'ensemble, analyse avancée, estimation de fin de saison |
| Hôtel | Nuits et repas des déplacements longs |
| Alertes | Imports à corriger, statuts à trancher, retards de paiement |
| Export | PDF / CSV par saison, mois ou plage de dates |
| QCM, Progression, Règlement | Entraînement à l'examen, suivi de niveau et d'évaluations, questions sur le règlement FIBA |
| e-Licence, Indispos, Rapports, Procédures | Licence à présenter, disponibilités, formulaires officiels, contacts |

Sur téléphone : barre d'onglets en bas et installation sur l'écran d'accueil (`manifest.json`).

---

## 3. Calculs financiers

### Ce qui est **versé** par la FFBB
```
(distance domicile → salle × 0,40 € × 2)  +  indemnité de match
```
Les chevaux fiscaux **n'entrent jamais** dans ce calcul. Le montant est lu sur la convocation (colonne « Indemnité totale »).

### Ce que ça **coûte** réellement
```
km A/R × (consommation L/100 ÷ 100) × prix du litre  +  entretien au km
```
Véhicules, consommation et prix du carburant se règlent dans l'application (Mon profil), par période, sans toucher au code. Le prix du litre suit les données publiques des carburants ; il est figé une fois le match passé.

### Revenu net réel
```
net réel = indemnités − carburant − entretien − (hôtel + repas si nuit sur place)
```

### Doublés
Plusieurs matchs le même jour au même lieu = **un seul trajet** : les km et le carburant ne sont comptés qu'une fois, les indemnités restent cumulées. Pas de doublé en 3×3.

### Suivi des paiements
| Payeur | Délai de référence |
|---|---|
| Comité départemental | Échéancier du comité |
| Ligue régionale | Calendrier de paiement de la Ligue |
| FFBB (Championnat de France séniors) | Relevé de remboursement, virement à partir du 15 du mois |
| Clubs (Championnat de France jeunes, coupes, amicaux) | Jour du match / dépôt la semaine suivante |

Le statut se recalcule seul chaque matin (À recevoir → En retard). « Reçu » n'est posé qu'après pointage du virement (rapprochement bancaire) ou validation manuelle.

---

## 4. Statistiques disponibles

- Revenu net réel, indemnités brutes, carburant, entretien, déjà reçu / reste à percevoir
- € par km, € par heure (trajet inclus), coût réel aux 100 km
- Moyennes par format (5×5 / 3×3), net moyen par mission
- Agrégations : par saison, par mois, par niveau ; comparaison avec la saison précédente
- Classements : clubs, salles, villes, collègues
- Records : plus long déplacement, plus grosse indemnité, meilleur net, pire rentabilité horaire
- **BASKET CENTER** est un lieu exclusivement 3×3 : il n'apparaît jamais dans les classements de salles 5×5.

---

## 5. Mise à jour du site

1. Remplacer les fichiers à la racine du dépôt.
2. Incrémenter le paramètre `?v=` de chaque fichier dans `index.html` (sinon le navigateur sert l'ancienne version en cache).
3. Attendre 1 à 2 minutes la republication de GitHub Pages, puis recharger avec Cmd + Maj + R.

Le back-end se met à jour dans Apps Script : Déployer → Gérer les déploiements → crayon sur le déploiement **existant** → Nouvelle version. Ne jamais créer un second déploiement : le site appelle une URL unique.

---

## 6. Sécurité

- **Aucune clé, aucun mot de passe, aucune donnée personnelle dans ce dépôt.** Les secrets vivent dans les propriétés du script Apps Script.
- Les fichiers `.gs`, les exports et les données sont exclus par `.gitignore`.
- Chaque envoi est contrôlé automatiquement (`.github/workflows/scan-secrets.yml` + `.gitleaks.toml`) : une info sensible fait échouer le contrôle et déclenche une alerte.
- Tout ce qui est dans l'interface est lisible par un visiteur : les données personnelles n'arrivent que par l'API, après connexion.

---

## 7. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Modifications du site sans effet | Cache du navigateur | Vérifier les `?v=` dans `index.html`, puis Cmd + Maj + R |
| Modifications Apps Script sans effet | Déploiement pas mis à jour | Déployer → Gérer les déploiements → crayon → Nouvelle version |
| « Session expirée » | Jeton de plus de 30 jours ou révoqué | Se reconnecter |
| « Action inconnue » sur un bouton | Front plus récent que le back-end | Déployer la version Apps Script correspondante |
| Chargement lent au premier accès | Démarrage à froid d'Apps Script | Patienter ; les données en cache s'affichent en attendant |
| Mission manquante | Convocation non reçue ou mail mal lu | Onglet Alertes, puis onglet LOGS du classeur |
