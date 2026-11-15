# Stratégie technique : gestion dynamique des ports

## Objectif

Garantir que les services déployés via l'agent utilisent systématiquement le port assigné dynamiquement, sans conflit avec les configurations statiques de l'utilisateur (`.env`, CLI args, code source), indépendamment de la stack technique.

---

## Architecture actuelle

### Flux de déploiement

```
PortManager.allocate()
    → trouve un port libre dans [3000, 9000]
    → stocke dans /app/data/ports.json
        ↓
ProcessStage.execute()
    → appelle pm2Manager.start(service, deploymentId, port, command, cwd, env)
        ↓
PM2Manager.start()
    → const envVars = { ...env, PORT: port.toString(), HOST: "0.0.0.0" }
    → génère un wrapper script : #!/bin/sh\nexec ${startCommand}\n
    → génère un ecosystem file PM2 avec env: envVars
    → pm2 start <ecosystemFile>
        ↓
waitForPort(port) → poll http://127.0.0.1:${port} jusqu'à réponse < 500
```

Le module `runtime-strategy.ts` ajoute une couche partielle : pour Vite uniquement, `prepareNodeStart()` injecte `--port N --host 0.0.0.0` sur la ligne de commande. Pour les autres runtimes (Python, Ruby, Go), seul le `PORT` env est injecté.

### Ce qui fonctionne déjà

- Allocation de port avec mutex et double vérification (registry + `isPortAvailable`)
- `killPort` + `waitForPortFree` avant lancement, évitant les collisions avec des processus obsolètes
- `waitForPort` post-démarrage avec timeout de 60s
- Séparation wrapper/ecosystem PM2 donnant un point d'extension clair
- Déploiement en worktree git (copie), modifications non destructives vis-à-vis du repo original

---

## Points de rupture identifiés

| # | Point de rupture | Mécanisme | Impact |
|---|---|---|---|
| **R1** | Fichiers `.env` utilisateur | L'utilisateur peut avoir `PORT=8080` dans `.env`, `.env.local`, `.env.production`. Des libs comme `python-dotenv` (avec `override=True`) ou `dotenv` Node écrasent `process.env.PORT` au runtime. | L'app écoute sur le mauvais port, health check échoue. |
| **R2** | Flags CLI codés dans le Procfile ou `service.start` | Si l'utilisateur fournit `web: uvicorn main:app --port 8080`, le flag CLI a priorité sur l'env var. Le `prepareStart` actuel ne strippe pas les flags existants. | L'application ignore complètement le port alloué. |
| **R3** | Ports hardcodés dans le code source | `uvicorn.run(app, port=8000)` ou `app.listen(3000)` directement dans le code. Aucun mécanisme externe ne peut surcharger cela sans modifier le code. | Détection impossible avant exécution ; seule la vérification post-démarrage le révèle. |
| **R4** | Variables d'alias non standard | Certains frameworks utilisent `SERVER_PORT`, `HTTP_PORT`, `LISTEN_PORT`, `BIND_ADDRESS` au lieu de `PORT`/`HOST`. | L'injection `PORT` seule ne suffit pas pour ces frameworks. |
| **R5** | Sous-processus et conteneurs internes | Si l'app lance ses propres workers (fork, multiprocessing) ou des conteneurs Docker, ils héritent de l'environnement parent mais peuvent lire leur propre configuration depuis des fichiers. | Les enfants peuvent écouter sur des ports différents. |

---

## Stratégie proposée : enforcement multicouche

### Principe directeur

**Defense in depth** : aucun mécanisme unique ne garantit à 100% qu'une application arbitraire écoutera sur le port assigné. La stratégie empile 5 couches indépendantes, chacune couvrant une classe d'échec différente. La dernière couche (vérification) agit comme filet de sécurité et fournit un diagnostic exploitable quand toutes les autres échouent.

