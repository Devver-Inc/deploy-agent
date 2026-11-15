# Deploy Agent — backlog fonctionnel du refactoring

> Document source destiné à la génération future d'issues GitHub par un MCD.
> Chaque élément ci-dessous décrit un travail **à réaliser**, même lorsqu'il provient d'une implémentation ou d'un commit existant.

## 1. Contrat de lecture pour le MCD

```yaml
document_type: github-issue-backlog
project: deploy-agent
language: fr-FR
implementation_status: proposed
source_baseline: 0563024
source_target: 95c10c3
issue_id_prefix: DA
required_issue_fields:
  - id
  - title
  - epic
  - priority
  - depends_on
  - objective
  - scope
  - acceptance_criteria
  - verification
  - out_of_scope
generation_rules:
  - create_one_issue_per_ticket_section
  - preserve_ticket_ids
  - preserve_dependencies
  - convert_acceptance_criteria_to_github_checkboxes
  - do_not_infer_that_any_ticket_is_already_implemented
  - do_not_expand_out_of_scope_items
```

Signification des priorités :

- `P0` : bloque un déploiement correct ou sécurisé.
- `P1` : nécessaire à un fonctionnement fiable.
- `P2` : amélioration de compatibilité, de performance ou de maintenance.
- `P3` : évolution conditionnée à un besoin démontré.

## 2. Objectif du produit

Construire un agent conteneurisé capable de recevoir du code via Git, de préparer une release isolée, de détecter la stack, d'installer et de compiler le projet, de démarrer le processus sur un port dynamique, de publier l'application via Nginx et de restaurer la release précédente en cas d'échec d'une étape.

L'agent doit proposer :

- le déploiement déterministe d'un service `web` **ou** `api` par requête ;
- des releases dans des worktrees Git sans modifier la release active pendant l'installation ou le build ;
- la prise en charge explicite de Node/Bun, Node/npm, Python/pip, Python/Poetry, Ruby/Bundler et Go modules ;
- une installation optimisée grâce aux lockfiles, aux caches persistants et aux runtimes précompilés ;
- un processus géré par PM2, un reverse proxy Nginx et des ports persistés ;
- le rollback du worktree, du processus, du port et de la configuration Nginx ;
- une API authentifiée, une progression par SSE, des logs et des erreurs structurés ;
- un catalogue de bases MongoDB, PostgreSQL et Redis ;
- une image Docker reproductible et une publication automatisée dans GHCR.

## 3. Limites du périmètre

- Chaque appel de déploiement contient exactement un service : `web` ou `api`.
- La conception initiale utilise un verrou global pour le cycle de vie. Des verrous par dépôt ne seront nécessaires qu'en cas de contention mesurable.
- Le registre JSON suffit pour une instance unique de l'agent. La coordination distribuée nécessite un autre projet.
- L'agent ne réécrit pas le code source contenant des ports codés en dur ; il doit détecter et diagnostiquer ce cas.
- Kubernetes, l'autoscaling, le blue/green distribué et l'orchestration multi-hôtes ne font pas partie de ce backlog.

## 4. Carte des epics et tickets

| Epic | Résultat | Tickets |
| --- | --- | --- |
| E1 — Contrat et sécurité de l'API | Entrées validées, authentification et erreurs stables | DA-001, DA-002 |
| E2 — Pipeline transactionnel | Étapes isolées, release candidate et rollback | DA-003 à DA-007 |
| E3 — Runtimes et installation | Détection de la stack et préparation rapide | DA-008 à DA-010 |
| E4 — Processus, ports et proxy | Le service démarre sur le port attribué et reste accessible | DA-011 à DA-015 |
| E5 — Exploitation et observabilité | Administration, progression, logs et diagnostic | DA-016 à DA-018 |
| E6 — Services auxiliaires | Git HTTP authentifié et catalogue de bases | DA-019, DA-020 |
| E7 — Conteneur et livraison | Image rapide, persistante et publiée | DA-021 à DA-023 |
| E8 — Preuve de comportement | Tests minimaux des flux critiques | DA-024 |

---

## E1 — Contrat et sécurité de l'API

### DA-001 — Valider et normaliser la requête de déploiement

```yaml
id: DA-001
title: Valider et normaliser la requête de déploiement
epic: E1
priority: P0
depends_on: []
labels: [api, validation, security]
```

**Objectif**

Définir un contrat de déploiement unique et rejeter les entrées invalides avant toute action sur le système de fichiers ou les processus.

**Périmètre**

- Accepter `repo`, `branch`, `commit?`, `projectId?`, `organizationId?`, `overlayAccessControl`, `service` et `env?`.
- Exiger exactement un service parmi `web` et `api`.
- Autoriser `root?`, `install?`, `skipInstall?`, `build?` et `start?` dans le service.
- Valider les noms de dépôts, branches, hashes, identifiants de processus et chemins relatifs.
- Empêcher le path traversal dans `service.root`.
- Bloquer les opérateurs shell non pris en charge avant l'exécution des commandes.
- N'accepter les variables supplémentaires que sous forme de map `string -> string`.

**Critères d'acceptation**

- Une requête sans service ou contenant simultanément `web` et `api` renvoie une erreur de validation.
- Les valeurs invalides de `repo`, `branch`, `commit` et `root` sont refusées avant la création du worktree.
- Les commandes contenant `;`, un pipe simple, `||` ou un `&` isolé sont refusées en identifiant l'étape et le service.
- Une requête valide produit un contexte normalisé sans modifier l'objet reçu.
- L'erreur de validation utilise un code stable et n'expose pas de stack trace.

