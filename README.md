# Roadtrip Finistère 🚐

Petit site (100% statique, sans backend) pour préparer et suivre un roadtrip en van dans le Finistère : une carte sur laquelle on note ses étapes.

Deux catégories de points :

- **🏄 Activités** : plage, surf, randonnée, point de vue, visite...
- **🚐 Dodo** : parking van aménagé, aire de camping-car, camping, bivouac...

## Utiliser le site

Aucune installation nécessaire : c'est du HTML/CSS/JS pur.

- En local : ouvrir `index.html` dans un navigateur (ou lancer un petit serveur, ex. `python3 -m http.server`, puis aller sur `http://localhost:8000`).
- En ligne : héberger le dossier sur GitHub Pages (Settings → Pages → déployer depuis la branche), Netlify, Vercel... n'importe quel hébergement de fichiers statiques fonctionne.

## Fonctionnement

1. Cliquer sur **"+ Ajouter un point sur la carte"**, puis cliquer à l'endroit voulu sur la carte.
2. Remplir le formulaire : nom, catégorie, type, date, note (étoiles), infos pratiques.
3. Le point apparaît sur la carte (icône colorée selon la catégorie) et dans la liste à gauche.
4. Cliquer sur un point de la liste ou un marqueur pour le retrouver / le modifier / le supprimer.
5. Le bouton **"Relier les étapes"** trace une ligne entre les points datés, dans l'ordre chronologique — pratique pour visualiser l'itinéraire.

## Sauvegarde des données

Les points sont enregistrés uniquement dans le navigateur (`localStorage`), il n'y a pas de serveur ni de compte.

- **Exporter** : télécharge un fichier `.json` avec tous les points (à faire régulièrement, pour ne pas perdre les données si le cache du navigateur est effacé, et pour les transférer sur un autre appareil).
- **Importer** : recharge un fichier `.json` exporté précédemment (remplace les données actuelles).

Le bouton **"Charger des exemples"** ajoute quelques points connus du Finistère (Pointe du Raz, La Torche...) pour visualiser le rendu ; les vraies aires de camping-car / parkings van sont à repérer sur place ou via des apps dédiées (Park4Night, Campercontact) puis à ajouter manuellement.

## Stack technique

- [Leaflet](https://leafletjs.com/) + fonds de carte [OpenStreetMap](https://www.openstreetmap.org/) (via CDN).
- Aucune dépendance de build, aucun framework : `index.html`, `style.css`, `app.js`.
