# FlowMap 7.1 - cartes de flux animees dans ArcGIS Pro

Un outil, une table : choisissez la table, les champs dans les menus deroulants,
cliquez sur **Run**. Vous obtenez :

1. **une page HTML autonome** (identique a l'exemple du Yemen : animation, curseur
   de temps, recherche, exports GIF/video/SHP/GeoJSON/CSV) ;
2. **les limites administratives** (regions ADM1 + districts ADM2) des pays ou se
   trouvent les donnees, telechargees automatiquement (geoBoundaries), dessinees
   sur la page ET ajoutees a la carte ;
3. **dans ArcGIS Pro** : couches *Regions*, *Districts*, *Flows* (activee dans le
   temps : ouvrez le **Time Slider** et appuyez sur Play) et *Places* (points
   dimensionnes par volume). Tout est dans `FlowMap.gdb` du dossier de sortie.

## Installation

1. Copiez tout le dossier (il faut `FlowMap.pyt`, `flowmap_core.py`, `index.html`
   et les `.xml`) dans un dossier permanent.
2. Pro : **Insert > Toolbox > Add Toolbox...** puis `FlowMap.pyt`
   (retirez d'abord toute ancienne version de la toolbox : clic droit > Remove).
3. Ouvrez **Flow map > Build a flow map page (7.1)**.

## Utilisation

- **Flow table or layer** : une couche de la carte, ou *Parcourir* vers un CSV,
  une feuille Excel, une table, une classe d'entites.
- Les menus **Place name / Value / Date / Longitude / Latitude** proposent les
  colonnes de cette table (champs natifs de Pro, relies a la table : ils se
  remplissent des que la table est choisie). Aucun champ n'est pre-rempli.
- Il faut au minimum les **noms de lieux** ou les **longitude/latitude** (une
  couche de points n'a besoin d'aucun champ : sa geometrie sert de position).
- **Load the administrative boundaries** (coche par defaut) : les pays sont
  detectes a partir des coordonnees ; si la table n'a que des noms de lieux,
  saisissez les codes pays (ex. `YEM, MLI`) dans *Countries*.
  Premiere execution : internet requis ; ensuite tout est garde dans
  `admin_cache/` du dossier de sortie. Sans internet, la page est quand meme creee.
- Vos propres limites (*Places and outlines*) remplacent celles telechargees.

## Si quelque chose ne marche pas

Executez `python check_install.py` (Python Command Prompt de ArcGIS Pro) :
il verifie les fichiers, la version, les menus de champs et l'acces internet.

## Hors ArcGIS

```
python flowmap_core.py demo --out demo.html
python flowmap_core.py selftest
```

## Limites connues

- La page HTML dessine les limites admin sur fond sombre ; elle n'embarque pas de
  tuiles de fond de carte (elle reste un fichier unique, utilisable hors ligne).
  Le fond de carte (imagerie, rues) est celui de votre carte ArcGIS Pro.
- Les limites geoBoundaries sont simplifiees (legeres) ; les noms de districts de
  votre table et ceux de geoBoundaries peuvent differer : les flux utilisent vos
  coordonnees, ou vos propres limites si vous les fournissez.
- L'activation du temps sur la couche *Flows* est tentee automatiquement ; si votre
  version de Pro la refuse, l'outil l'indique : *Layer Properties > Time*, champ `WHEN`.