**Vérification**

- Tests unitaires des schémas, du path traversal et des opérateurs shell.
- Test d'API confirmant le statut et le payload des requêtes invalides.

**Hors périmètre**

- Exécuter deux services dans la même requête.
- Interpréter un langage shell complet.

### DA-002 — Unifier l'authentification et les réponses d'erreur de l'API

```yaml
id: DA-002
title: Unifier l'authentification et les réponses d'erreur de l'API
epic: E1
priority: P0
depends_on: [DA-001]
labels: [api, auth, errors]
```

**Objectif**

Protéger les endpoints d'administration et fournir aux clients des réponses d'erreur prévisibles.

**Périmètre**

- Exiger `DEVVER_SECRET` au démarrage.
- Valider `x-devver-secret` par une comparaison en temps constant.
- Exclure `/health` et `/internal/git-auth` de l'authentification administrative.
- Créer des erreurs applicatives par catégorie : validation, introuvable, conflit, upstream et configuration.
- Mapper les catégories vers les statuts HTTP 400, 404, 409, 502 et 500.
- Standardiser `{ success: false, error: { code, message, details? } }`.
- Valider les payloads du framework en `422` et traiter les erreurs métier via le mapping central.

**Critères d'acceptation**

- L'agent ne démarre pas sans `DEVVER_SECRET`.
- Un secret absent ou incorrect renvoie `401` sans révéler la valeur attendue.
- Tous les endpoints protégés appliquent la même règle.
- Les erreurs connues conservent leur code et leur message ; les erreurs inconnues reçoivent un fallback sûr.
- `/health` fournit le statut, le timestamp et l'uptime sans authentification.

**Vérification**

- Tests HTTP avec un secret valide, absent et invalide.
- Test du mapping de chaque catégorie d'erreur.

**Hors périmètre**

- OAuth pour l'API administrative.
- Gestion ou rotation du secret par l'agent.

---

## E2 — Pipeline transactionnel

### DA-003 — Décomposer le déploiement en pipeline d'étapes

```yaml
id: DA-003
title: Décomposer le déploiement en pipeline d'étapes
epic: E2
priority: P0
depends_on: [DA-001]
labels: [deploy, architecture]
```

**Objectif**

Remplacer le service de déploiement monolithique par une séquence explicite d'étapes partageant un contexte.

**Périmètre**

- Définir un contrat minimal `DeployStageHandler` avec un nom et une méthode `execute`.
- Exécuter, dans cet ordre : validation, snapshot, worktree, install, build, process et nginx.
- Ne conserver dans le contexte que l'identité, la configuration résolue, les chemins, le runtime, les indicateurs de mutation, le snapshot et les benchmarks.
- Injecter un registre de services pour Git, PM2, Nginx, les ports et les repositories.
- Centraliser l'exécution, la mesure et le traitement des échecs dans le pipeline.
- Générer un `requestId` unique par tentative.

**Critères d'acceptation**

- L'ordre des étapes est déterministe.
- Une étape n'utilise que l'état produit par les étapes précédentes.
- Un échec interrompt les étapes suivantes et déclenche le rollback.
- Les services externes peuvent être remplacés par des fakes dans les tests sans modifier les étapes.
- La réponse de succès conserve le dépôt, la branche, le commit, le deploymentId, le service, le processus, la durée et le benchmark.

**Vérification**

- Test du pipeline avec un registre fake confirmant l'ordre et l'interruption en cas d'échec.

**Hors périmètre**

- Framework générique de workflows.
- Étapes configurables par l'utilisateur.

### DA-004 — Créer une release candidate avec des worktrees Git

```yaml
id: DA-004
title: Créer une release candidate avec des worktrees Git
epic: E2
priority: P0
depends_on: [DA-003]
labels: [git, deploy, filesystem]
```

**Objectif**

Préparer l'installation et le build en dehors de la release active et ne promouvoir la nouvelle release qu'au démarrage du processus.

**Périmètre**

- Créer un worktree candidate detached à partir de la branche ou du commit demandé.
- Séparer les chemins du candidate, de l'actif et du backup par `requestId`.
- Résoudre `service.root` exclusivement dans le worktree candidate.
- Promouvoir via `git worktree move` : l'actif vers le backup et le candidate vers l'actif.
- Restaurer l'actif si la promotion du candidate échoue.
- Supprimer le backup une fois le déploiement terminé.
- Exclure les répertoires internes de release de la liste publique des deployments.
- Appliquer l'ownership `deploy:deploy` et les droits d'écriture de l'utilisateur au candidate.

**Critères d'acceptation**

- Un échec de l'installation ou du build ne modifie pas la release active.
- Une promotion réussie laisse un seul worktree actif pour le dépôt et la branche.
- Un échec pendant la promotion restaure le worktree précédent.
- L'utilisateur `deploy` peut écrire les dépendances et les artefacts dans le candidate.
- Les chemins hors de la racine des deployments ne sont jamais acceptés.

**Vérification**

- Test avec un dépôt Git temporaire couvrant la première release, le redéploiement, l'échec et le rollback.
- Test des permissions exécuté dans l'image.

**Hors périmètre**

- Checkout mutable directement dans la release active.
- Historique illimité des anciennes releases.

### DA-005 — Capturer un snapshot avant les mutations

```yaml
id: DA-005
title: Capturer un snapshot avant les mutations
epic: E2
priority: P0
depends_on: [DA-003]
labels: [deploy, rollback]
```

