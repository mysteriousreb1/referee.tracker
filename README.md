# Referee Tracker — Interface GitHub Pages

Ce dossier contient l'interface web prête à l'emploi pour afficher les données du Google Sheet Referee Tracker.

## Fichiers inclus

- index.html
- style.css
- app.js

## Installation simple sur GitHub

1. Créer un dépôt GitHub nommé `referee-tracker`.
2. Uploader ces fichiers à la racine du dépôt.
3. Aller dans `Settings` > `Pages`.
4. Choisir :
   - Source : Deploy from a branch
   - Branch : main
   - Folder : /root
5. Cliquer sur Save.
6. Attendre l'URL GitHub Pages.

## API déjà configurée

Le fichier `app.js` utilise déjà ton API Apps Script :

https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec

## Test API

Ping :
https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec?key=REFEREE_TRACKER_2026_PRIVATE&action=ping

Données matchs :
https://script.google.com/macros/s/AKfycbysa6OgFq_vsFUMlOVYyMb2DdTB78JVzuZBHYosFMI4M7IusLzAxknk8TY5rmIaXSHS/exec?key=REFEREE_TRACKER_2026_PRIVATE&action=matchs
