# Spec — read-deduplicator : Blocked-Reads Log

- **Date** : 2026-07-03 (rev. 2026-07-03 : ajout event `read` + refacto compteur)
- **Statut** : Implemented (Migrated to JSONL)
- **Dossier de sortie** : `/Users/famillesendrison/neelopedia/stats/pi/read-deduplicator/`
- **Extension touchée** : `~/.pi/agent/extensions/read-deduplicator.ts`
- **Spec liée** : [`read-deduplicator-per-path-stats.md`](./read-deduplicator-per-path-stats.md) — motivation et impact volume de l'event `read`

---

## But

Logger chaque `read` bloqué par read-deduplicator dans un fichier unifié `events.jsonl`, au format append-only. Le but est d'aligner le format de télémétrie de l'agent Pi sur celui d'Antigravity, permettant à un agent futur (ou un dashboard) de parser ces événements facilement et d'extraire des statistiques unifiées.

---

## Emplacement des logs

`/Users/famillesendrison/neelopedia/stats/pi/read-deduplicator/events.jsonl`

- Un seul fichier unifié `events.jsonl` pour toutes les sessions.
- Append-only.
- Pas de rotation automatique, pas d'archivage automatique inclus par défaut.

### Filtrage des paths sensibles

Pour éviter de logguer des chemins révélant une structure privée, un filtre optionnel est appliqué côté extension avant d'ajouter l'événement :

- Fichier de configuration : `~/neelopedia/stats/pi/read-deduplicator/.pathfilter` (une regex par ligne)
- Le filtre s'applique sur le chemin **normalisé**.
- Si un chemin match une regex → le read est bloqué, mais **pas loggé**.
- Si le fichier n'existe pas → aucun filtrage.

### Origine du Session ID

Le session ID (`sessionId`) est un identifiant unique (UUID v4) généré au démarrage de l'extension pour identifier tous les événements d'une même session de l'agent Pi.

---

## Format du fichier (JSON Lines)

Le log utilise le format **JSONL** (un objet JSON valide par ligne).
Trois types d'événements (`eventType`) sont enregistrés : `"block"`, `"read"` et `"cycle_summary"`.

### 1. Événement de Blocage (`"eventType": "block"`)
Émis à chaque fois qu'un appel `read` est bloqué.

```json
{
  "timestamp": "2026-07-03T12:00:00.000Z",
  "eventId": "b3f6c8d1-1234-5678-abcd-ef0123456789",
  "extension": "read-deduplicator",
  "eventType": "block",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "b3f6c8d1-1234-5678-abcd-ef0123456789",
  "cycleId": "e2f1c8d1-4567-1234-bcde-ef0123456789",
  "details": {
    "path": "/Users/famillesendrison/Developper/Projects/dotpi/src/utils.ts",
    "sizeBytes": 1024,
    "turnIndex": 3
  }
}
```

### 2. Événement de Lecture (`"eventType": "read"`)
Émis à chaque fois qu'un appel `read` est autorisé par le dédup (lecture réussie, contenu capturé dans le tracker). Voir [`read-deduplicator-per-path-stats.md`](./read-deduplicator-per-path-stats.md) pour la motivation.

```json
{
  "timestamp": "2026-07-03T12:00:00.000Z",
  "eventId": "a1b2c3d4-1234-5678-abcd-ef0123456789",
  "extension": "read-deduplicator",
  "eventType": "read",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "b3f6c8d1-1234-5678-abcd-ef0123456789",
  "cycleId": "e2f1c8d1-4567-1234-bcde-ef0123456789",
  "details": {
    "path": "/Users/famillesendrison/Developper/Projects/dotpi/src/utils.ts",
    "sizeBytes": 1024,
    "turnIndex": 3
  }
}
```

### 3. Résumé de Cycle (`"eventType": "cycle_summary"`)
Émis à la fin d'un cycle d'agent (avant l'envoi de la requête au modèle) s'il y a eu des tentatives de lectures.

```json
{
  "timestamp": "2026-07-03T12:05:00.000Z",
  "eventId": "c4d7e9f2-2345-6789-bcde-f01234567890",
  "extension": "read-deduplicator",
  "eventType": "cycle_summary",
  "agent": "pi",
  "workspace": "/Users/famillesendrison/Developper/Projects/dotpi",
  "sessionId": "b3f6c8d1-1234-5678-abcd-ef0123456789",
  "cycleId": "e2f1c8d1-4567-1234-bcde-ef0123456789",
  "details": {
    "startTs": "2026-07-03T12:00:00.000Z",
    "endTs": "2026-07-03T12:05:00.000Z",
    "readsAttempted": 5,
    "blockedCount": 3,
    "totalTurns": 2
  }
}
```

> **Note** : depuis la refacto (2026-07-03), `readsAttempted` est incrémenté par l'extension dans `tool_call(read)` (avant la décision bloquer/autoriser). Le champ représente le **nombre total de tentatives de lecture**, pas seulement les blocks. L'invariant `cycle_summary.readsAttempted == count(read events) + count(block events)` pour le cycle est testable depuis `events.jsonl`.

### Champs communs

| Champ | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO String | Date et heure de l'événement. |
| `eventId` | UUID | Identifiant unique de cet événement. |
| `extension` | String | Toujours `"read-deduplicator"`. |
| `eventType` | String | `"block"` ou `"cycle_summary"`. |
| `agent` | String | L'agent exécutant, toujours `"pi"`. |
| `workspace` | String | Le CWD de l'agent. |
| `sessionId` | UUID | Identifiant unique généré pour la session courante. |
| `cycleId` | UUID | Identifiant unique généré au début de chaque cycle, partagé entre les blocks et le résumé de ce cycle. |
| `details` | Object | Métadonnées spécifiques à l'événement. |

---

## Mécanisme — Append Atomique

Pour éviter la corruption en cas d'écritures concurrentes (deux instances Pi, sync Obsidian), chaque écriture utilise un processus read-modify-write atomique :
- Le fichier `events.jsonl` est lu.
- L'événement JSON stringifié (`+ \n`) est ajouté à la fin.
- Un fichier `.tmp` est écrit puis remplacé de façon atomique via `fs.renameSync()`.

## Log Rotation Policy

### 1. Size-Based Rotation
When `events.jsonl` exceeds **5 MB**, the consumer (stats tool or dashboard generator) must rotate the log:

1. Rename `events.jsonl` → `events-<ISO_DATE>.jsonl` (e.g., `events-2026-07-03.jsonl`).
2. Create a fresh empty `events.jsonl`.
3. Archived log files are stored alongside the active log in `~/neelopedia/stats/pi/read-deduplicator/`.

### 2. Retention
Archived log files are retained indefinitely. Deletion is a manual user decision.

### 3. Rotation Responsibility
Log rotation is **never** performed by the Pi extension (`read-deduplicator.ts`). It is the responsibility of the stats consumer tool (future dashboard or CLI) to check the file size before processing and rotate if necessary.

## Mode dry-run

Une option `dryRun` désactive le blocage effectif : les reads passent normalement mais sont loggés comme s'ils étaient bloqués. Utile pour valider les statistiques.

## Health-check

L'extension expose un compteur dans le status Pi : `ctx.ui.setStatus("rd", \`${bloqués} reads bloqués\`)`. Permet de vérifier que l'extension est active.