**Objectif**

Enregistrer l'état nécessaire pour restaurer une release après un échec partiel.

**Périmètre**

- Capturer l'entrée de port actuelle.
- Capturer l'existence et le contenu de la configuration Nginx.
- Capturer les processus PM2 du deployment, leur statut, l'ecosystem file et le wrapper script.
- Stocker le snapshot dans le contexte avant les étapes worktree/install/build/process/nginx.

**Critères d'acceptation**

- L'absence d'une ressource est représentée explicitement, et non comme un contenu vide.
- Les fichiers PM2 nécessaires à la restauration conservent le chemin, le contenu et le statut du processus.
- Aucune mutation de release n'a lieu avant la fin du snapshot.

**Vérification**

- Test avec un deployment inexistant, online et stopped.

**Hors périmètre**

- Sauvegarde de la base de données de l'application.
- Persistance historique des snapshots.

### DA-006 — Exécuter un rollback compensatoire par ressource modifiée

```yaml
id: DA-006
title: Exécuter un rollback compensatoire par ressource modifiée
epic: E2
priority: P0
depends_on: [DA-004, DA-005]
labels: [deploy, rollback, reliability]
```

**Objectif**

Restaurer la release précédente sans masquer les échecs secondaires du rollback.

**Périmètre**

- Marquer dans le contexte les ressources touchées.
- Supprimer les processus créés par la tentative en échec.
- Écarter le candidate non promu ou restaurer l'ancien worktree après une promotion.
- Restaurer ou libérer le port selon le snapshot.
- Restaurer les fichiers et le statut des processus PM2 précédents.
- Restaurer/supprimer la configuration Nginx et recharger le proxy.
- Poursuivre les autres compensations lorsqu'une d'elles échoue.
- Renvoyer `{ attempted, success, message? }` et lever `ROLLBACK_ERROR` si nécessaire.

**Critères d'acceptation**

- Seules les ressources marquées comme modifiées font l'objet d'une compensation.
- Un redéploiement qui échoue après la promotion sert à nouveau la release précédente.
- Tous les échecs de compensation apparaissent dans le résultat agrégé.
- Un échec avant la première mutation n'exécute pas de rollback inutile.

**Vérification**

- Tests paramétrés avec injection d'un échec après chaque étape mutable.

**Hors périmètre**

- Rollback manuel vers des versions arbitraires.

### DA-007 — Sérialiser les opérations du cycle de vie

```yaml
id: DA-007
title: Sérialiser les opérations du cycle de vie
epic: E2
priority: P0
depends_on: [DA-003]
labels: [concurrency, deploy]
```

**Objectif**

Éviter les conditions de concurrence entre le déploiement, la suppression, la suppression d'un dépôt et les actions PM2.

**Périmètre**

- Utiliser un mutex global partagé par toutes les opérations du cycle de vie.
- Conserver des opérations internes `unlocked` afin de les composer sans deadlock.
- Couvrir le déploiement, la liste cohérente, la suppression, le delete de dépôt et start/stop/restart.

**Critères d'acceptation**

- Deux mutations concurrentes ne modifient jamais simultanément le worktree, le port, PM2 ou Nginx.
- Le delete d'un dépôt attend la suppression complète de ses deployments.
- Les méthodes internes composées ne tentent pas d'acquérir une seconde fois le même verrou.

**Vérification**

- Test concurrent avec des barrières contrôlées et un ordre d'appels observable.

**Hors périmètre**

- Verrou distribué.
- Verrou par dépôt avant qu'un débit réel ne justifie cette complexité.

---

## E3 — Runtimes et installation

### DA-008 — Détecter le runtime et construire le plan d'exécution

```yaml
id: DA-008
title: Détecter le runtime et construire le plan d'exécution
epic: E3
priority: P1
depends_on: [DA-004]
labels: [runtime, deploy]
```

**Objectif**

Choisir les commandes, l'environnement et le profil du proxy à partir des fichiers réels du service.

**Périmètre**

- Détecter dans cet ordre : lockfile Bun, lockfile npm, package.json générique, Poetry, requirements, pyproject, Gemfile et go.mod.
- Lire la commande `web:` du `Procfile`.
- Lire le script `start` de `package.json` et détecter Vite.
- Produire un `RuntimePlan` avec l'installation, le démarrage, la préparation, l'environnement et le profil du proxy.
- Autoriser les commandes explicites de la requête à remplacer les valeurs par défaut détectées.
- Échouer avec des indications lorsqu'il n'existe aucune commande de démarrage explicite ou détectable.

**Critères d'acceptation**

- Un lockfile spécifique l'emporte toujours sur un manifeste générique.
- Bun utilise `bun install --frozen-lockfile` ; npm utilise `npm ci`.
- Poetry, pip, Bundler et Go reçoivent leurs commandes canoniques.
- Ruby préfixe `bundle exec` uniquement lorsque nécessaire.
- Un nouveau runtime peut être ajouté au catalogue sans modifier les étapes du pipeline.

**Vérification**

- Table de tests avec un fixture minimal par runtime et par priorité de lockfile.

**Hors périmètre**

- Plugins de runtime externes.
- Détection heuristique sans manifeste ni Procfile.

### DA-009 — Optimiser l'installation avec des caches persistants

```yaml
id: DA-009
title: Optimiser l'installation avec des caches persistants
epic: E3
priority: P1
depends_on: [DA-008, DA-022]
labels: [performance, packages, cache]
```

**Objectif**

