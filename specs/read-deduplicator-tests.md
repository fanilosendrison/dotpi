# Spec — read-deduplicator : Tests d'intégration

- **Date** : 2026-06-29
- **Statut** : Draft
- **Fichier de test** : `extensions/read-deduplicator/__tests__/blocked-log.test.ts`
- **Approche** : TDD (tests avant implémentation)

---

Tests organisés en 10 groupes fonctionnels. Pattern : **Given** (état initial) → **When** (action) → **Then** (assertions).

---

## 1. Session et création de fichier

| # | Nom | Scénario |
|---|-----|----------|
| T01 | `creates file with header on session_start` | Given dossier vide. When `startSession(sessionId, cwd)`. Then fichier créé avec header `# Read Deduplicator — Blocked Reads Log`, `> **Format version**: 0.1.0`, `# Session: <id>`, `**Started**`, `**CWD**`. |
| T02 | `creates parent directory if missing` | Given `stats/read-deduplicator/` n'existe pas. When `startSession(...)`. Then dossier créé via `mkdirSync({recursive: true})`, fichier écrit sans erreur. |
| T03 | `names file from session.id` | Given `session.id = "2026-06-29T..."`. When `startSession(...)`. Then nom de fichier = `2026-06-29T...md`. |
| T04 | `names file ephemeral when no session.id` | Given `session.id` absent. When `startSession(...)`. Then nom = `ephemeral-<Date.now()>.md`. |
| T05 | `reuses existing file for same session` | Given fichier `<id>.md` existe avec `# Session: <id>`. When `startSession(<id>)`. Then pas de nouveau header, le fichier est réutilisé en append. |
| T06 | `inserts separator for different session in existing file` | Given fichier `<id>.md` existe avec `# Session: old-id`. When `startSession("new-id")`. Then `---` inséré suivi de `# Session: new-id`. |

## 2. Buffer et flush par cycle

| # | Nom | Scénario |
|---|-----|----------|
| T07 | `appends cycle block on endCycle with blocked reads` | Given session ouverte, 2 `addBlock()` appelés. When `endCycle(startTs, endTs, readsTentés, totalTurns)`. Then bloc `## Cycle N` écrit en fin de fichier avec `**Reads** : X tentés / 2 bloqués` et les 2 lignes de blocage. |
| T08 | `writes nothing on endCycle with zero blocked reads` | Given session ouverte, 0 `addBlock()` appelé (mais des reads tentés). When `endCycle(...)`. Then rien n'est écrit. |
| T09 | `skips cycle number for empty cycles (absolute numbering)` | Given Cycle 1 a 2 blocages. Cycle 2 a 0 blocage. Cycle 3 a 1 blocage. When flush des 3 cycles. Then fichier contient `Cycle 1` et `Cycle 3` (pas de `Cycle 2`). |
| T10 | `flushes automatically at 2000 entries` | Given un cycle avec 2001 blocages. When le 2001ᵉ `addBlock()` est appelé. Then flush automatique déclenché avant `endCycle`, format `## Cycle N` écrit partiellement, buffer vidé et rouvert. |

## 3. Format des lignes de blocage

