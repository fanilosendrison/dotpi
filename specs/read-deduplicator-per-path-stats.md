# Spec — read-deduplicator : Per-Path Read Metrics

- **Date** : 2026-07-03
- **Statut** : Draft (décisions validées)
- **Extension touchée** : `~/.pi/agent/extensions/read-deduplicator.ts`
- **Internals touchés** : `read-deduplicator-internals/blocked-log.ts`
- **Specs liées** :
  - [`read-deduplicator.md`](./read-deduplicator.md) — mécanisme de dédup
  - [`read-deduplicator-blocked-log.md`](./read-deduplicator-blocked-log.md) — format `events.jsonl`, rotation, path filter, dry-run
  - [`read-deduplicator-tests.md`](./read-deduplicator-tests.md) — suite TDD existante (à compléter)

---

## Décisions

| # | Sujet | Décision | Justification |
|---|---|---|---|
| 1 | Compteur `cycleReadsAttempted` | **Refacto (a)** : incrément dans `tool_call` de l'extension, avant la décision bloquer/autoriser | Single source of truth, `BlockedLogAPI` reste pure télémétrie |
| 2 | Granularité des `read` events | **Individuel** (1 event par read, comme `block`) | YAGNI — volume acceptable (~144 KB/session), symétrie avec `block`, évolutif (peut ajouter du batching plus tard sans migration) |
| 3 | Path filter sur `read` | **Skip le log** si path matche `.pathfilter` (symétrique avec `block`) | Respecte l'intention utilisateur (pas de trace du path dans la télémétrie), cohérent avec `block` |

---

## But

Compléter la télémétrie de `read-deduplicator` pour permettre des statistiques **par fichier** et non plus seulement par cycle.

Aujourd'hui (`read-deduplicator-blocked-log.md`) :

| Champ `path` apparaît dans | Résultat |
|---|---|
| `block` events | ✅ oui |
| `cycle_summary` events | ❌ non (compteurs agrégés uniquement) |

Conséquence : on peut compter combien de doublons ont été bloqués par fichier, mais **pas** combien de reads ont réussi par fichier. Sans cette donnée, plusieurs questions restent sans réponse :

| Question | Réalisable aujourd'hui |
|---|---|
| Quel est le **taux de dédup par fichier** (`blocks / (reads + blocks)`) ? | ❌ |
| Quels sont les **fichiers les plus relus** dans une session / workspace ? | ❌ |
| Combien de **lectures réussies** par fichier / par cycle ? | ❌ |
| Quelle est la distribution des reads par **taille** de fichier ? | ❌ |
| Quelle est la **fréquence de relecture** par fichier (combien de versions distinctes relues) ? | ❌ |

Cette spec ajoute un troisième type d'événement — `"read"` — émis pour chaque lecture réussie (autorisée par le dédup), afin de rendre toutes ces questions calculables depuis `events.jsonl` sans avoir à re-parser les `tool_call` depuis les logs de session Pi.

---

## Solution

### Nouveau type d'événement : `"eventType": "read"`

Émis pour **chaque `read` autorisé** par le dédup (lecture réussie, contenu capturé dans le tracker).

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

### Champs de `details`

| Champ | Type | Description |
|---|---|---|
| `path` | string | Chemin **normalisé** (`realpathSync` résolu, cf. `path-normalize.ts`). `null` ou absent si normalisation échoue. |
| `sizeBytes` | number | Taille du fichier au moment du read (`fs.statSync().size`). |
| `turnIndex` | number | Tour Pi (`currentTurn`) dans lequel le read a été émis. |

### Symétrie avec `block`

| Aspect | `block` | `read` |
|---|---|---|
| Émis dans | `tool_call` (décision de bloquer) | `tool_result` (capture du contenu) |
| Champs `details` | `path`, `sizeBytes`, `turnIndex` | identique |
| Filtre `.pathfilter` | oui (skip log, block effectif) | oui (skip log, **autorisation normale**) |
| Dry-run | `block` loggé, read autorisé | `read` loggé normalement, le comportement normal continue |
| `atomicAppend` | oui | oui |

---

## Mécanisme

### Côté `read-deduplicator-internals/blocked-log.ts`

Ajouter une méthode `addRead` à `BlockedLogAPI`, miroir de `addBlock` :

```ts
addRead(entry: {
  ts: string;
  path: string;
  sizeBytes: number;
  turnIndex: number;
}): AddBlockResult;
```

Comportement :