Éviter les téléchargements et compilations répétés entre les deployments sans partager les répertoires de dépendances des applications.

**Périmètre**

- Persister des caches distincts pour npm, Bun, pip/Poetry, les gems et Go.
- Injecter `npm_config_cache`, `BUN_INSTALL_CACHE_DIR`, `PIP_CACHE_DIR`, `POETRY_CACHE_DIR`, `BUNDLE_CACHE_PATH`, `GOMODCACHE` et `GOCACHE` selon le runtime.
- Créer `.venv` dans le worktree Python et exposer `VIRTUAL_ENV`/`PATH`.
- Installer les bundles Ruby dans le worktree et ne partager que le cache global.
- Exécuter l'installation avec l'utilisateur `deploy`.
- Respecter `skipInstall` et une commande `install` personnalisée.
- Utiliser un lockfile gelé lorsqu'il existe.

**Critères d'acceptation**

- Un second déploiement avec des dépendances identiques réutilise le cache persistant.
- Les dépendances d'une application n'apparaissent pas comme répertoire exécutable d'une autre.
- Les caches survivent au redémarrage du conteneur.
- `skipInstall: true` n'exécute ni préparation ni installation.
- Un échec d'installation renvoie la commande, stdout/stderr, l'étape et l'exit code.

**Vérification**

- Benchmark du premier et du second déploiement avec un fixture par écosystème.
- Test d'isolation entre deux projets.

**Hors périmètre**

- Cache distribué entre les hôtes.
- Invalidation spécifique au-delà des règles des package managers.

### DA-010 — Isoler le build et les commandes du projet

```yaml
id: DA-010
title: Isoler le build et les commandes du projet
epic: E3
priority: P1
depends_on: [DA-001, DA-004, DA-008]
labels: [build, security, deploy]
```

**Objectif**

Exécuter la préparation, l'installation et le build dans un environnement prévisible avec des privilèges réduits.

**Périmètre**

- Centraliser l'exécution des commandes du déploiement.
- Valider à nouveau la commande immédiatement avant son exécution.
- Exécuter les commandes du projet via `su-exec deploy`.
- Ne fusionner que les variables du processus et du runtime nécessaires à l'étape.
- Rendre le build optionnel et distinct de l'installation.
- Formater les logs d'échec de manière cohérente.

**Critères d'acceptation**

- L'installation et le build ne s'exécutent pas en root.
- L'absence de `build` ignore l'étape sans échec.
- Un exit code non nul produit une erreur pour l'étape correcte.
- Le build a lieu dans le candidate et ne modifie pas la release active.

**Vérification**

- Test qui enregistre l'UID effectif et le cwd pendant l'installation et le build.

**Hors périmètre**

- Sandbox du kernel pour du code non fiable.

---

## E4 — Processus, ports et proxy

### DA-011 — Allouer et persister les ports sans collision

```yaml
id: DA-011
title: Allouer et persister les ports sans collision
epic: E4
priority: P0
depends_on: [DA-007]
labels: [ports, networking]
```

**Objectif**

Attribuer un port stable à chaque deployment et éviter les collisions entre le registre et le système d'exploitation.

**Périmètre**

- Rechercher les ports dans `[3000, 9000)`.
- Sérialiser l'allocation avec un mutex.
- Exclure les ports enregistrés et ceux déjà occupés sur l'hôte.
- Réutiliser le port existant lors du redéploiement du même deployment.
- Persister `serviceName`, `port` et `url` dans `/app/data/ports.json`.
- Restaurer/libérer l'entrée pendant le rollback ou la suppression.

**Critères d'acceptation**

- Deux allocations concurrentes ne reçoivent jamais le même port.
- Un redéploiement conserve l'URL et le port lorsque possible.
- Un port occupé hors du registre n'est pas sélectionné.
- L'épuisement renvoie un `PORT_CONFLICT` clair.
- Le redémarrage de l'agent préserve le registre.

**Vérification**

- Tests concurrents d'allocation et test avec un socket réel occupant un port.

**Hors périmètre**

- Réservation distribuée entre plusieurs instances.

### DA-012 — Forcer le processus à utiliser le port dynamique

```yaml
id: DA-012
title: Forcer le processus à utiliser le port dynamique
epic: E4
priority: P0
depends_on: [DA-008, DA-011]
labels: [ports, runtime, reliability]
source_detail: docs/dynamic-port-strategy.md
```

**Objectif**

Empêcher `.env`, les flags CLI ou les conventions propres aux frameworks de détourner l'application du port attribué.

**Périmètre**

- Toujours fournir `PORT` et `HOST=0.0.0.0` au processus PM2.
- Injecter `--port` et `--host` dans Vite, y compris pour les scripts exécutés par Bun/npm.
- Supprimer les flags conflictuels avant de réinjecter le port canonique.
- Couvrir uvicorn, gunicorn et Puma avec les flags appropriés.
- Exporter les alias de port/adresse nécessaires dans le wrapper lorsque leur usage par les runtimes pris en charge est démontré.
- Neutraliser les variables de port conflictuelles dans `.env*` uniquement dans le worktree jetable et consigner chaque modification.
- Traiter `docker run` avec des variables explicites ; documenter que les configurations Compose complexes exigent leur propre configuration.

**Critères d'acceptation**

