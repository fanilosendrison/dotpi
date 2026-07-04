# Spec — path-guard : Stats Logging

- **Date** : 2026-07-04
- **Statut** : Spécification (pas encore implémenté)
- **Dossier de sortie** : `/Users/famillesendrison/neelopedia/stats/pi/path-guard/`
- **Extension touchée** : `~/.pi/agent/extensions/path-guard.ts`
- **Module interne à créer** : `~/.pi/agent/extensions/path-guard-internals/stats-log.ts`
- **Core partagé** : `~/.agents/agent-enforcers/path-guard/src/core/path-guard.ts` — **pas touché**

---

## But

Logger chaque intervention de path-guard (redirect write/edit, bash rewrite) dans un fichier `events.jsonl` append-only, afin de pouvoir calculer :

- **Nombre brut de redirects** par session, par model, par repo
- **Ratio** `redirects / total_writes_vers_dot*` (taux d'erreur par l'agent)
- **Ratio** `bash_rewrites / total_bash_vers_dot*`

Le tout sans modifier d'un iota le core partagé dans `.agents/`.

---

## Emplacement des logs

```
/Users/famillesendrison/neelopedia/stats/pi/path-guard/events.jsonl
```

Même pattern que read-deduplicator : un seul fichier partagé entre toutes les sessions Pi, `atomicAppend` pour la cohérence.

---

## Architecture — Où se fait le logging

Le core partagé (`checkPath`, `rewriteBashCommand`) reste **pur** — pas d'effet de bord, pas de callback, pas de logging.

C'est **l'extension Pi** qui inspecte le résultat retourné par le core et décide de logger.

### Détection locale d'un dot* repo

Pour compter le dénominateur, l'extension a besoin de savoir si un path cible un repo dot* — même quand `checkPath` retourne `{ allowed: true }` (soit parce que le path est déjà bien adressé, soit parce qu'il n'a rien à voir avec dot*). On ne peut pas se baser sur `checkPath` seul car il ne distingue pas les deux cas.

→ L'extension embarque une petite fonction utilitaire locale (pas dans le core) :

```ts
function targetsDotRepo(givenPath: string): boolean {
  const projects = join(homedir(), "Developper", "Projects");
  const expanded = givenPath === "~" || givenPath.startsWith("~/")
    ? homedir() + givenPath.slice(1)
    : givenPath;
  return expanded.startsWith(projects + "/") &&
         expanded.slice(projects.length + 1).startsWith("dot");
}
```

Pas besoin de `realpathSync`. C'est une approximation — un path comme `~/dotpi` ou `./dotpi` ne matchera pas, mais dans la pratique les writes/edits de Pi utilisent des paths absolus. On peut affiner plus tard si besoin.

---

## Événements loggés

### Champs communs

Identiques à read-deduplicator :

| Champ | Type | Description |
|---|---|---|
| `timestamp` | ISO-8601 UTC | `new Date().toISOString()` |
| `eventId` | UUID v4 | `crypto.randomUUID()` |
| `extension` | String | `"path-guard"` |
| `eventType` | String | `"redirect"`, `"bash_rewrite"`, ou `"session_summary"` |
| `agent` | String | `"pi"` |
| `workspace` | String | CWD de la session Pi |
| `sessionId` | UUID | Généré au chargement de l'extension, constant pour la session |
| `cycleId` | UUID | Renouvelé à chaque cycle (même mécanisme que read-deduplicator) |
| `details` | Object | Dépend de `eventType` |

### `eventType: "redirect"`

Émis quand un `write` ou `edit` ciblant un dot* repo est redirigé vers le gateway `~/.` (checkPath a retourné `{ allowed: false, rewrittenPath }`).

```ts
details: {
  toolType:     "write" | "edit",
  repo:         "dotpi" | "dotagents" | "dotclaude" | "dot...",
  givenPath:    "/Users/famillesendrison/Developper/Projects/dotpi/extensions/foo.ts",
  rewrittenTo:  "/Users/famillesendrison/.pi/agent/extensions/foo.ts",
}
```

