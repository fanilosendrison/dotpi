# Spec — post-write-linter : Stats Logging

- **Date** : 2026-07-04
- **Statut** : Spécification (pas encore implémenté)
- **Dossier de sortie** : `/Users/famillesendrison/neelopedia/stats/pi/post-write-linter/`
- **Extension touchée** : `~/.pi/agent/extensions/post-write-linter.ts`
- **Module interne à créer** : `~/.pi/agent/extensions/post-write-linter-internals/stats-log.ts`
- **Core partagé** : `~/.agents/agent-enforcers/post-write-linter/src/core/linter` — **pas touché**

---

## But

Logger les résultats du linter après chaque write/edit dans un fichier `events.jsonl` append-only, afin de pouvoir calculer :

- **Nombre d'erreurs de lint** par session, par model, par language
- **Ratio** `errors / totalChecked` (taux d'erreur)
- **Types d'erreurs** les plus fréquents (via le output)

Le tout sans modifier d'un iota le core partagé dans `.agents/`.

---

## Emplacement des logs

```
/Users/famillesendrison/neelopedia/stats/pi/post-write-linter/events.jsonl
```

Même pattern que les autres extensions : un seul fichier partagé entre toutes les sessions Pi, `atomicAppend` pour la cohérence.

---

## Événements loggés

### Champs communs

| Champ | Type | Description |
|---|---|---|
| `timestamp` | ISO-8601 UTC | `new Date().toISOString()` |
| `eventId` | UUID v4 | `crypto.randomUUID()` |
| `extension` | String | `"post-write-linter"` |
| `eventType` | String | `"lint_error"` ou `"session_summary"` |
| `agent` | String | `"pi"` |
| `workspace` | String | CWD de la session Pi |
| `sessionId` | UUID | Généré au chargement de l'extension, constant pour la session |
| `cycleId` | UUID | Renouvelé à chaque cycle |
| `details` | Object | Dépend de `eventType` |

### `eventType: "lint_error"`

Émis quand un fichier écrit ou édité contient des erreurs de lint.

```ts
details: {
  filePath: "/path/to/file.ts",
  language: "ts",           // extrait de l'extension du fichier
  output:   "error[noUnusedVars]: ...",   // tronqué à 500 chars
}
```

### `eventType: "lint_clean"` (compteur mémoire uniquement)

Pas d'event individuel. Un compteur `clean` est incrémenté en mémoire pour chaque fichier qui passe le linter sans erreur. Utilisé comme dénominateur dans le `session_summary`.

```ts
// Dans l'extension :
statsLog.incClean();
```

### `eventType: "session_summary"`

Émis **une seule fois** à la fin de la session (`session_shutdown`).

```ts
details: {
  model:        "deepseek-v4-flash",
  totalChecked: 15,      // errors + clean
  errors:       3,
  clean:        12,
  errorRate:    0.2,     // errors / totalChecked
}
```

Le résumé n'est écrit que si `totalChecked > 0` (sessions sans write/edit — rien).

---

## Logique de logging dans l'extension

```
Quand tool_result (write ou edit) :
  filePath ← event.input.file_path

  try :
    result ← checkFile(filePath)
    si result.success est vrai :
      → statsLog.incClean()        # compteur mémoire
    sinon :
      → statsLog.addLintError(     # event individuel
          filePath, language, result.output
        )
        → return isError avec le output

  catch error :
    → ne rien logger (pas de lint_internal_error)
    → return isError
```

---

## Fichier module interne

**`~/.pi/agent/extensions/post-write-linter-internals/stats-log.ts`**

API :

```ts
interface StatsLogAPI {
  filePath: string;

  // Incrémente le compteur de fichiers propres
  incClean(): void;

  // Log une erreur de lint
  addLintError(entry: {
    ts: string;
    filePath: string;
    language: string;
    output: string;        // tronqué à 500 chars
  }): void;

  // Flush le session_summary à session_shutdown
  flushSummary(event: {
    endTs: string;
    model?: string;
    totalTurns: number;
  }): void;
}
```

Même structure que les autres extensions.

---

## Exemples de lignes dans events.jsonl

### Lint error

```json
{
  "timestamp": "2026-07-04T15:30:00.000Z",
  "eventId": "a1b2c3d4-...",
  "extension": "post-write-linter",
  "eventType": "lint_error",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "abc123-...",
  "cycleId": "def456-...",
  "details": {
    "filePath": "/Users/famillesendrison/Developper/Projects/dotpi/src/foo.ts",
    "language": "ts",
    "output": "error[noUnusedVars]: 'x' is declared but its value is never read"
  }
}
```

### Session summary

```json
{
  "timestamp": "2026-07-04T16:00:00.000Z",
  "eventId": "c3d4e5f6-...",
  "extension": "post-write-linter",
  "eventType": "session_summary",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "abc123-...",
  "cycleId": "ghi789-...",
  "details": {
    "model": "deepseek-v4-flash",
    "totalChecked": 15,
    "errors": 3,
    "clean": 12,
    "errorRate": 0.2
  }
}
```

---

## Notes

- **Pas de `lint_internal_error`** : les erreurs internes du linter (catch) ne sont pas loggées.
- **`output` tronqué à 500 chars** : le output de Biome peut être très long (liste complète des erreurs). 500 chars suffit pour identifier le type d'erreur sans exploser le fichier.
- **`language`** extrait de l'extension du fichier (`".ts"` → `"ts"`, `".js"` → `"js"`, etc.). Utile pour savoir quels types de fichiers produisent le plus d'erreurs.
- **Pas de filtre** : on veut tous les événements.