- Vite avec `--port 3000` démarre sur le port alloué.
- FastAPI avec `.env PORT=9999` et uvicorn avec `--port 7777` démarrent sur le port alloué.
- Puma/gunicorn reçoivent un bind vers `0.0.0.0:<port>`.
- Le dépôt original n'est jamais modifié par l'assainissement.
- Le rapport indique le fichier, la variable et l'action sans divulguer d'autres secrets de `.env`.
- Les commandes n'ayant pas besoin de flag restent inchangées et dépendent de `PORT`.

**Vérification**

- Tests de transformation des commandes.
- E2E avec des fixtures Vite, FastAPI/uvicorn, gunicorn et Puma.
- Comparaison Git prouvant que le dépôt original n'a pas changé.

**Hors périmètre**

- Réécrire les appels codés en dur tels que `app.listen(3000)`.
- Générer automatiquement `docker-compose.override.yml` avant l'existence d'un cas réel.

### DA-013 — Gérer le cycle de vie du processus avec PM2

```yaml
id: DA-013
title: Gérer le cycle de vie du processus avec PM2
epic: E4
priority: P0
depends_on: [DA-011, DA-012]
labels: [pm2, process, reliability]
```

**Objectif**

Remplacer le processus précédent en toute sécurité et préserver suffisamment de métadonnées pour le redémarrage et le rollback.

**Périmètre**

- Nommer le processus avec le service, le deployment et le port.
- Supprimer les anciens processus du même service/deployment et confirmer leur suppression.
- Tuer le processus résiduel sur le port et attendre sa libération.
- Générer un wrapper shell exécutable et un ecosystem file aux permissions restreintes.
- Exécuter l'application en tant que `deploy:deploy`, avec un autorestart limité, un timeout et un tree kill.
- Attendre que PM2 soit `online` ; inclure les logs s'il passe à `errored`.
- Persister l'état avec `pm2 save` et le récupérer avec `pm2 resurrect` au boot.
- Prendre en charge start, stop, restart et delete par nom validé.

**Critères d'acceptation**

- Un redéploiement ne laisse aucun processus PM2 orphelin.
- L'ancien port est libéré avant le nouveau démarrage.
- Le wrapper n'est pas modifiable par le processus applicatif.
- Le statut `errored` renvoie les logs récents.
- Le processus online survit au redémarrage du conteneur lorsque le volume PM2 est préservé.

**Vérification**

- E2E de déploiement, redéploiement, redémarrage du conteneur et suppression.

**Hors périmètre**

- Remplacer PM2 par un superviseur propriétaire.

### DA-014 — Vérifier l'état de santé et diagnostiquer un port incorrect

```yaml
id: DA-014
title: Vérifier l'état de santé et diagnostiquer un port incorrect
epic: E4
priority: P1
depends_on: [DA-013]
labels: [healthcheck, ports, diagnostics]
source_detail: docs/dynamic-port-strategy.md
```

**Objectif**

Confirmer que le processus démarré répond bien sur le port attendu et produire un diagnostic exploitable dans le cas contraire.

**Périmètre**

- Interroger `http://127.0.0.1:<port>` pendant 60 secondes au maximum.
- Accepter comme prêt un processus renvoyant une réponse HTTP inférieure à 500.
- Confirmer, avec un outil disponible dans l'image, que le PID attendu écoute sur le port.
- En cas d'échec, collecter les logs PM2 récents.
- Classer au minimum : port occupé, permission, import/module absent, crash et port probablement codé en dur.
- Détecter un port alternatif du même PID uniquement à des fins de diagnostic.

**Critères d'acceptation**

- Un processus `online` sans listener ne termine pas le déploiement.
- La réponse d'un autre processus sur le port ne produit pas de faux succès.
- Le timeout inclut le service, le port attendu, la cause probable et des logs limités.
- Un port alternatif est signalé, mais jamais adopté silencieusement.

**Vérification**

- E2E pour le succès, le crash, un mauvais listener et un port desservi par un PID différent.

**Hors périmètre**

- Corriger automatiquement le code contenant un port codé en dur.

### DA-015 — Publier la release avec une configuration Nginx dynamique

```yaml
id: DA-015
title: Publier la release avec une configuration Nginx dynamique
epic: E4
priority: P0
depends_on: [DA-013, DA-014]
labels: [nginx, proxy, frontend]
```

**Objectif**

Exposer chaque deployment sur une URL stable et compatible avec les applications web servies sous un préfixe.

**Périmètre**

- Publier sous `/<repo>/<safe-branch>/` et ajouter `/api/` pour un service API.
- Rediriger l'URL sans slash final.
- Transmettre HTTP et WebSocket avec les headers `X-Forwarded-*`.
- Créer des routes spéciales pour les assets, `_next`, Vite, HMR et les modules lorsque le runtime est un frontend Node.
- Réécrire les références HTML/JS absolues pour utiliser le préfixe du deployment.
- Injecter `window.__DEVVER__` avec le dépôt, la branche, projectId, organizationId et le contrôle d'accès.
- Injecter un widget configurable par `DEVVER_WIDGET_URL`.
- Échapper JSON, les attributs HTML et les regex avant de générer la configuration.
- Écrire la configuration, valider/recharger Nginx et permettre sa sauvegarde/restauration.

**Critères d'acceptation**

- Le Web et l'API sont accessibles sous leurs préfixes attendus.
- HMR/WebSocket fonctionne pour le frontend Node.
- Les valeurs contrôlées par l'utilisateur ne cassent ni le script, ni l'attribut, ni la regex générés.
- Un échec du reload restaure la configuration précédente.

**Vérification**

- Tests de génération avec des caractères spéciaux.
- E2E HTTP/WebSocket via Nginx.