1. Normaliser le chemin via `normalizePath(path, cwd)`.
2. Si la normalisation échoue → retourner `{ blocked: false, logged: false }` (read pas loggé, extension continue).
3. Si le chemin matche `.pathfilter` → retourner `{ blocked: false, logged: false }` (read pas loggé, autorisation normale).
4. Sinon → `appendEvent("read", { path, sizeBytes, turnIndex }, ts)`.
5. Retourner `{ blocked: false, logged: true }`.

> **Note** : `addRead` ne touche pas `cycleReadsAttempted` (cf. décision #1). Le compteur est incrémenté par l'extension dans `tool_call`, et passé à `endCycle` comme valeur de référence. `addRead` et `addBlock` sont de la pure télémétrie.

> ✅ **Décision retenue : option (a)** — voir tableau "Décisions" en tête de spec. `cycleReadsAttempted` est incrémenté dans `tool_call` de l'extension. `addRead` et `addBlock` ne touchent plus au compteur.

### Côté `~/.pi/agent/extensions/read-deduplicator.ts`

Deux modifications :

**1. Dans `tool_call(read)`** — incrémenter `cycleReadsAttempted` à chaque tentative de read (avant la décision bloquer/autoriser), conformément à la décision #1 :

```ts
pi.on("tool_call", async (event) => {
  if (!isToolCallEventType("read", event)) return;
  // ... extraction du path ...
  cycleReadsAttempted++;  // ← NOUVEAU — compté AVANT la décision
  // ... suite du code existant (stat, fingerprint, decision) ...
});
```

**2. Dans `tool_result(read)`** — après la capture du `textContent` et après `tracker.track()`, ajouter l'appel à `addRead` :

```ts
pi.on("tool_result", async (event) => {
  if (!isReadToolResult(event)) return;
  // ... code existant qui calcule path, fingerprint, textContent, tracker.track() ...

  // NOUVEAU — après tracker.track()
  blockedLog.addRead({
    ts: new Date().toISOString(),
    path,
    sizeBytes: stat.size,
    turnIndex: currentTurn,
  });
});
```

L'ordre est important :
1. `tracker.track()` met à jour le tracker (pour les dédup futures).
2. `addRead()` log l'événement dans `events.jsonl`.

### Pourquoi `tool_result` et pas `tool_call`

Trois raisons :

1. **Cohérence avec `addBlock`** : `addBlock` est émis dans `tool_call` parce que la décision de bloquer est prise avant l'exécution du read. `addRead` ne peut être émis qu'**après** confirmation que le read a réussi (sinon on logge des reads fantômes pour des fichiers inexistants / non lisibles).
2. **Données stables** : la taille du fichier peut changer entre `tool_call` et `tool_result` (modification concurrente). Le `statSync` dans `tool_result` capture la taille réelle au moment où le contenu a été injecté.
3. **Évite le bruit** : un read qui échoue (ENOENT, EACCES, fichier supprimé entre temps) ne produit pas de `tool_result` avec contenu — donc pas de `read` event. Exactement ce qu'on veut.

---

## Stats rendues possibles

Une fois implémenté, les consumers de `events.jsonl` peuvent calculer :

| Métrique | Formule |
|---|---|
| Reads par fichier | `count(events where eventType="read" and details.path=P)` |
| Blocks par fichier | `count(events where eventType="block" and details.path=P)` |
| Taux de dédup par fichier | `blocks / (reads + blocks)` |
| Top N fichiers les plus relus | `groupBy(path) → count where eventType="read" → top(N)` |
| Distribution reads par taille | `bucket(sizeBytes) → count where eventType="read"` |
| Fréquence de relecture par fichier | `count(distinct cycleId where eventType="read" and path=P)` |
| Reads par cycle | `count(events where eventType="read" and cycleId=C)` |
| Cohérence `cycle_summary.readsAttempted` vs somme réelle | `sum(reads + blocks where cycleId=C) == cycle_summary.readsAttempted` |

Cette dernière ligne permet aussi un **test d'intégrité** automatique (T-NN ci-dessous).

---

## Impact volume & performance

### Volume `events.jsonl`

Aujourd'hui (session typique 200 reads, 22 % de blocs) :
- 200 reads → 44 blocks + 44 cycle_summaries ≈ 88 events
- ~500 B par event → **~44 KB / session**

Avec cette spec :
- 200 reads → 200 reads + 44 blocks + 44 cycle_summaries ≈ 288 events
- **~144 KB / session** (×3.3)

### Rotation à 5 MB

- Aujourd'hui : ~115 sessions avant rotation (à 44 KB chacune).
- Avec la spec : ~35 sessions avant rotation.

C'est **acceptable** mais à surveiller. Deux options si ça devient gênant :
- Augmenter le seuil de rotation (passer à 10 MB ou 20 MB).
- Compresser/agréger les `read` events par cycle (1 `cycle_reads` event avec array de paths).

→ **Décision à prendre** : pour cette spec, on ne change pas la rotation policy (5 MB), on l'observe en pratique après implémentation. Si la rotation devient trop fréquente, on enchaîne avec une spec de batching.

### Coût runtime

- Par read : 1 `statSync` (déjà fait aujourd'hui dans `tool_result`) + 1 `atomicAppend` (nouveau).
- `atomicAppend` ≈ read-file + append + write-tmp + rename ≈ 1-3 ms sur SSD.
- Sur une session de 200 reads : **+200-600 ms total** étalés sur la durée de la session. Imperceptible.

---

## Comportement en dry-run

Le mode `dryRun` (cf. `read-deduplicator-blocked-log.md`) :

| Mode | `block` event | `read` event |
|---|---|---|
| `dryRun=false` (normal) | émis quand bloqué | émis quand autorisé |
| `dryRun=true` | émis quand bloqué *virtuellement* (read autorisé malgré le match) | émis normalement (le read est autorisé dans tous les cas en dry-run) |

Pas de changement de comportement : `dryRun` continue d'affecter uniquement les `block`.

---

## Compatibilité

### Consommateurs existants

- Tout consumer qui ne lit que `block` et `cycle_summary` continue de fonctionner (events additionnels, pas de breaking change).
- Le format de `cycle_summary` ne change pas.

### Forward-compat

- On garde `path` dans `details` comme **string unique** (pas de hash, pas de structure imbriquée) pour rester compatible avec le format actuel de `block`.
- Pas de versioning du format (le format actuel est `0.1.0`, pas de bump prévu pour cette feature).

---

## Tests à ajouter (extension de `read-deduplicator-tests.md`)

À insérer dans la suite TDD existante, en TDD avant l'implémentation.

### Groupe 11 — `addRead` (nouveau)

| # | Nom | Scénario |
|---|---|---|
| T42 | `addRead appends a "read" event with path, sizeBytes, turnIndex` | Given session ouverte. When `addRead({ ts, path, sizeBytes: 1024, turnIndex: 3 })`. Then `events.jsonl` contient une ligne avec `eventType: "read"`, `details.path` = path normalisé, `details.sizeBytes: 1024`, `details.turnIndex: 3`. |
| T43 | `addRead does NOT increment cycleReadsAttempted` (compteur géré par l'extension) | Given `cycleReadsAttempted = 0` (variable interne du `blocked-log` réinitialisée). When `addRead(...)`. Then `cycleReadsAttempted` interne reste `0` après l'appel. Le compteur réel vient de l'extension. |
| T44 | `addRead handles empty textContent gracefully` | Given `tool_result` avec `textContent` vide. When le handler appelle `addRead`. Then rien n'est loggé (skip comme le `tracker.track` actuel). |
| T45 | `addRead skips log when path is filtered` | Given `.pathfilter` contient `/secret/`. When `addRead({ path: "/secret/x.ts" })`. Then événement **non** loggé dans `events.jsonl`. |
| T46 | `addRead skips log when path normalization fails` | Given path inexistant. When `addRead(...)`. Then `{ logged: false }`, événement non loggé. |

### Groupe 11b — Compteur `cycleReadsAttempted` géré par l'extension (nouveau)

| # | Nom | Scénario |
|---|---|---|
| T47 | `tool_call(read) increments cycleReadsAttempted before block decision` | Given `cycleReadsAttempted = 0`. When `tool_call(read, { path: "/new.ts" })` (premier read). Then `cycleReadsAttempted == 1`, read autorisé. |
| T48 | `tool_call(read) increments cycleReadsAttempted even when blocked` | Given `cycleReadsAttempted = 0`. When `tool_call(read, { path: "/already-read.ts" })` (déjà lu, doit être bloqué). Then `cycleReadsAttempted == 1`, read bloqué, compteur quand même incrémenté. |
| T49 | `cycle_summary.readsAttempted == sum(read + block events) for that cycle` | Given 1 cycle avec 5 reads (3 succès → 3 read events, 2 blocks → 2 block events). When consumer parse. Then `cycle_summary.readsAttempted == 5 == 3 + 2`. |

### Groupe 12 — Intégrité cycle_summary (nouveau)

| # | Nom | Scénario |
|---|---|---|
| T50 | `addRead is emitted in tool_result, not tool_call` | Given read autorisé. When observer Pi. Then `tool_call(read)` → pas de `read` event ; `tool_result(read)` → `read` event présent dans `events.jsonl`. |
| T51 | `addRead is NOT emitted when read fails (no tool_result with content)` | Given `read` d'un fichier inexistant. When observer. Then ni `read` event ni `block` event dans `events.jsonl` (le dédup n'a même pas logué). |

### Tests existants à mettre à jour

- **T09** (`skips cycle number for empty cycles`) : avec `addRead`, un cycle peut maintenant avoir `readsAttempted > 0` sans avoir aucun `block` → cycle_summary **doit** être émis quand même. Vérifier que `endCycle` continue d'émettre `cycle_summary` quand `meta.readsAttempted > 0`, même si `cycleBlockedCount == 0`. Le comportement reste valide après refacto (option (a)) puisque le compteur reflète maintenant la vraie somme.
- **T33** (`dry-run mode lets reads pass but logs them`) : doit aussi vérifier qu'un `read` autorisé en dry-run **est** loggé comme un `read` normal (et qu'un read qui aurait été bloqué est loggé comme `block` malgré le dry-run).
- **T37 → T48** (renommage) : l'ancien test "tool_call(read) blocks already-seen file" doit aussi vérifier que `cycleReadsAttempted` est incrémenté **avant** la décision de blocage (cf. décision #1).

---

## Ordre d'implémentation recommandé

1. ✅ **Specs first** (cette spec → relue et validée par l'utilisateur avec les 3 décisions).
2. **TDD — Groupe 11b d'abord** (T47, T48, T49) : tests sur le refacto du compteur avant de toucher au code.
3. **Refacto `cycleReadsAttempted`** dans `read-deduplicator.ts` : déplacer l'incrément dans `tool_call` (avant la décision). Tests T47/T48 doivent passer ; l'ancien T37 doit être adapté.
4. **TDD — Groupe 11** (T42 → T46) : tests unitaires sur `addRead` avant l'implémentation.
5. **Implémentation `addRead`** dans `blocked-log.ts` → tests T42, T45, T46 doivent passer.
6. **Wiring dans `read-deduplicator.ts`** (appel `addRead` dans `tool_result`) → tests T50, T51 doivent passer.
7. **Test d'intégrité** T49 → valider sur une session réelle (skill-arena ou session de prod).
8. **Mise à jour de `read-deduplicator-blocked-log.md`** : ajouter le type `"read"` à la table des eventTypes + champ `path`/`sizeBytes`/`turnIndex` à la table des champs de `details`.
9. **Mise à jour de `read-deduplicator-tests.md`** : insérer les tests T42–T51 dans la suite (et adapter T09, T33, T37).

---

## Limites connues

| Limite | Impact |
|---|---|
| Volume `events.jsonl` ×3.3 | Rotation 5 MB atteinte plus souvent (~35 sessions vs ~115). Acceptable. |
| `addRead` n'est pas rétroactif | Les sessions passées n'auront pas les events `read`. Le consumer doit gérer les deux cas (avec/sans `read`). |
| Pas de batching | Chaque read fait un `atomicAppend` individuel. Pour 200 reads/session → ~200 syscalls. Acceptable, à optimiser seulement si bottleneck observé. |
| Le compteur `cycleReadsAttempted` change de sémantique | Avant : nombre de blocks (incrémenté dans `addBlock`). Après : nombre total de tentatives (incrémenté dans `tool_call` de l'extension). Le champ reste nommé pareil pour ne pas casser la compat — à documenter dans la mise à jour de `read-deduplicator-blocked-log.md`. |
| Path filtering s'applique aussi aux reads | Un fichier filtré ne log plus ni `read` ni `block`. Cohérent avec le design actuel, mais à expliciter dans la doc. |

---

## Références

- [`read-deduplicator.md`](./read-deduplicator.md) — mécanisme de dédup, fingerprint, règles de décision.
- [`read-deduplicator-blocked-log.md`](./read-deduplicator-blocked-log.md) — format `events.jsonl`, atomic writer, rotation policy, path filter, dry-run.
- [`read-deduplicator-tests.md`](./read-deduplicator-tests.md) — suite TDD existante (41 tests), à compléter avec T42–T50.
- `extensions/read-deduplicator-internals/blocked-log.ts` — `BlockedLogAPI`, à étendre avec `addRead`.
- `extensions/read-deduplicator-internals/path-normalize.ts` — `normalizePath`, `matchesFilter`, déjà utilisés par `addBlock`.
- `extensions/read-deduplicator-internals/atomic-writer.ts` — `atomicAppend`, à réutiliser tel quel.