L'insight clé : les déploiements s'exécutent dans des worktrees git (copies). On peut donc sanitizer les fichiers de configuration du worktree sans toucher au repo original de l'utilisateur.

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                    PROCESS STAGE                            │
│                                                             │
│  1. Allouer le port (existant, inchangé)                    │
│     PortManager.allocate() → port N                         │
│                                                             │
│  2. SANITIZATION DU WORKTREE (NOUVEAU)                      │
│     EnvSanitizer.sanitize(servicePath, port)                │
│     → scanne .env*, supprime PORT=/HOST=                     │
│     → opère sur la copie worktree, pas le repo              │
│                                                             │
│  3. PRÉPARATION DE LA COMMANDE (amélioré)                   │
│     RuntimePlan.prepareStart(cmd, port, path)               │
│     → injecte --port/--host pour chaque runtime             │
│     → strippe les flags --port existants                    │
│                                                             │
│  4. WRAPPER SCRIPT RENFORCÉ (amélioré)                      │
│     #!/bin/sh                                               │
│     export PORT HOST HOSTNAME SERVER_PORT HTTP_PORT          │
│     exec <command>                                          │
│                                                             │
│  5. INJECTION ENV PM2 (existant, conservé)                  │
│     env: { PORT, HOST, ...runtimeEnv, ...extraEnv }         │
│                                                             │
│  6. VÉRIFICATION POST-DÉMARRAGE (amélioré)                  │
│     waitForPort() → HTTP health check                       │
│     + verifyPortBinding(pid, port) → ss/lsof check          │
│     + diagnoseFailure() si échec → logs + suggestions       │
└─────────────────────────────────────────────────────────────┘
```

---

## Plan d'implémentation

### Étape 1 : Créer `EnvSanitizer` (nouveau module)

**Fichier** : `deploy-agent/agent/src/services/deploy/env-sanitizer.ts`

**Objectif** : éliminer les conflits `.env` avant qu'ils n'atteignent le runtime.

**Comportement** :

1. Liste tous les fichiers correspondant à `.env*` dans le `servicePath` (`.env`, `.env.local`, `.env.production`, `.env.development`, etc.)
2. Pour chaque fichier, lit le contenu et commente toute ligne matchant `^\s*(?:export\s+)?(PORT|HOST|HOSTNAME|SERVER_PORT|HTTP_PORT|LISTEN_PORT|BIND_ADDRESS)\s*=`
3. Remplace par une ligne commentée : `# PORT removed by deploy-agent (dynamic allocation: <port>)`
4. Ne touche pas aux autres variables du fichier
5. Retourne un rapport détaillé (`SanitizationReport`) pour le logging

**Interface** :

```typescript
export interface SanitizationChange {
  file: string;
  variable: string;
  oldValue: string;
}

export interface SanitizationReport {
  filesScanned: string[];
  changes: SanitizationChange[];
}

export class EnvSanitizer {
  sanitize(servicePath: string, port: number): SanitizationReport;
}
```

**Sécurité** :
- Le worktree est une copie jetable créée par `WorktreeStage`. Le repo original n'est jamais modifié.
- Si le déploiement échoue, le worktree est nettoyé. Au prochain déploiement, un nouveau worktree est créé depuis le HEAD du repo.
- L'utilisateur conserve `PORT=8080` dans son repo pour le développement local ; il est simplement neutralisé lors du déploiement.

---

### Étape 2 : Améliorer `prepareStart` dans `runtime-strategy.ts`

**Fichier** : `deploy-agent/agent/src/pipeline/runtime-strategy.ts`

**Objectif** : injecter les flags CLI appropriés pour chaque runtime, en strippant les flags conflictuels existants.

**Règles communes à tous les runtimes** :

1. **Stripper les flags conflictuels existants** (`--port`, `-p`, `--bind`, `-b`, `PORT=x`)
2. **Injecter les flags canoniques** pour le runtime détecté
3. **Préserver le reste de la commande** intact

#### Table de résolution par runtime

| Runtime | Patterns à stripper | Flags à injecter |
|---------|---------------------|-------------------|
| Node/Vite | `--port\s+\S+`, `--host\s+\S+` | `--port {N} --host 0.0.0.0` |
| Python/uvicorn | `--port\s+\S+`, `--host\s+\S+` | `--port {N} --host 0.0.0.0` |
| Python/gunicorn | `-b\s+\S+`, `--bind\s+\S+` | `-b 0.0.0.0:{N}` |
| Ruby/Puma | `-p\s+\S+`, `--port\s+\S+` | `-p {N} -b 0.0.0.0` |
| Docker run | (rien à stripper) | `--env PORT={N} --env HOST=0.0.0.0` |
| Go/generic | (dépend du framework) | repose sur env vars |

#### Fix critique : `prepareNodeStart`

Actuellement, la fonction détecte un `--port` existant et retourne la commande inchangée (laissant le mauvais port). Le correctif : **stripper puis réinjecter**.

