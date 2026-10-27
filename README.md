# Match Logger — version mobile

Application web installable (PWA) pour saisir les matchs et consulter les statistiques depuis un téléphone Android. Elle fonctionne hors connexion. Les données (joueurs et matchs) sont stockées **uniquement sur le téléphone** : rien n'est envoyé sur internet, et ce dépôt ne contient aucune donnée personnelle.

Fonctions reprises de `statistics.py` :

- **Match** : informations du match, terrain selon la composition, joueurs, buts et passeurs, cartons, temps de jeu, remplaçants et 3 étoiles. Le brouillon est conservé si l'app est fermée.
- **Matchs** : liste, détail, modification, suppression, import et export, vérification de cohérence.
- **Stats** : rapport cumulé, statistiques par joueur, onze titulaires de chaque match, sur une sélection de matchs.
- **Club** : classements par équipe et par compétition (championnat, coupe, cumulé), et export CSV.
- **Réglages** : import et export de `config.json`, gestion des joueurs.

## Mise en ligne sur GitHub Pages (gratuit)

1. Crée un dépôt sur GitHub, par exemple `match-logger`. Il peut être public, puisqu'il ne contient que le code.
2. Envoie le **contenu** de ce dossier à la racine du dépôt :
   ```sh
   cd match-logger-mobile
   git init
   git add .
   git commit -m "Version mobile"
   git branch -M main
   git remote add origin https://github.com/<ton-pseudo>/match-logger.git
   git push -u origin main
   ```
3. Sur GitHub, ouvre **Settings → Pages**, choisis **Source : Deploy from a branch**, puis la branche `main` et le dossier `/ (root)`. Clique sur **Save**.
4. Une à deux minutes plus tard, l'app est accessible à l'adresse `https://<ton-pseudo>.github.io/match-logger/`.

> Ne mets pas `config.json` ni les fichiers de matchs dans ce dépôt : ils contiennent les noms des joueurs.

## Installation sur le téléphone

1. Ouvre l'adresse dans **Chrome** sur Android.
2. Ouvre le menu ⋮, puis choisis **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
3. Dans l'app, va dans **Réglages** puis **Importer config.json** pour charger la liste des joueurs. Transfère le fichier sur le téléphone avant, par exemple par mail, Drive ou câble USB.

## Récupérer les matchs déjà saisis sur PC

1. Sur le PC, fais un clic droit sur le dossier `A` puis **Compresser en fichier ZIP**, et copie le ZIP sur le téléphone.
2. Dans l'app, ouvre **Matchs**, puis **Importer**, puis **Fichiers / ZIP**.

L'équipe et la compétition sont déduites des dossiers `A/<équipe>/<Championnat|Coupe>/`.

## Sauvegarde et retour sur PC

**Matchs → Tout exporter** produit un ZIP rangé en `A/<équipe>/<Championnat|Coupe|Autre>/<match>.json`. Les fichiers ont exactement le même format que ceux de l'application Python. Décompressé dans le dossier du programme, ce ZIP fonctionne donc aussi avec `statistics.py`.

⚠️ Les matchs n'existent que sur le téléphone. Exporte-les régulièrement : effacer les données de Chrome ou désinstaller l'app les supprime.

## Mettre à jour l'app

Modifie les fichiers, puis fais `git commit` et `git push`. Les téléphones récupèrent la nouvelle version à la prochaine ouverture de l'app avec du réseau. Si tu ajoutes ou renommes un fichier, ajoute-le à la liste `ASSETS` de `sw.js` et incrémente `VERSION`.

## Tester sur le PC

```sh
cd match-logger-mobile
python -m http.server 8000
```

Ouvre ensuite <http://localhost:8000>. Dans Chrome, F12 puis le mode appareil mobile permet de simuler un téléphone. Un simple double-clic sur `index.html` ne fonctionne pas, car les modules JavaScript ont besoin d'un serveur.

## Différences avec la version Python

- **Tri des joueurs par poste** : la liste propose bien d'abord les joueurs du poste. En Python, une différence de majuscules et de minuscules empêchait ce tri.
- **Étoiles** : la pondération est la même partout (1re = 3 pts, 2e = 2, 3e = 1). La fiche joueur Python comptait à l'envers (1re = 1 pt).
- **« 11 titulaires les plus victorieux »** : ce classement est calculé à partir des vrais postes de titulaires, et non des 11 premières entrées du fichier.
- **Victoires « tous joueurs »** : un joueur qui est aussi étoile n'est plus compté deux fois.
- **Équipe et compétition** : ce sont des champs du match, et non plus le dossier où il est rangé. L'export ZIP recrée les dossiers.
