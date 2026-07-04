# Spec — secret-scanner : Stats Logging

- **Date** : 2026-07-04
- **Statut** : Spécification (pas encore implémenté)
- **Dossier de sortie** : `/Users/famillesendrison/neelopedia/stats/pi/secret-scanner/`
- **Extension touchée** : `~/.pi/agent/extensions/secret-scanner.ts`
- **Module interne à créer** : `~/.pi/agent/extensions/secret-scanner-internals/stats-log.ts`
- **Core partagé** : `~/.agents/agent-enforcers/secret-scanner/src/core/scanner.ts` — **pas touché**

---

## But

Logger chaque scan de secret-scanner après un `git commit` dans un fichier `events.jsonl` append-only, afin de pouvoir calculer :

- **Nombre brut de scans** par session, par model
- **Ratio** `blocks / totalScans` (taux de blocage par session)
- **Patterns les plus fréquents** (AWS Key, GitHub Token, etc.)
- **Tendance** : est-ce que le taux de blocage diminue avec le temps ?

Le tout sans modifier d'un iota le core partagé dans `.agents/`.

---

## Emplacement des logs

```
/Users/famillesendrison/neelopedia/stats/pi/secret-scanner/events.jsonl
```

Même pattern que les autres extensions : un seul fichier partagé entre toutes les sessions Pi, `atomicAppend` pour la cohérence.

---

## Événements loggés

### Champs communs

Identiques à `path-guard`, `git-commits-push-enforcer`, etc. :

| Champ | Type | Description |
|---|---|---|
| `timestamp` | ISO-8601 UTC | `new Date().toISOString()` |
| `eventId` | UUID v4 | `crypto.randomUUID()` |
| `extension` | String | `"secret-scanner"` |
| `eventType` | String | `"block"` ou `"session_summary"` |
| `agent` | String | `"pi"` |
| `workspace` | String | CWD de la session Pi |
| `sessionId` | UUID | Généré au chargement de l'extension, constant pour la session |
| `cycleId` | UUID | Renouvelé à chaque cycle |
| `details` | Object | Dépend de `eventType` |

### `eventType: "block"`

Émis quand un `git commit` est bloqué car le staged diff contient un ou plusieurs secrets.

```ts
details: {
  findingsCount: 1,               // nombre de findings
  findings: [                      // détail de chaque finding
    {
      name: "AWS Access Key",     // nom du pattern
      line: "AKIA...FAKE-KEY...", // ligne tronquée (80 chars)
      lineNumber: 12,              // numéro de ligne dans le diff
    }
  ],
  commitMsg: "feat: add config",  // message du commit (optionnel, 100 chars max)
}
```

**Pas loggé si** le scan est clean (pas de secret) — seuls les `block` sont loggés individuellement.

### `eventType: "session_summary"`

Émis **une seule fois** à la fin de la session (`session_shutdown`). Contient les compteurs cumulés et les ratios.

```ts
details: {
  model:          "deepseek-v4-flash",
  totalScans:     12,             // nombre total de git commit scannés
  blocks:         2,              // nombre de commits bloqués
  clean:          10,             // nombre de commits clean
  blockRate:      0.17,           // blocks / totalScans
  patterns:       [               // top patterns (dédupliqués, triés par fréquence)
    { name: "AWS Access Key", count: 1 },
    { name: "Generic API Key", count: 1 },
  ],
}
```

Le résumé n'est écrit que si `totalScans > 0` (sessions sans `git commit` — rien).

---

## Logique de logging dans l'extension

```
Quand tool_call (bash) :
  cmd ← event.input.command

  si /\bgit\s+commit\b/ ne match pas → return (ignorer)

  # 1. Compter le scan (même si git diff échoue — c'est un scan tenté)
  statsLog.incTotal()

  # 2. Lire le staged diff
  try :
    diff ← execSync("git diff --cached")
    si diff vide → statsLog.incClean() → return

    result ← scanDiff(diff)
    si result.clean :
      → statsLog.incClean()
    sinon :
      → statsLog.addBlock({
          findings: result.findings,
          commitMsg: extrait du cmd (optionnel)
        })
      → return { block: true, reason: "Secret(s) detected..." }

  catch error :
    → statsLog.incClean()  # on considère que c'est clean (fail-open)
```

---

## Fichier module interne

**`~/.pi/agent/extensions/secret-scanner-internals/stats-log.ts`**

API :

```ts
interface StatsLogAPI {
  filePath: string;

  // Incrémente le compteur de total (tous les git commit scannés)
  incTotal(): void;

  // Log un blocage avec ses findings
  addBlock(entry: {
    ts: string;
    findings: Array<{ name: string; line: string; lineNumber: number }>;
    commitMsg?: string;        // optionnel, tronqué à 100 chars
  }): void;

  // Incrémente le compteur de scans clean (commit autorisé)
  incClean(): void;

  // Flush le session_summary à session_shutdown
  flushSummary(event: {
    endTs: string;
    model?: string;
    totalTurns: number;
  }): void;
}
```

Même pattern que `git-commits-push-enforcer-internals/stats-log.ts` : compteurs mémoire, `atomicAppend`, reset après flush.

---

## Exemples de lignes dans events.jsonl

### Block

```json
{
  "timestamp": "2026-07-04T15:30:00.000Z",
  "eventId": "a1b2c3d4-...",
  "extension": "secret-scanner",
  "eventType": "block",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "abc123-...",
  "cycleId": "def456-...",
  "details": {
    "findingsCount": 1,
    "findings": [
      { "name": "AWS Access Key", "line": "AKIA...FAKE-KEY...", "lineNumber": 12 }
    ],
    "commitMsg": "feat: add config"
  }
}
```

### Session summary

```json
{
  "timestamp": "2026-07-04T16:00:00.000Z",
  "eventId": "c3d4e5f6-...",
  "extension": "secret-scanner",
  "eventType": "session_summary",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "abc123-...",
  "cycleId": "ghi789-...",
  "details": {
    "model": "deepseek-v4-flash",
    "totalScans": 12,
    "blocks": 2,
    "clean": 10,
    "blockRate": 0.17,
    "patterns": [
      { "name": "AWS Access Key", "count": 1 },
      { "name": "Generic API Key", "count": 1 }
    ]
  }
}
```

---

## Capturer le model

Même mécanisme que `git-commits-push-enforcer` : hook `before_provider_request` pour capturer `event.payload.model`.

---

## Pas de .pathfilter

Comme les autres extensions de sécurity, on veut tous les événements.

---

## Pas de log rotation

Même règle que les autres extensions : jamais par l'extension. Le consommateur s'en charge si le fichier dépasse 5 MB.

---

## Points ouverts

1. **`incTotal()` avant ou après `execSync` ?** — Avant. Même si `git diff` échoue (pas de repo git, etc.), le commit a été tenté et scanné (ou tenté de l'être). C'est cohérent avec le dénominateur.

2. **Fail-open vs fail-closed** — Si `execSync` ou `scanDiff` lance une exception, on appelle `incClean()` (fail-open : on laisse passer le commit). C'est le comportement actuel de l'extension. Le `totalScans` inclut ces cas.

3. **`commitMsg` optionnel** — On peut l'extraire du `cmd` avec une regex, mais ce n'est pas critique pour les métriques. Optionnel dans le schema, pas dans l'API publique (le test doit marcher avec et sans).

4. **Patterns dédupliqués** — Dans le `session_summary`, on agrège les patterns par nom (AWS Access Key, GitHub Token, etc.) pour voir lesquels sont les plus fréquents. Pas de limite de taille, mais dans la pratique < 10 patterns.