```typescript
// Avant (bug) :
function prepareNodeStart(command, port, needsCliPort) {
  if (/--port(?:=|\s+)\S+|\bPORT=\S+/.test(command)) return command; // ← laisse le mauvais port !
  // ...
}

// Après (correct) :
function prepareNodeStart(command, port, needsCliPort) {
  let cmd = command;
  // Stripper les flags existants
  cmd = cmd.replace(/--port(?:=|\s+)\S+/g, "").trim();
  cmd = cmd.replace(/--host(?:=|\s+)\S+/g, "").trim();
  // Réinjecter
  const flags = `--port ${port} --host 0.0.0.0`;
  return /\b(npm|yarn|pnpm|bun)\s+run\b/.test(cmd)
    ? `${cmd} -- ${flags}`
    : `${cmd} ${flags}`;
}
```

#### Nouveaux `prepareStart` à ajouter

- `prepareUvicornStart` : `--port {N} --host 0.0.0.0` avec strip
- `prepareGunicornStart` : `-b 0.0.0.0:{N}` avec strip
- `preparePumaStart` : `-p {N} -b 0.0.0.0` avec strip
- `prepareDockerStart` : injection `--env PORT={N} --env HOST=0.0.0.0` pour `docker run`

---

### Étape 3 : Renforcer le wrapper script dans `PM2Manager.start()`

**Fichier** : `deploy-agent/agent/src/services/pm2-manager.ts`

**Objectif** : exporter explicitement toutes les variantes de variables de port connues dans le shell avant l'exécution de la commande.

**Wrapper actuel** (minimaliste) :

```sh
#!/bin/sh
exec ${startCommand}
```

**Wrapper renforcé** :

```sh
#!/bin/sh
# Deploy-agent port enforcement layer
export PORT={port}
export HOST=0.0.0.0
export HOSTNAME=0.0.0.0
export SERVER_PORT={port}
export HTTP_PORT={port}
export LISTEN_PORT={port}
export BIND_ADDRESS=0.0.0.0
export NODE_ENV=production
exec {startCommand}
```

**Justification** :
- Même si PM2 injecte déjà `PORT` et `HOST` dans l'environnement du processus, le wrapper offre une seconde garantie explicite
- L'export précède l'exécution de l'application, donc ces valeurs sont présentes dans `environ` avant tout code applicatif
- Les alias (`SERVER_PORT`, `HTTP_PORT`, `LISTEN_PORT`) couvrent les frameworks moins conventionnels

---

### Étape 4 : Intégrer `EnvSanitizer` dans `ProcessStage.execute()`

**Fichier** : `deploy-agent/agent/src/pipeline/stages/process.stage.ts`

**Objectif** : appeler la sanitization après promotion du worktree et avant le démarrage PM2.

**Point d'insertion** : après `promoteCandidateWorktree()` et la résolution du `servicePath`, avant `pm2.start()`.

```typescript
// Dans ProcessStage.execute(), après:
const activeWorktreePath = await this.registry.git.promoteCandidateWorktree(...);
ctx.worktreePromoted = true;
servicePath = resolvePathWithin(activeWorktreePath, ctx.serviceConfig?.root);
ctx.servicePath = servicePath;

// NOUVEAU : sanitize .env files
const sanitizer = new EnvSanitizer();
const report = sanitizer.sanitize(servicePath, port);
if (report.changes.length > 0) {
  // Logger le rapport pour diagnostic
  console.log(`[env-sanitizer] Neutralized ${report.changes.length} port-related env vars in ${report.filesScanned.length} files`);
}

// Puis continuer avec:
const runtimeEnv = ctx.runtime?.environment(servicePath, "run") ?? {};
await this.registry.pm2.start(...);
```

---

### Étape 5 : Enrichir la vérification post-démarrage

**Fichier** : `deploy-agent/agent/src/pipeline/stages/process.stage.ts`

**Objectif** : améliorer `waitForPort` avec vérification de binding réel et diagnostic d'échec exploitable.

#### 5a. Vérification de binding réel

Après que `waitForPort` confirme une réponse HTTP, vérifier que le PID du processus PM2 est bien lié au port attendu :

```typescript
private async verifyPortBinding(pid: number, port: number): Promise<boolean> {
  const result = await exec(`ss -tlnp 'sport = :${port}'`);
  return result.stdout.includes(`pid=${pid}`);
}
```

Cela distingue "quelque chose répond sur le port" (potentiellement un autre processus) de "notre processus écoute sur le bon port".