**Pas loggé si** le path ne cible pas un dot* repo (pas d'intérêt).

### `eventType: "bash_rewrite"`

Émis quand une commande `bash` est réécrite par `rewriteBashCommand`.

```ts
details: {
  repo:           "dotpi",
  redirectCount:  2,
  originalCmd:    "cp foo.ts ~/Developper/Projects/dotpi/extensions/ && ...",
  pathsChanged:   [
    "/Users/famillesendrison/Developper/Projects/dotpi/extensions/foo.ts",
    "/Users/famillesendrison/Developper/Projects/dotpi/extensions/bar.md"
  ]
}
```

`originalCmd` est tronqué à **200 caractères** (éviter de loguer des commandes énormes).
`pathsChanged` contient les paths individuels qui ont été réécrits.

### `eventType: "session_summary"`

Émis à `agent_end` si au moins un redirect ou bash_rewrite a eu lieu durant la session. Contient les **compteurs cumulés** de la session et les **ratios**.

```ts
details: {
  model:          "deepseek-v4-flash",
  redirects:      5,
  correctWrites:  20,
  writeTotal:     25,
  writeRatio:     0.2,            // redirects / writeTotal

  bashRewrites:   3,
  correctBash:    17,
  bashTotal:      20,
  bashRatio:      0.15,           // bashRewrites / bashTotal

  repos:          ["dotpi", "dotagents"]
}
```

- **`session_shutdown`** : le flush est fait sur `session_shutdown` (pas `agent_end`).
- **`correctWrites`** : nombre de writes/edits vers un dot* repo qui étaient **déjà bien adressés** (via `~/.pi/agent/`, `~/.agents/`, etc.)
- **`correctBash`** : nombre de commandes bash vers un dot* repo qui n'ont **pas eu besoin de rewrite** (car les paths étaient déjà corrects)

---

## Logique de comptage dans l'extension

### Write / Edit

```
Quand tool_call (write ou edit) :
  givenPath ← event.input

  si targetsDotRepo(givenPath) est vrai :
    result ← checkPath(givenPath)
    si result.allowed est faux ET result.rewrittenPath existe :
      → statsLog.addRedirect(...)    # numérateur
      → rewrite event.input
    sinon :
      → statsLog.incCorrectWrite()   # dénominateur (compteur mémoire, pas d'event)
  sinon :
    → ignorer (pas un dot* repo)
```

### Bash

```
Quand tool_call (bash) :
  command ← event.input.command

  si targetsDotRepo(command) est vrai (un des paths extraits est dans un dot*) :
    result ← rewriteBashCommand(command)
    si result.rewritten est vrai :
      → statsLog.addBashRewrite(...)   # numérateur
      → event.input.command = result.newCommand
    sinon :
      → statsLog.incCorrectBash()      # dénominateur (compteur mémoire)
  sinon :
    → ignorer
```

### Session shutdown

```
Quand session_shutdown :
  → statsLog.flushSummary(model, turnIndex)
```

> **Pourquoi `session_shutdown` plutôt que `agent_end` ?**
> `agent_end` se déclenche à chaque cycle (plusieurs fois par session).
> En flushant à chaque cycle, les compteurs se réinitialisent entre cycles,
> et on obtient des `session_summary` multiples qui ne reflètent pas la
> session complète. `session_shutdown` garantit un unique flush final avec
> les totaux cumulés.
>
> Les compteurs mémoire sont reset après le flush (defensive — si
> `session_shutdown` n'est pas fiable, au pire on perd une session,
> on n'a pas de double-compte).

---

## Fichier module interne

**`~/.pi/agent/extensions/path-guard-internals/stats-log.ts`**

Exports une API similaire à `blocked-log.ts` de read-deduplicator, mais adaptée à path-guard :

```ts
interface StatsLogAPI {
  filePath: string;

  // Appelé à chaque redirect write/edit
  addRedirect(entry: {
    ts: string;
    toolType: "write" | "edit";
    repo: string;
    givenPath: string;
    rewrittenTo: string;
  }): void;

  // Appelé à chaque bash rewrite
  addBashRewrite(entry: {
    ts: string;
    repo: string;
    originalCmd: string;       // tronqué à 200 chars
    pathsChanged: string[];
    redirectCount: number;
  }): void;

  // Incrémente les compteurs corrects (mémoire uniquement)
  incCorrectWrite(): void;
  incCorrectBash(): void;

  // Flush le session_summary à agent_end
  flushSummary(event: {
    endTs: string;
    model?: string;
    totalTurns: number;
  }): void;
}
```

Le module utilise `atomicAppend` pour écrire dans `events.jsonl`. Idéalement on importe le même utilitaire que read-deduplicator :

```
~/.pi/agent/extensions/read-deduplicator-internals/atomic-writer.ts
```

Mais on ne factorise rien pour l'instant (convention : on fait le travail de factorisation quand toutes les extensions auront leur logging). Donc soit on duplique `atomicAppend`, soit on fait un simple import direct. **À décider à l'implémentation** — ce n'est pas bloquant.

---

## Exemples de lignes dans events.jsonl

### Redirect

```json
{
  "timestamp": "2026-07-04T14:04:10.432Z",
  "eventId": "7eda4c98-f25b-4e19-8a16-a916dbacd33c",
  "extension": "path-guard",
  "eventType": "redirect",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotagents",
  "sessionId": "15639ecc-61c9-4860-9bbc-7af76dbc0165",
  "cycleId": "cc0c3225-23bc-4fc1-b9c7-ca13af65dbd3",
  "details": {
    "toolType": "write",
    "repo": "dotpi",
    "givenPath": "/Users/famillesendrison/Developper/Projects/dotpi/extensions/foo.ts",
    "rewrittenTo": "/Users/famillesendrison/.pi/agent/extensions/foo.ts"
  }
}
```

### Bash rewrite

```json
{
  "timestamp": "2026-07-04T14:17:33.599Z",
  "eventId": "570bd603-82fa-4baa-9eb2-9ff1eccce621",
  "extension": "path-guard",
  "eventType": "bash_rewrite",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotagents",
  "sessionId": "15639ecc-61c9-4860-9bbc-7af76dbc0165",
  "cycleId": "c7a20876-2bb4-478f-b990-2ef56d533340",
  "details": {
    "repo": "dotpi",
    "redirectCount": 2,
    "originalCmd": "cp foo.ts ~/Developper/Projects/dotpi/extensions/ && echo 'done' > ~/Developper/Projects/dotpi/status.md",
    "pathsChanged": [
      "/Users/famillesendrison/Developper/Projects/dotpi/extensions/foo.ts",
      "/Users/famillesendrison/Developper/Projects/dotpi/status.md"
    ]
  }
}
```

### Session summary

```json
{
  "timestamp": "2026-07-04T15:00:00.000Z",
  "eventId": "d9178526-62f7-41d2-a67f-1b663654bbeb",
  "extension": "path-guard",
  "eventType": "session_summary",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "3e509bb3-7ca3-4347-848d-8ec72b9d65d9",
  "cycleId": "686f7a9f-1cb8-42e2-a834-332a1add3515",
  "details": {
    "model": "deepseek-v4-flash",
    "redirects": 5,
    "correctWrites": 20,
    "writeTotal": 25,
    "writeRatio": 0.20,
    "bashRewrites": 3,
    "correctBash": 17,
    "bashTotal": 20,
    "bashRatio": 0.15,
    "repos": ["dotpi", "dotagents"]
  }
}
```

---

## Capturer le model

Comme read-deduplicator : un hook `before_provider_request` capture `event.payload.model` dans une variable accessible au moment du `session_summary`.

Le model est loggué uniquement dans le `session_summary`, pas dans chaque `redirect`/`bash_rewrite` individuel — on peut le déduire par appartenance à la session. Si on veut du grain model par redirect plus tard, on ajoutera le champ dans les events individuels.

---

## Mode dry-run

Pas nécessaire pour path-guard. Le but est de compter les interventions réelles, pas de simuler. (On peut toujours ajouter une variable d'env `PG_DRY_RUN` plus tard si besoin.)

---

## Pas de .pathfilter

Contrairement à read-deduplicator, on veut **tous** les événements — en exclure un fausserait les ratios. Pas de filtre.

---

## Pas de health-check status bar

Le nombre de redirects est trop faible (souvent 0) pour justifier un affichage permanent dans la status bar de Pi. Si on veut un indicateur plus tard, on peut le faire — mais pas dans cette spec.

---

## Pas de log rotation

Même règle que read-deduplicator : la rotation n'est jamais faite par l'extension. C'est le consommateur (dashboard/CLI) qui s'en charge si le fichier dépasse 5 MB. Retention indéfinie.

---

## Points ouverts (à trancher à l'implémentation)

1. **atomicAppend** : on importe celui de `read-deduplicator-internals/` ou on duplique ? (Pour l'instant on ne factorise pas, mais un simple import est déjà de la factorisation… à voir sur le moment.)

2. **Détection dot* repo** — la fonction `targetsDotRepo` ci-dessus ne matchera pas les paths relatifs du genre `./dotpi/foo` ou `dotpi/foo`. Dans la pratique, les writes/edits de Pi sont toujours absolus, mais pour le bash ça peut arriver. On pourra affiner si le bruit est significatif.

3. **`correctBash` compté à partir de quoi ?** — `rewriteBashCommand` retourne `{ rewritten: false }` dans deux cas : soit la commande est entièrement git, soit les paths sont déjà corrects, soit la commande ne cible pas de dot* repo. La distinction entre "déjà correct" et "hors dot*" se fait via `targetsDotRepo` appliqué aux paths extraits de la commande. C'est une approximation — si la commande contient un path dot* et un path non-dot*, on va la compter comme "vers dot*". C'est suffisant pour le ratio.

4. **Troncature de `originalCmd`** : 200 chars, avec `…` en fin si tronqué.