| # | Nom | Scénario |
|---|-----|----------|
| T11 | `formats line with timestamp, path, sizes, turn` | Given `addBlock({ ts: "17:01:45.123", path: "/abs/path.ts", sizeBytes: 4300, turnIndex: 2 })`. Then ligne = `` `17:01:45.123` `/abs/path.ts` (4.2 KB / 4300 B) — turn 2 ``. |
| T12 | `formats bytes size (no decimal)` | Given `sizeBytes: 430`. Then `(430 B)`. |
| T13 | `formats KB with one decimal` | Given `sizeBytes: 4300`. Then `(4.2 KB / 4300 B)`. |
| T14 | `formats MB with one decimal` | Given `sizeBytes: 1259500`. Then `(1.2 MB / 1259500 B)`. |
| T15 | `formats GB with one decimal` | Given `sizeBytes: 1500000000`. Then `(1.5 GB / 1500000000 B)`. |
| T16 | `uses base-10 (1 KB = 1000 B)` | Given `sizeBytes: 1000`. Then `(1.0 KB / 1000 B)`, pas `(1000 B)`. |
| T17 | `pluralizes correctly` | Given 1 turn → `(1 turn)` ; 3 turns → `(3 turns)`. |
| T18 | `escapes backticks in path` | Given path contient `` ` ``. Then backtick échappé en `` \` `` dans la ligne. |

## 4. Normalisation des chemins

| # | Nom | Scénario |
|---|-----|----------|
| T19 | `resolves relative path to absolute` | Given cwd = `/Users/foo/dotpi`, rawPath = `./src/bar.ts`. When `addBlock({ path: "./src/bar.ts" })`. Then chemin loggé = `/Users/foo/dotpi/src/bar.ts`. |
| T20 | `resolves symlinks` | Given `/tmp/link → /Users/foo/real.ts`. When `addBlock({ path: "/tmp/link" })`. Then chemin loggé = `/Users/foo/real.ts`. |
| T21 | `skips block on realpathSync failure` | Given fichier supprimé entre tool_call et normalisation. When `addBlock(...)` avec `realpathSync` qui throw. Then le read n'est ni bloqué ni loggé (exception silencieuse). |

## 5. Filtrage des paths sensibles

| # | Nom | Scénario |
|---|-----|----------|
| T22 | `filters out matching path from log but still blocks read` | Given `.pathfilter` contient `/Documents/privé/`. When `addBlock({ path: "/Users/f/Documents/privé/x.ts" })`. Then `addBlock` retourne `{ blocked: true, logged: false }`. Le read est bloqué mais rien n'est loggé. |
| T23 | `filters on normalized path, not raw path` | Given `.pathfilter` = `/Users/f/Documents/privé/`. When `addBlock({ path: "./../Documents/privé/x.ts" })`. Then normalisé → `/Users/f/Documents/privé/x.ts` → match → pas loggé. |
| T24 | `does not filter when .pathfilter file absent` | Given pas de `.pathfilter`. When `addBlock({...})`. Then read bloqué ET loggé normalement. |
| T25 | `reloads .pathfilter on each session_start only` | Given `.pathfilter` modifié pendant la session. When 2ᵉ `addBlock`. Then l'ancien filtre est toujours utilisé (pas de re-lecture). |

## 6. Écriture concurrente et atomique

| # | Nom | Scénario |
|---|-----|----------|
| T26 | `uses read-modify-write on flush` | Given fichier avec Cycle 1. When `endCycle` pour Cycle 2. Then contenu final = Cycle 1 + Cycle 2 (pas d'écrasement). |
| T27 | `writes via temp file + rename` | Given buffer non vide. When `flush()`. Then un fichier `<id>.md.tmp.<pid>` est créé puis renommé, pas d'écriture directe sur le fichier final. |
| T28 | `survives rename failure gracefully` | Given `renameSync` throw (permissions). When `flush()`. Then erreur loggée sur stderr, extension continue, reads toujours bloqués. |

## 7. Robustesse et erreurs

| # | Nom | Scénario |
|---|-----|----------|
| T29 | `addBlock exception caught, cycle lost, reads still blocked` | Given `addBlock` throw (bug formateur). When appelé. Then exception catchée, stderr, le read reste bloqué, le buffer de cycle est perdu. |
| T30 | `flush exception caught, extension continues` | Given `flush` throw au milieu du cycle. When `endCycle`. Then exception catchée, stderr, les reads du cycle sont perdus mais l'extension continue. |
| T31 | `disk full → flush fails silently, reads still blocked` | Given disque plein. When `flush()`. Then pas de crash, pas de log écrit, les reads restent bloqués. |
| T32 | `mid-cycle crash loses only current cycle` | Given Cycle 1 flushé, Cycle 2 en buffer. When crash avant `agent_end`. Then fichier contient Cycle 1 intact, Cycle 2 absent. |

## 8. Mode dry-run

| # | Nom | Scénario |
|---|-----|----------|
| T33 | `dry-run mode lets reads pass but logs them` | Given `RD_DRY_RUN=true`. When read bloqué normalement. Then read **passe à travers** (non bloqué) mais est **loggé** comme s'il était bloqué. |
| T34 | `dry-run off blocks reads normally` | Given `RD_DRY_RUN` non défini. When read déjà lu. Then read **bloqué** et loggé. |

## 9. Intégration avec les events Pi

| # | Nom | Scénario |
|---|-----|----------|
| T35 | `agent_start opens cycle with timestamp` | Given session ouverte. When `agent_start` event. Then buffer initialisé, cycleStartTs capturé. |
| T36 | `turn_start stores turnIndex` | Given `turn_start` avec `event.turnIndex = 3`. When émis. Then `currentTurnIndex = 3`. |
| T37 | `tool_call(read) blocks already-seen file` | Given fichier `/foo.ts` déjà lu. When `tool_call(read, { path: "/foo.ts" })`. Then retourne `{ block: true }`, `addBlock` appelé avec `turnIndex` courant. |
| T38 | `tool_call(read) allows new file` | Given fichier `/bar.ts` jamais lu. When `tool_call(read, { path: "/bar.ts" })`. Then pas de blocage, pas de log. |
| T39 | `tool_call(read) allows when read-tracker says file changed` | Given fichier `/foo.ts` déjà lu mais modifié depuis. When `tool_call(read)`. Then pas de blocage, pas de log. |
| T40 | `agent_end flushes buffer with duration` | Given cycle avec 3 blocages. When `agent_end`. Then `flush()` appelé, `## Cycle N — start → end (M turns)` écrit. |

## 10. Health-check

| # | Nom | Scénario |
|---|-----|----------|
| T41 | `updates status on each blocked read` | Given 5 reads bloqués dans la session. When le 5ᵉ bloque. Then `ctx.ui.setStatus("rd", "5 reads bloqués")` appelé. |

---

**Total : 41 tests**, 10 groupes.

Ordre d'implémentation TDD recommandé : 3 → 4 → 1 → 2 → 5 → 7 → 6 → 8 → 10 → 9
(unitaires purs → intégration fichiers → robustesse → concurrence → events Pi).
