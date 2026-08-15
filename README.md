# Referee Tracker — V3

Suivi complet de l'arbitrage FFBB : convocations 5×5 et 3×3 lues automatiquement depuis Gmail,
base Google Sheets, agenda, paiements, statistiques et **revenu net réel** (indemnités − carburant).

---

## 1. Architecture

```
Gmail (convocations PDF)
        ↓  scan automatique toutes les 10 min
Apps Script  ──────────────►  Google Sheets (MATCHS / LOGS / PROCESSED_MESSAGES)
   │                                   │
   │  API JSONP (doGet)                └──►  Google Agenda
   ↓
GitHub Pages (index.html + style.css + app.js)
   │
   └──►  Carte OpenStreetMap (Leaflet) + itinéraire OSRM — gratuit, sans clé
```

**Un seul projet Apps Script** contient désormais tout : scan mail, parsing, agenda,
paiements en lot et statistiques (l'ancien second script de paiements a été fusionné dedans).

---

## 2. Installation Apps Script

1. Ouvrir le projet Apps Script lié au Google Sheet.
2. Coller **l'intégralité** de `Code.gs` (remplacer tout l'ancien contenu), puis **Enregistrer**.
3. **Services** (icône `+`) → ajouter **Drive API** (nécessaire à l'OCR des PDF).
4. Exécuter `testerOcrIsole` une fois à la main → accepter les autorisations Google.
   Les logs doivent afficher `OCR RÉUSSI`.
5. Exécuter `setup()` puis `testMailInstant()` à la main, vérifier l'onglet `LOGS`.
6. Quand tout est bon : exécuter `auto()` (installe le déclencheur toutes les 10 min).
7. **Déployer → Gérer les déploiements → crayon → Version : Nouvelle version → Déployer.**
   ⚠️ Sans cette dernière étape, l'URL `/exec` continue de servir l'ancien code.

### Fonctions exécutables à la main

| Fonction | Rôle |
|---|---|
| `setup()` | Crée les onglets et libellés Gmail |
| `auto()` | Installe le déclencheur automatique (10 min) |
| `testMailInstant()` | Lance un scan des mails immédiatement |
| `testerOcrIsole()` | Teste seulement l'OCR sur un PDF, sans rien écrire |
| `marquerPaiementsRecus()` | Passe en « Reçu » tout ce qui était prévu jusqu'à la date indiquée dans la fonction |
| `completerKmManquants()` | Complète les KM vides via OpenStreetMap (20 lignes par exécution) |

---

## 3. Site GitHub Pages

Copier les 4 fichiers à la racine du dépôt : `index.html`, `style.css`, `app.js`, `README.md`.

```js
// app.js — ligne 8
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxcCrf5.../exec";
const API_KEY = "REFEREE_TRACKER_2026_PRIVATE";
```

L'URL est utilisée telle que Google la fournit, sans préfixe `/u/N/`.
Ajouter un `/u/2/` (ou tout autre index de compte) fait échouer la requête : Google
attend alors ce compte précis, qui ne correspond pas forcément au propriétaire du script.
En cas d'erreur 404 ou « Impossible d'ouvrir le fichier », vérifier en priorité que
l'URL ne contient aucun `/u/N/`.

---

## 4. API (endpoints)

Toutes les requêtes exigent `?key=REFEREE_TRACKER_2026_PRIVATE`.
Ajouter `&callback=nomFonction` pour une réponse JSONP.

| Action | Paramètres | Retour |
|---|---|---|
| `ping` | — | Test de disponibilité |
| `matchs` | — | Toutes les lignes de MATCHS |
| `stats` | `season` (optionnel) | Tous les KPI calculés côté serveur |
| `config` | — | Adresse de départ, taux/km, véhicules, prix carburant |
| `updatePaymentStatus` | `uid`, `status` | Met à jour un statut de paiement |

Exemple :
```
.../exec?key=REFEREE_TRACKER_2026_PRIVATE&action=stats&season=2025/2026
```

---

## 5. Calculs financiers

### Ce qui est **versé** par la FFBB
```
(distance domicile → salle × 0,40 € × 2)  +  indemnité de match
```
Les chevaux fiscaux **n'entrent jamais** dans ce calcul. Le montant figure déjà
dans la convocation et est lu directement (colonne « Indemnité totale »).

### Ce que ça **coûte** réellement
```
km A/R × (consommation L/100 ÷ 100) × prix du litre
```

| Véhicule | Période | Consommation | CV |
|---|---|---|---|
| Peugeot 108 | jusqu'au 31/07/2026 | 6,58 L/100 (relevés réels) | 4 |
| Audi A3 35 TFSI | à partir du 01/08/2026 | 6,00 L/100 | 8 |

Le prix du carburant est une constante à ajuster quand il bouge :
`FUEL_PRICE_PER_L` dans `Code.gs` **et** `FUEL` dans `app.js` (garder les deux identiques).

### Revenu net réel
```
net réel = indemnité versée − coût carburant réel
```

Le KPI « équivalent barème fiscal » est affiché **à titre indicatif uniquement** :
il ne correspond à rien de ce qui est versé.

---

## 6. Statistiques disponibles

- Revenu net réel, indemnités brutes, coût carburant, déjà reçu / reste à percevoir
- € par km, € par heure (trajet inclus), coût réel aux 100 km
- Moyennes par format (5×5 / 3×3), net moyen par mission
- Agrégations : par saison, par mois, par niveau administratif
- Classements : clubs, salles, villes, collègues
- Records : plus gros déplacement, plus grosse indemnité, meilleur net, pire rentabilité horaire
- **BASKET CENTER** est traité comme un lieu exclusivement 3×3 : il n'apparaît jamais
  dans les classements de salles 5×5, seulement dans les événements 3×3.

---

## 7. Connexion à Claude

L'API est directement exploitable par Claude, sans service payant ni intégration
supplémentaire : il suffit que le skill contienne l'URL et la clé.

À mettre dans le futur skill « revenus arbitrage » :

```
URL   : https://script.google.com/macros/s/AKfycbxETHFQ5vTXTo7ismnGBWscXbKPDiQLw9X6Wgn7U6WEd7FINf8wDSVmBjI9bF_phWmL/exec
Clé   : REFEREE_TRACKER_2026_PRIVATE

Pour les KPI financiers :  ?key=<clé>&action=stats&season=2025/2026
Pour le détail des lignes : ?key=<clé>&action=matchs
```

Claude lit ces URL directement. Le endpoint `stats` renvoie déjà tous les calculs
(net réel, coût carburant, agrégations), donc aucun recalcul n'est nécessaire de son côté.

⚠️ **Sécurité** : l'URL + la clé donnent un accès en lecture et en écriture à toute la base.
À ne pas publier ailleurs que dans un espace privé.

---

## 8. Dépannage

### Page de diagnostic

`diagnostic.html` (à copier à la racine du dépôt, à côté de `index.html`) teste l'URL,
l'appel direct (fetch/CORS) et l'appel JSONP, puis affiche la cause exacte et la marche
à suivre. À ouvrir en premier dès que le site n'affiche plus de données.

### Comment le site parle à l'API

`app.js` appelle l'API en **fetch (CORS)** d'abord — c'est ce qui donne le vrai code HTTP
et fonctionne sur tous les navigateurs — et retombe automatiquement sur le **JSONP**
si fetch est bloqué (réseau filtré, extension). Le déploiement doit être en
accès **« Tout le monde »** pour que fetch reçoive l'en-tête CORS de Google.

| Symptôme | Cause probable | Solution |
|---|---|---|
| `Impossible de contacter l'API` / HTTP 404 | Déploiement supprimé, ou accès ≠ « Tout le monde » | Déployer → Gérer les déploiements → ✏️ → accès **Tout le monde** → Nouvelle version → recopier l'URL `/exec` |
| Page HTML de connexion Google renvoyée | Déploiement réservé aux comptes Google | Même correction : accès « Tout le monde » |
| `Clé API invalide` | Clé différente entre `app.js` et `Code.gs` | Vérifier `API_PRIVATE_KEY` |
| Erreur 404 / « Impossible d'ouvrir le fichier » | L'URL contient un `/u/N/` | Utiliser l'URL brute donnée par Google, sans `/u/N/` |
| « Impossible d'ouvrir le fichier » | Autorisations jamais validées | Exécuter une fonction à la main et accepter |
| Modifications sans effet | Déploiement pas mis à jour | Déployer → Nouvelle version |
| Aucun PDF lu | Drive API non ajoutée | Services → Drive API |
| KM vides sur les 3×3 | Adresse non géocodable | Lancer `completerKmManquants()` |