**Hors périmètre**

- CDN, TLS et domaine personnalisé gérés par l'agent.

---

## E5 — Exploitation et observabilité

### DA-016 — Exposer la progression, le benchmark et les logs du déploiement

```yaml
id: DA-016
title: Exposer la progression, le benchmark et les logs du déploiement
epic: E5
priority: P1
depends_on: [DA-003, DA-013]
labels: [observability, sse, logs]
```

**Objectif**

Permettre aux clients de suivre le déploiement sans polling aveugle et de comprendre où se situent les délais et les échecs.

**Périmètre**

- Mesurer la durée de validation, snapshot, worktree, install, build, process et nginx.
- Proposer un déploiement synchrone et `/deploy/stream` via SSE.
- Émettre un événement `phase` avec le nom et la durée après chaque étape.
- Terminer par `complete` ou `error` contenant la réponse complète.
- Désactiver le buffering du proxy sur le stream.
- Produire des logs structurés de démarrage, succès, échec, rollback et cleanup.
- Exposer les logs PM2 par deployment avec un paramètre validé.

**Critères d'acceptation**

- Les événements SSE arrivent dans l'ordre des étapes exécutées.
- Le stream se ferme en cas de succès comme d'échec inattendu.
- La réponse finale contient la durée totale et le benchmark partiel/complet.
- Les logs des différents processus sont agrégés avec le service, le niveau et le timestamp.

**Vérification**

- Test du framing SSE et de la fermeture du stream.
- Test du parser des logs PM2.

**Hors périmètre**

- Stockage centralisé des métriques ou des logs.

### DA-017 — Administrer les dépôts, deployments et processus

```yaml
id: DA-017
title: Administrer les dépôts deployments et processus
epic: E5
priority: P1
depends_on: [DA-007, DA-013, DA-015]
labels: [operations, api]
```

**Objectif**

Centraliser le cycle de vie administratif sans autoriser de chemins dangereux ni laisser de ressources orphelines.

**Périmètre**

- Créer un dépôt bare par nom et `baseUrl`, configurer le push HTTP et l'ownership de l'utilisateur `git`.
- Normaliser la `baseUrl` HTTP/HTTPS et renvoyer la `pushUrl` calculée.
- Persister le nom, l'URL de base et la date de création dans `repos.json` avec un repository simple.
- Lister les dépôts enregistrés et refuser les noms dupliqués avec un conflit.
- Lister tous les deployments ou filtrer par dépôt.
- Combiner le worktree, le commit, le registre de ports et le processus PM2 dans la réponse.
- Supprimer le processus, l'arbre de processus, le worktree, la configuration Nginx et le port.
- Recharger Nginx après la suppression.
- Lors de la suppression d'un dépôt, supprimer d'abord tous ses deployments.
- Valider le dépôt, le deploymentId et le nom PM2 ; renvoyer 404 le cas échéant.
- Centraliser start, stop et restart dans le service administratif.
- Avant de supprimer un dépôt bare, prouver que le chemin résolu est sous la racine des dépôts et se termine par `.git`.

**Critères d'acceptation**

- La création produit un dépôt bare utilisable pour le push et une `pushUrl` valide.
- Une URL invalide ou non HTTP(S) est refusée ; un nom dupliqué renvoie un conflit.
- Une suppression complète ne laisse ni processus, ni listener, ni worktree, ni configuration, ni enregistrement.
- La liste représente un deployment sans processus ou sans port sans lever d'exception.
- Le delete d'un dépôt ne supprime pas le dépôt avant ses deployments.
- Les actions PM2 sur un processus inexistant renvoient 404.

**Vérification**

- E2E de création/push, liste, filtrage, suppression et delete du dépôt.

**Hors périmètre**

- Dashboard d'administration.

### DA-018 — Rendre les échecs de déploiement exploitables

```yaml
id: DA-018
title: Rendre les échecs de déploiement exploitables
epic: E5
priority: P1
depends_on: [DA-006, DA-016]
labels: [errors, diagnostics]
```

**Objectif**

Préserver la cause, l'étape et le contexte opérationnel sans renvoyer d'objets ou d'exceptions incohérents.

**Périmètre**

- Définir des codes pour le dépôt, Git, l'installation, le build, le processus, Nginx, le rollback, le port et la validation.
- Utiliser une exception de déploiement typée avec logs, step, stage et service.
- Normaliser les erreurs inconnues à la frontière du pipeline.
- Limiter et formater stdout/stderr des commandes.
- Inclure le résultat du rollback dans la réponse d'échec.
- Ne pas divulguer les secrets présents dans l'environnement ou les connection strings.

**Critères d'acceptation**

- Chaque échec du pipeline renvoie `success: false`, une durée et un code stable.
- L'erreur identifie l'étape et le service lorsqu'ils sont connus.
- Un échec du rollback est prioritaire sans effacer la cause initiale.
- Les secrets connus sont masqués dans les logs renvoyés.

**Vérification**

- Test par classe d'erreur et test de masquage.

**Hors périmètre**

- Classification par IA.

---

## E6 — Services auxiliaires

### DA-019 — Autoriser les opérations Git HTTP par projet

```yaml
id: DA-019
title: Autoriser les opérations Git HTTP par projet
epic: E6
priority: P0
depends_on: [DA-002]
labels: [git, auth, nginx]
```

**Objectif**

Autoriser le clone/push via le backend Git HTTP uniquement après une autorisation externe liée au projet.

**Périmètre**