#### 5b. Diagnostic d'échec exploitable

Si `waitForPort` échoue après timeout, analyser les logs PM2 pour identifier la cause racine :

```typescript
private async diagnosePortFailure(name: string, port: number): Promise<string> {
  const logs = await this.getLogs(name, 50);

  const patterns = [
    { regex: /Address already in use|EADDRINUSE/i,
      message: "Port conflict: another process is using the port." },
    { regex: /Can't bind to|Permission denied/i,
      message: "Privilege issue: port requires elevated permissions." },
    { regex: /Error while importing|ModuleNotFoundError/i,
      message: "Application startup error (not port-related)." },
  ];

  for (const p of patterns) {
    if (p.regex.test(logs)) return `${p.message}\nRecent logs:\n${logs}`;
  }
  return `Service did not respond on port ${port}. Possible causes: hardcoded port in source code, .env override, or startup crash.\nRecent logs:\n${logs}`;
}
```

#### 5c. Détection de port non sollicité

Si le processus démarre mais n'écoute PAS sur le port alloué, scanner les ports proches pour voir si l'app écoute ailleurs (indiquant un port hardcodé) :

```typescript
async findActualListeningPort(pid: number): Promise<number | null> {
  const result = await exec(`ss -tlnp | grep "pid=${pid}"`);
  const matches = result.stdout.matchAll(/:(\d+)\s.*pid=(\d+)/g);
  for (const m of matches) {
    if (parseInt(m[2]) === pid) return parseInt(m[1]);
  }
  return null;
}
```

---

### Étape 6 : Tests et validation

**Commandes** :

```bash
cd deploy-agent/agent && bun test
```

**Cas de test à couvrir** :

1. Stack FastAPI avec `.env` contenant `PORT=9999` → doit écouter sur le port alloué
2. Stack Vite avec `"dev": "vite --port 3000"` dans `package.json` → doit écouter sur le port alloué
3. Stack Python avec `uvicorn main:app --port 7777` dans le Procfile → doit écouter sur le port alloué
4. Déploiement dont l'app crashe au démarrage → diagnostic identifie la cause probable
5. Le rapport de sanitization apparaît dans les logs, listant quelles variables ont été neutralisées

---

## Matrice de couverture des risques

| Risque | Couche(s) couvrante(s) | Résiduel |
|--------|----------------------|----------|
| R1 : `.env` utilisateur | Étape 1 (sanitization) + Étape 3 (wrapper) | Aucun |
| R2 : Flags CLI dans Procfile | Étape 2 (strip + reinject) | Aucun |
| R3 : Port hardcodé en code | Étape 5 (diagnostic) détecte, ne fixe pas | Non corrigeable sans modification du code ; le diagnostic guide l'utilisateur |
| R4 : Variables d'alias | Étape 3 (wrapper multi-var) | Minimal |
| R5 : Sous-processus/conteneurs | Étape 1 (worktree sanitized) + Étape 2 (docker prepareStart) | Conteneurs Docker complexes nécessitent un override compose |

---

## Gestion des sous-processus et conteneurs internes

### Cas : l'application fork des workers

Les enfants créés via `fork()` ou `multiprocessing` héritent de l'environnement du parent. Si le parent a reçu `PORT` via le wrapper script, les enfants aussi. La sanitization du worktree (étape 1) couvre le cas où les enfants lisent `.env` indépendamment.

### Cas : l'application lance des conteneurs Docker

Si le `startCommand` exécute `docker-compose up` ou `docker run`, les variables d'environnement ne sont PAS automatiquement transmises au conteneur. Approches :

1. Passer les variables via `--env PORT={port}` (pour `docker run`) — géré par `prepareDockerStart`
2. Utiliser un `docker-compose.override.yml` généré dynamiquement
3. Détecter le pattern `docker` dans le `startCommand` et appliquer une transformation spéciale dans `prepareStart`

---

## Critères de succès

1. Une stack FastAPI avec `.env` contenant `PORT=9999` démarre sur le port alloué par le système
2. Une stack Vite avec `"dev": "vite --port 3000"` dans `package.json` démarre sur le port alloué
3. Une stack Python avec `uvicorn main:app --port 7777` dans le Procfile démarre sur le port alloué
4. Un déploiement dont l'app crashe au démarrage produit un message d'erreur identifiant la cause probable
5. Le rapport de sanitization apparaît dans les logs de déploiement, listant quelles variables ont été neutralisées dans quels fichiers
