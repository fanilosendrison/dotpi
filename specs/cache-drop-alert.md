# cache-drop-alert

- **Date**: 2026-06-28
- **Type**: Extension
- **Status**: Spec (faisable)
- **File**: `~/.pi/agent/extensions/cache-drop-alert.ts`

---

## But

Alerter l'utilisateur quand le cache fournisseur décroche **dans une
situation où l'impact financier est significatif** — c'est-à-dire quand le cache
protégeait une grosse portion du contexte et que sa chute va faire exploser
le coût par tour.

Ne remplace pas la statusbar (qui montre déjà CH% et l'occupation du contexte).
Ajoute une **notification active** que l'utilisateur ne peut pas rater, pour
déclencher une action (compacter, /new).

---

## Où ça tourne

Dans le processus Node/Bun de Pi. État en mémoire, détruit en fin de session.

---

## Mécanisme

L'extension écoute `message_end` (une fois que l'usage du tour est connu).

Elle lit les données depuis `ctx.sessionManager.getEntries()` — les mêmes que
le `FooterComponent` de Pi utilise pour afficher `CH%` et le contexte.

### Données utilisées

Pour chaque message assistant dans la session :

```ts
entry.message.usage.cacheRead   // cache_read_input_tokens
entry.message.usage.input       // input_tokens
entry.message.usage.cacheWrite  // cache_creation_input_tokens
```

Ces données viennent directement de la réponse du fournisseur. Fiables à 100%
(c'est ce qui est facturé).

### Signal calculé

Depuis le **dernier** message assistant (tour courant) :

```ts
const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
const cacheHitRate = usage.cacheRead / promptTokens; // même formule que le footer
```

On combine avec l'occupation du contexte :

```ts
const contextUsage = ctx.getContextUsage();
const contextPercent = contextUsage?.percent ?? 0;
```

### État conservé entre les tours

```ts
{
  lastCacheRead: number;      // cacheRead du tour précédent
  alertActive: boolean;        // pour éviter les notifs en rafale
}
```

### Règles de décision

| Condition | Action |
|-----------|--------|
| Premier tour | Initialiser `lastCacheRead`, rien notifier |
| `lastCacheRead < 20 000` | Pas d'alerte (le cache ne protégeait pas grand-chose, la chute coûte peu) |
| `lastCacheRead >= 20 000` **et** cacheRead actuel < `lastCacheRead * 0.5` (chute > 50%) **et** `contextPercent > 80%` | ⚠️ **Notifier** : le cache protégeait un gros payload en contexte plein, il vient de tomber |
| Cache remonte (`cacheRead >= 20 000` et `alertActive`) | ✅ **Notifier** : le cache est rétabli |
| Sinon | R.A.S. |

### Affichage

Tout passe par `ctx.ui.setStatus("cache", ...)` — **persistant dans la statusbar**,
tant que la condition d'alerte est vraie. Pas de `notify()` éphémère.

Texte quand le cache décroche :

```
⚠️ Cache dropped 50k→2k
```

Quand le cache revient : `setStatus("cache", undefined)` pour effacer.
Pas de notify de rétablissement — l'utilisateur voit le texte disparaître.

---

## Pourquoi ce design

### Pourquoi ne pas juste regarder CH% ?

Parce que `CH%` est un ratio, pas un absolu. Exemple :

- Prompt de 50k tokens, dont 5k en cache → `CH = 10%`. Chute à 0 → perte de 5k tokens, impact faible.
- Prompt de 50k tokens, dont 45k en cache → `CH = 90%`. Chute à 10% → perte de 40k tokens, impact énorme.

Le seuil absolu (`cacheRead >= 20 000`) capture le vrai impact financier,
indépendamment de la taille du prompt.

### Pourquoi exiger `contextPercent > 80%` ?

Parce qu'à 40% de contexte, une chute de cache est gênante mais pas urgente.
À 87%, chaque tour supplémentaire est critique — le cache était le seul rempart.

### Pourquoi la statusbar ?

La statusbar montre déjà CH% et l'occupation contexte, mais de façon **passive**
et **codée** (CH7.1%, 99.9%/1.0M). L'utilisateur doit interpréter.

`setStatus("cache", ...)` ajoute un texte **explicite et actionnable** qui reste
visible tant que le problème persiste. Contrairement à `notify()` qui disparaît
en quelques secondes, le statut reste affiché jusqu'à résolution.

---

## Coût

- Par tour : une itération sur `getEntries()` pour trouver le dernier message
  assistant + comparaisons numériques. Déjà fait par le footer de Pi, coût nul.
- Aucune persistence.
- Aucun appel réseau.
- Zéro impact sur la perf du prompt.

---

## Limites connues

| Limite | Impact |
|--------|--------|
| Le seuil de 20 000 tokens est arbitraire | Peut être ajusté. Un petit projet avec fenêtre de 32k → 20k c'est énorme. Un gros projet avec fenêtre de 200k → 20k c'est modeste. Idéalement paramétrable. |
| Ne détecte pas les chutes progressives (cache qui s'érode tour après tour) | Cas rare en pratique. Le cache fournisseur est généralement binaire : il hit ou il hit pas. |
| `message_end` est émis après que le message est affiché | Le notify arrive légèrement après le rendu du tour. Acceptable. |
| `getContextUsage()` peut retourner `null` si pas encore de réponse LLM | L'extension reste silencieuse, pas de faux positif. |

---

## Références

- **Footer Pi** : `FooterComponent.render()` dans `dist/modes/interactive/components/footer.js`
  — même source de données (`sessionManager.getEntries()`), même calcul de CH%.
- **Claude Code** : `prompt_cache.rs` — fait du completion cache (réutilisation de réponses LLM),
  pas du monitoring turn-to-turn de santé du cache fournisseur. Leur fingerprint ne résout pas
  ce problème (cf. analyse détaillée dans l'historique de cette spec).
- **Statusbar existante** : montre `CH99.9%` et `87%/200k(auto)`. Le watchdog ne remplace
  pas cette information, il la rend **active** via `notify()`.