- Créer l'endpoint interne `/internal/git-auth` consommé par l'auth request Nginx.
- Transmettre `Authorization`, `x-git-token` et l'URI d'origine au service d'autorisation.
- Construire l'URL avec `DEVVER_GIT_AUTH_URL` et `DEVVER_PROJECT_ID`.
- Appliquer un timeout de 5 secondes.
- Traduire l'absence/expiration en 401, un scope incorrect en 403 et une indisponibilité en 503.
- Envoyer `WWW-Authenticate` en cas de refus.
- Séparer l'appel d'autorisation du secret administratif.

**Critères d'acceptation**

- Un push sans identifiants est refusé.
- Un token valide pour le projet autorise l'opération Git.
- Un token d'un autre projet renvoie 403.
- Un service externe lent ou indisponible échoue de façon fermée avec 503.

**Vérification**

- Tests avec un fetch fake pour tous les statuts et le timeout.
- E2E Nginx + fcgiwrap + git-http-backend.

**Hors périmètre**

- Émission et rotation des tokens Git.

### DA-020 — Exposer un catalogue uniforme des bases MongoDB, PostgreSQL et Redis

```yaml
id: DA-020
title: Exposer un catalogue uniforme des bases MongoDB PostgreSQL et Redis
epic: E6
priority: P1
depends_on: [DA-002]
labels: [database, api]
```

**Objectif**

Lister les bases disponibles par moteur avec des erreurs et une configuration uniformes.

**Périmètre**

- Exposer `GET /databases/:engine` pour `mongo`, `postgres` et `redis`.
- Conserver `/mongo/databases` comme alias temporaire de compatibilité.
- Mongo : exclure `admin`, `config` et `local` ; renvoyer la taille et `empty`.
- PostgreSQL : exclure les templates et la base `postgres` ; renvoyer la taille en octets.
- Redis : énumérer toutes les DB configurées et renvoyer le nombre de clés et de clés avec expiration.
- Utiliser des connection strings propres à chaque variable `DEVVER_*_CONNECTION_STRING`.
- Appliquer un timeout de connexion/requête de 10 secondes et toujours fermer les clients.
- Distinguer une configuration absente d'une instance inaccessible.

**Critères d'acceptation**

- Chaque moteur renvoie son payload typé et ordonné/prévisible.
- Une variable absente renvoie une erreur de configuration sans connection string.
- Un timeout ou une panne réseau renvoie une erreur upstream.
- Les clients sont fermés en cas de succès comme d'échec.
- L'alias Mongo produit le même résultat que le nouvel endpoint.

**Vérification**

- Tests du provider avec des clients substituables.
- Intégration optionnelle avec des conteneurs pour chaque moteur.

**Hors périmètre**

- Créer, supprimer ou migrer des bases.
- Conserver indéfiniment l'alias historique après la migration des clients.

---

## E7 — Conteneur et livraison

### DA-021 — Construire une image multi-runtime sans compiler les runtimes

```yaml
id: DA-021
title: Construire une image multi-runtime sans compiler les runtimes
epic: E7
priority: P1
depends_on: []
labels: [docker, performance, runtime]
```

**Objectif**

Réduire le temps de build de l'image tout en conservant les runtimes nécessaires à la compilation des dépendances natives des projets.

**Périmètre**

- Baser le runtime principal sur une image Bun Alpine fixée par digest.
- Copier Python 3.12, Ruby 3.3 et Go 1.23 depuis des images Alpine officielles multi-stage.
- Installer des versions fixées de Poetry et Bundler.
- Installer des versions fixées de PM2 et Vite globalement.
- Conserver le compilateur et les headers nécessaires aux extensions natives pip/gem/npm.
- Valider les versions et modules critiques pendant le build.
- Compiler deploy-agent sous forme de binaire Bun et ne pas copier le binaire généré dans Git.

**Critères d'acceptation**

- Le build Docker ne compile ni Python, ni Ruby, ni Go à partir du code source.
- `node`, `bun`, `python`, `poetry`, `ruby`, `bundle` et `go` s'exécutent dans l'image finale.
- Un fixture doté d'une extension native peut installer ses dépendances.
- L'agent démarre avec le binaire `/usr/local/bin/deploy-agent`.

**Vérification**

- Build propre de l'image et smoke test des versions.
- Comparaison documentée des temps de build avant et après.

**Hors périmètre**

- Une image différente par runtime.
- Mise à jour automatique des versions sans PR.

### DA-022 — Préparer un système de fichiers, des volumes et un entrypoint sécurisés

```yaml
id: DA-022
title: Préparer un système de fichiers des volumes et un entrypoint sécurisés
epic: E7
priority: P0
depends_on: [DA-021]
labels: [docker, permissions, persistence]
```

**Objectif**

Initialiser le conteneur avec une persistance et des permissions compatibles avec Git, le déploiement et les services root.

**Périmètre**

- Créer des utilisateurs distincts `git` et `deploy`.
- Donner à `git` l'ownership des dépôts bare et à `deploy` celui des worktrees/caches.
- Restreindre `/app/data`, les fichiers JSON, les artefacts PM2 et les configurations Nginx.
- Initialiser `repos.json` et `ports.json` uniquement s'ils sont absents.
- Persister `/app`, l'état PM2 et les caches des package managers dans des volumes.
- Démarrer fcgiwrap, Nginx et le daemon PM2 ; exécuter `pm2 resurrect`.
- Redémarrer le binaire de l'agent après un arrêt inattendu.
- N'exposer que Nginx sur le port hôte `3080` ; conserver l'API de l'agent en interne sur `8080`.
- Ajouter un healthcheck interne de l'agent.

