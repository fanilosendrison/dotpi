# Spec — command-validator : Stats Logging

- **Date** : 2026-07-04
- **Statut** : Spécification (pas encore implémenté)
- **Dossier de sortie** : `/Users/famillesendrison/neelopedia/stats/pi/command-validator/`
- **Extension touchée** : `~/.pi/agent/extensions/command-validator.ts`
- **Module interne à créer** : `~/.pi/agent/extensions/command-validator-internals/stats-log.ts`
- **Core partagé** : `~/.agents/agent-enforcers/command-validator/src/core/validator.ts` — **pas touché**

---

## But

Logger chaque intervention de command-validator (deny, ask_confirm) dans un fichier `events.jsonl` append-only, afin de pouvoir calculer :

- **Nombre de blocages** par session, par model, par sévérité
- **Ratio** `denied / total_commands` (taux de blocage)
- **Taux de confirmation utilisateur** (combien de `ask_confirm` sont acceptés vs refusés)

Le tout sans modifier d'un iota le core partagé dans `.agents/`.

---

## Emplacement des logs

```
/Users/famillesendrison/neelopedia/stats/pi/command-validator/events.jsonl
```

Même pattern que read-deduplicator et path-guard : un seul fichier partagé entre toutes les sessions Pi, `atomicAppend` pour la cohérence.

---

## Architecture — Où se fait le logging

Le core partagé (`validator.ts`) reste **pur** — pas d'effet de bord.

C'est **l'extension Pi** qui inspecte le résultat du `validator.validate()` et des patterns destructeurs, puis décide de logger.

---

## Événements loggés

### Champs communs

Identiques à path-guard et read-deduplicator :

| Champ | Type | Description |
|---|---|---|
| `timestamp` | ISO-8601 UTC | `new Date().toISOString()` |
| `eventId` | UUID v4 | `crypto.randomUUID()` |
| `extension` | String | `"command-validator"` |
| `eventType` | String | `"deny"`, `"ask_confirm"`, ou `"session_summary"` |
| `agent` | String | `"pi"` |
| `workspace` | String | CWD de la session Pi |
| `sessionId` | UUID | Généré au chargement de l'extension, constant pour la session |
| `cycleId` | UUID | Renouvelé à chaque cycle |
| `details` | Object | Dépend de `eventType` |

### `eventType: "deny"`

Émis quand une commande est **bloquée automatiquement** (shared validator + destructive patterns).

Ne pas logger les `allow` silencieux (commandes qui passent sans incident) — trop de bruit pour 0 info utile. Seul le `session_summary` comptera le total de commandes passées.

```ts
details: {
  severity:   "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  violations: ["rm -rf is forbidden", "Destructive pattern"],
  command:    "rm -rf /foo",       // tronqué à 200 chars
}
```

### `eventType: "ask_confirm"`

Émis quand l'utilisateur a dû confirmer une commande (tool dangereux comme sudo, chmod, kill, ou `result.action === "ask"`).

```ts
details: {
  tool:       "sudo" | "chmod" | "chown" | "kill" | …,
  severity:   "HIGH",
  outcome:    "allowed" | "denied",
  command:    "sudo rm -rf /foo",  // tronqué à 200 chars
}
```

