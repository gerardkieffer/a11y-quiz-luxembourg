# Quiz de l'accessibilité numérique — Luxembourg

Quiz en français sur l'accessibilité des sites publics luxembourgeois, basé sur les
audits officiels de l'[Observatoire de l'accessibilité numérique](https://observatoire.accessibilite.public.lu/fr/home)
(API publique, licence CC0).

## Comment ça marche

- Trois scripts (exécutés par le développeur, jamais en production) construisent les
  données du quiz à partir de l'API publique :
  1. `npm run fetch-data` — interroge l'API, sélectionne ~40 sites variés (score,
     ancienneté, secteur, niveau administratif) et calcule les statistiques par thème
     RAWeb. Écrit `data/sites.json`. Quand un même site a été audité plusieurs fois,
     seul l'audit le plus récent devient un "site" du quiz ; les audits précédents
     sont conservés dans `previousAudits` (utilisé par les questions d'évolution de
     score) plutôt que d'être traités comme des sites indépendants.
  2. `npm run capture-screenshots` — ouvre chaque site avec Playwright/Chromium et
     capture une image de la page d'accueil dans `public/screenshots/`, en essayant
     de fermer les bannières de cookies/consentement au préalable (y compris celles
     chargées dans une iframe tierce). Certains sites nécessitent un cas particulier
     (ex. bannière d'alerte non liée aux cookies) : voir `SITE_OVERRIDES` dans
     `scripts/capture-screenshots.mjs`.
  3. `npm run generate-questions` — transforme `data/sites.json` en une banque de
     ~450 questions (8 types) dans `data/questions.json`, copiée dans
     `public/questions.json`.
  - Raccourci : `npm run build-data` exécute les trois dans l'ordre.
- Le site final (`public/`) est **100 % statique** : HTML/CSS/JS sans framework, qui
  charge `questions.json` et pioche 10 questions (parmi ≥ 6 types différents) à chaque
  partie.
- `server.mjs` est un petit serveur Express qui sert `public/` — nécessaire pour
  l'hébergement Infomaniak (environnement Node.js), pas de logique dynamique ni de
  base de données.

## Démarrage local

```bash
npm install
npx playwright install chromium   # une seule fois, pour capture-screenshots
npm run build-data                # ~5-10 minutes (API + captures d'écran)
npm start                         # http://localhost:3000
```

## Rafraîchir les données

L'Observatoire publie régulièrement de nouveaux audits. Pour rafraîchir le quiz :

```bash
npm run fetch-data          # nouvelle sélection de sites + statistiques
npm run capture-screenshots # ne recapture que les sites sans image existante
npm run generate-questions  # régénère la banque de questions
```

Pour forcer une nouvelle capture d'écran de tous les sites (ex. après une refonte
visuelle largement répandue) : `node scripts/capture-screenshots.mjs --force`.

Le cache brut de l'API (`data/raw-cache/`) accélère les relances de `fetch-data` ;
supprimez ce dossier pour forcer un re-téléchargement complet.

## Déploiement sur Infomaniak (hébergement Node.js)

1. `npm run build-data` en local (les données/captures sont commises ou uploadées
   avec le reste du projet — elles ne sont pas régénérées sur le serveur).
2. Uploader le projet (hors `node_modules`) sur l'hébergement, ou configurer le
   déploiement Git si disponible.
3. Sur l'hébergement, exécuter `npm install --production` puis démarrer avec
   `npm start` (= `node server.mjs`). Infomaniak fournit `process.env.PORT`,
   déjà géré par `server.mjs`.
4. Vérifier que l'URL publique sert bien le quiz (mêmes tests qu'en local).

## Notes de conception

- Seuls les audits de type "approfondi" (RAWeb, sites web) sont utilisés — les audits
  d'applications mobiles (RAAM) et simplifiés (RGAA) sont exclus car ils ne
  correspondent pas au référentiel de thèmes utilisé pour générer les questions.
- Les libellés de thèmes (contrastes, formulaires, navigation...) sont rédigés en
  français simple pour un public non spécialiste ; ce ne sont pas les intitulés
  officiels RAWeb.
- La mention "audit de plus d'un an" est calculée côté navigateur à partir de la date
  réelle du jour, donc reste correcte même longtemps après la génération des données.
- Chaque question a une limite de temps fixe de 90 secondes (`TIME_LIMIT_SECONDS` dans
  `scripts/generate-questions.mjs`) : c'est un choix de conception assumé (aspect
  "jeu"), pas un oubli — le quiz n'implémente pas de mécanisme pour l'étendre ou la
  désactiver.
- Après avoir répondu, un lien vers la page officielle de l'audit sur l'Observatoire
  (`fr/details_{auditId}`) est toujours affiché. Pour la question portant sur la
  déclaration d'accessibilité (`statement-update-timing`), un lien direct vers la
  déclaration elle-même est aussi proposé avant de répondre, en plus du lien vers le
  site.

## Licence

Ce projet est open source sous licence [MIT](LICENSE).

Les polices auto-hébergées dans `public/fonts/` sont distribuées sous leur propre
licence libre : [Figtree](https://fonts.google.com/specimen/Figtree) (SIL Open Font
License 1.1) et [Ubuntu Sans](https://fonts.google.com/specimen/Ubuntu+Sans) (Ubuntu
Font License 1.0).