**Critères d'acceptation**

- Le processus applicatif ne peut pas écrire dans les dépôts bare, les données sensibles ou les configurations Nginx.
- L'état des dépôts, ports, PM2 et caches survit au redémarrage.
- L'hôte publie un port unique pour l'API, Git et les deployments via Nginx.
- Le premier boot crée l'état ; les suivants préservent son contenu.
- Le healthcheck échoue lorsque l'agent ne répond pas.

**Vérification**

- Test des permissions par utilisateur dans le conteneur.
- Cycle `up -> deploy -> restart -> inspect`.

**Hors périmètre**

- Orchestrateur autre que Docker Compose.

### DA-023 — Automatiser la qualité et la publication de l'image dans GHCR

```yaml
id: DA-023
title: Automatiser la qualité et la publication de l'image dans GHCR
epic: E7
priority: P1
depends_on: [DA-021]
labels: [ci, docker, release]
```

**Objectif**

Valider les modifications dans les pull requests et publier des images traçables sur main et les tags.

**Périmètre**

- En PR : checkout, Bun, installation gelée et typecheck.
- Après le contrôle qualité sur un push/tag : configurer Buildx, s'authentifier auprès de GHCR et build/push.
- Générer les tags SemVer complet, major.minor, major, `edge`, SHA court et `latest` lorsque pertinent.
- Utiliser le cache GHA pour les couches Docker.
- Restreindre les permissions du job au strict nécessaire.
- Faire consommer par Compose une version configurable, sans dépendre implicitement de `latest`.

**Critères d'acceptation**

- Une PR avec un typecheck en échec ne passe pas le job quality.
- Une pull request ne publie jamais d'image.
- Un push sur main publie `edge` et le SHA.
- Un tag `vX.Y.Z` publie les tags SemVer attendus.
- L'image publiée possède les labels OCI générés par metadata action.

**Vérification**

- Valider le workflow avec une PR, un push sur main et un tag de test.

**Hors périmètre**

- Déploiement automatique de l'image publiée.

---

## E8 — Preuve de comportement

### DA-024 — Créer une suite minimale de régression du deploy agent

```yaml
id: DA-024
title: Créer une suite minimale de régression du deploy agent
epic: E8
priority: P0
depends_on: [DA-001, DA-006, DA-008, DA-012, DA-020, DA-022]
labels: [tests, ci, reliability]
```

**Objectif**

Prouver les contrats critiques du refactoring et empêcher que le pipeline soit publié avec le seul typecheck.

**Périmètre**

- Restaurer `bun test` comme gate du job quality.
- Tester la validation, le mutex, le catalogue de runtimes, le gestionnaire de ports, le parsing des logs et les erreurs.
- Tester le pipeline/rollback avec un registre fake et un échec à chaque étape.
- Tester les providers de base sans dépendre de services externes dans la suite unitaire.
- Créer un smoke E2E de l'image avec dépôt, push, déploiement, health, redéploiement et suppression.
- Créer des fixtures de port pour Vite et FastAPI ; étendre aux autres runtimes selon DA-012.
- Conserver des tests petits et orientés comportement, sans dupliquer les détails internes de chaque classe.

**Critères d'acceptation**

- `bun test` et `bun run typecheck` passent localement et dans la CI.
- Une régression de l'ordre des étapes ou du rollback fait échouer la suite.
- Une régression qui ignore le port alloué fait échouer l'E2E.
- Le smoke test confirme que la release précédente reste accessible après un déploiement invalide.
- Les résultats distinguent clairement les tests unitaires, l'intégration conteneur et l'E2E.

**Vérification**

- Exécuter `cd agent && bun test && bun run typecheck`.
- Construire l'image et exécuter le smoke E2E documenté.

**Hors périmètre**

- Matrice exhaustive des versions de tous les runtimes.
- Dépendance obligatoire à de vraies bases dans le gate rapide des PR.

---

## 5. Ordre d'exécution recommandé

1. Fondations : DA-001, DA-002, DA-003 et DA-007.
2. Release transactionnelle : DA-004, DA-005 et DA-006.
3. Runtimes et commandes : DA-008, DA-010 et DA-011.
4. Conteneur de base et persistance : DA-021 et DA-022.
5. Performance des packages : DA-009.
6. Processus et réseau : DA-012, DA-013, DA-014 et DA-015.
7. Exploitation : DA-016, DA-017 et DA-018.
8. Services auxiliaires : DA-019 et DA-020.
9. Livraison et régression : DA-023 et DA-024.

## 6. Définition globale de « terminé »

Un ticket ne peut être fermé que lorsque :

- tous ses propres critères d'acceptation ont été démontrés ;
- les erreurs et les logs n'exposent aucun secret ;
- les modifications de contrat sont répercutées dans le README/l'API ;
- `bun run typecheck` et les tests pertinents passent ;
- les modifications du conteneur disposent au minimum d'un build et d'un smoke test réels ;
- toute limitation résiduelle est consignée dans l'issue elle-même, sans créer d'abstraction préventive.

## 7. Références techniques

- Stratégie détaillée des ports : [`dynamic-port-strategy.md`](./dynamic-port-strategy.md)
- Intervalle historique utilisé pour reconstruire le backlog : `0563024..95c10c3`
- La référence historique ne sert qu'à la traçabilité ; le MCD doit générer tous les tickets comme travail proposé.