Un seul event par confirmation, pas deux (pas de `deny` en plus si l'utilisateur refuse).

### `eventType: "session_summary"`

Émis **une seule fois** à la fin de la session (`session_shutdown`). Contient les compteurs cumulés et les ratios.

```ts
details: {
  model:          "deepseek-v4-flash",
  totalCommands:  42,             // toutes les commandes bash passées dans le validator
  denied:         3,
  asked:          5,              // confirmations demandées
  userDenied:     1,              // confirmations refusées par l'utilisateur
  userAllowed:    4,              // confirmations acceptées
  denyRate:       0.07,           // denied / totalCommands
  confirmRate:    0.80,           // userAllowed / asked (taux d'acceptation)
}
```

---

## Logique de logging dans l'extension

```
Quand tool_call (bash) :
  cmd ← event.input.command

  # 1. chmod +x → skip (toujours autorisé)
  si /^chmod \+x/ → return

  # 2. Shared validator
  result ← validator.validate(cmd)
  si result.action === "deny" :
    → statsLog.addDeny(severity: result.severity, violations: result.violations, command: cmd)
    → block

  # 3. Destructive patterns locaux
  si match DESTRUCTIVE_PATTERNS :
    → statsLog.addDeny(severity: "CRITICAL", violations: ["Destructive pattern"], command: cmd)
    → block

  # 4. Ask confirmation
  si result.action === "ask" OU dangerous tool (sudo, chmod…) :
    outcome ← ctx.ui.confirm(...)
    → statsLog.addAskConfirm(tool, severity, outcome, command)
    si outcome === "denied" → block

  # (ne rien logger si la commande passe sans incident)
```

### Incrément du total

Le `totalCommands` du `session_summary` est le nombre total de commandes bash qui sont passées par le validator (y compris les `chmod +x`, et les confirms autorisées). On l'incrémente au début du handler, avant toute décision.

```ts
statsLog.incTotal();  // chaque commande bash
```

---

## Fichier module interne

**`~/.pi/agent/extensions/command-validator-internals/stats-log.ts`**

API :

```ts
interface StatsLogAPI {
  filePath: string;

  // Incrémente le compteur de total (toutes les commandes bash)
  incTotal(): void;

  // Commande bloquée automatiquement
  addDeny(entry: {
    ts: string;
    severity: string;
    violations: string[];
    command: string;        // tronqué à 200 chars
  }): void;

  // Confirmation demandée à l'utilisateur
  addAskConfirm(entry: {
    ts: string;
    tool: string;
    severity: string;
    outcome: "allowed" | "denied";
    command: string;        // tronqué à 200 chars
  }): void;

  // Flush le session_summary à session_shutdown
  flushSummary(event: {
    endTs: string;
    model?: string;
    totalTurns: number;
  }): void;
}
```

Même structure que `path-guard-internals/stats-log.ts` : compteurs mémoire, `atomicAppend`, reset après flush.

---

## Exemples de lignes dans events.jsonl

### Deny

```json
{
  "timestamp": "2026-07-04T15:30:00.000Z",
  "eventId": "a1b2c3d4-...",
  "extension": "command-validator",
  "eventType": "deny",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "abc123-...",
  "cycleId": "def456-...",
  "details": {
    "severity": "CRITICAL",
    "violations": ["rm -rf is forbidden"],
    "command": "rm -rf /some/dir"
  }
}
```

### Ask confirm

```json
{
  "timestamp": "2026-07-04T15:31:00.000Z",
  "eventId": "b2c3d4e5-...",
  "extension": "command-validator",
  "eventType": "ask_confirm",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "abc123-...",
  "cycleId": "def456-...",
  "details": {
    "tool": "sudo",
    "severity": "HIGH",
    "outcome": "allowed",
    "command": "sudo apt update"
  }
}
```

### Session summary

```json
{
  "timestamp": "2026-07-04T16:00:00.000Z",
  "eventId": "c3d4e5f6-...",
  "extension": "command-validator",
  "eventType": "session_summary",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "abc123-...",
  "cycleId": "ghi789-...",
  "details": {
    "model": "deepseek-v4-flash",
    "totalCommands": 42,
    "denied": 3,
    "asked": 5,
    "userDenied": 1,
    "userAllowed": 4,
    "denyRate": 0.07,
    "confirmRate": 0.80
  }
}
```

---

## Capturer le model

Même mécanisme que path-guard : hook `before_provider_request` pour capturer `event.payload.model`.

---

## Migration depuis le logging existant

L'extension a déjà un logging basique avec `appendFile`. Le nouveau format change le schema (ajout des champs communs, eventType, etc.). On peut soit :

1. **Supprimer** l'ancien `events.jsonl` et repartir de zéro (simple)
2. **Concaténer** les anciennes lignes dans le nouveau fichier (mais elles n'ont pas les champs requis — pas compatible)

**Recommandé** : option 1 — `: > events.jsonl` avant le reload. Les anciennes données (s'il y en a) sont dans un format incompatible de toute façon.

---

## Pas de .pathfilter

Comme path-guard, on veut tous les événements — en exclure un fausserait les ratios. Pas de filtre.

---

## Pas de health-check status bar

Le volume est trop faible et les commandes bloquées sont déjà visibles via le `{ block: true }` retourné par l'extension.

---

## Pas de log rotation

Même règle que read-deduplicator et path-guard : la rotation n'est jamais faite par l'extension. C'est le consommateur (dashboard/CLI) qui s'en charge si le fichier dépasse 5 MB.

---

## Points ouverts

1. **`totalCommands`** : incrémenté au début du handler bash, avant toute décision. Ça inclut les `chmod +x` et les commandes qui passent sans incident. C'est le dénominateur pour le `denyRate`.

2. **`DESTRUCTIVE_PATTERNS`** : ils sont définis dans l'extension, pas dans le core. Pas besoin de les distinguer dans les logs — la violation "Destructive pattern" suffit.

3. **`command` tronqué** : 200 chars, comme path-guard. Suffisant pour identifier la commande sans exploser la taille du fichier.
