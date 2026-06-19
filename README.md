# Referee Tracker — Interface GitHub Pages

Interface mobile pour suivre les matchs et missions d'arbitrage.

## Fichiers

- `index.html`
- `style.css`
- `app.js`

## Connexion Apps Script

Dans `app.js`, ces deux constantes doivent pointer vers ton Apps Script :

```js
const APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec";
const API_KEY = "REFEREE_TRACKER_2026_PRIVATE";
```

Si tu redéploies Apps Script avec une nouvelle URL, remplace uniquement `APP_SCRIPT_URL`.

## Déploiement GitHub Pages

1. Mets ces fichiers à la racine du dépôt GitHub.
2. Va dans `Settings`.
3. Va dans `Pages`.
4. Source : `Deploy from a branch`.
5. Branch : `main`.
6. Folder : `/root`.
7. Enregistre.
8. Ouvre l'URL GitHub Pages.

## Fonctionnalités

- Filtre saison automatique depuis 2022/2023.
- Bascule de saison au 30 juillet.
- Onglets :
  - Matchs
  - Paiements
  - Stats
  - Alertes
  - Export
- Paiements modifiables depuis l'interface.
- Bouton Waze vers l'adresse.
- Bouton SMS vers le collègue.
- Bouton FBI.
- Statistiques 5x5 / 3x3.
- Top clubs, salles, collègues.
