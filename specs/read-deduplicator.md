# read-deduplicator

- **Date**: 2026-06-28
- **Type**: Extension
- **Status**: Spec
- **File**: `~/.pi/agent/extensions/read-deduplicator.ts`

---

## But

Intercepter les `read` pour éviter de réinjecter dans le contexte un fichier qui s'y trouve déjà — au complet et à l'identique.

---

## Où ça tourne

Dans le processus Node/Bun de Pi. Une `Map` JavaScript en heap, créée au chargement de l'extension, détruite avec le processus en fin de session.

---

## Mécanisme

La Map stocke pour chaque fichier lu :

```
chemin_fichier (string) → {
  fingerprint: string;      // empreinte du fichier sur disque (mtime + size)
  turn: number;             // tour auquel le fichier a été injecté
  injectedText: string;     // texte exact mis dans le prompt (formaté, avec numéros de ligne)
}
```

### Fingerprint

Porte sur le **fichier entier**, pas sur la portion lue. Stable et comparable entre deux accès :

```ts
const stat = fs.statSync(path);
const fingerprint = `${stat.mtimeMs}:${stat.size}`;
```

Pas besoin de `sha256` — `mtime + size` suffit à détecter une modification entre deux lectures. Deux lectures du même fichier non modifié produisent le même fingerprint, quels que soient les `offset`/`limit` utilisés.

### Règles de décision

À chaque `tool_call` de type `read` :

| Condition | Action |
|-----------|--------|
| Fichier absent de la Map | `read` normal. Stocker `{fingerprint, turn, injectedText}`. |
| Présent, fingerprint identique, `injectedText` **trouvé** dans le prompt courant | Bloquer → répondre `(already in context, turn N)` |
| Présent, fingerprint identique, `injectedText` **non trouvé** dans le prompt courant (tronqué) | `read` normal. Mettre à jour `turn` et `injectedText`. |
| Présent, fingerprint différent (fichier modifié depuis) | `read` normal. Remplacer l'entrée. |

### Vérification de présence

`prompt.includes(injectedText)` — Pi construit le prompt de chaque tour, il a accès au texte complet avant envoi. La string `injectedText` est l'output formaté du tool `read` (inclut numéros de ligne, troncature éventuelle), pas le fichier brut sur disque. Pi sait exactement ce qu'il a mis et sous quelle forme il l'a mis.

---

## Coût

- Par `read` : un `Map.has()`, un `Map.get()`, un `statSync`, un `includes()`. O(1) en pratique.
- Pas de limite au nombre d'entrées trackées (Map JavaScript standard).
- Aucune persistence, aucun fichier cache.
- `statSync` déjà appelé implicitement par `read` — coût quasi nul.

---

## Limites connues

| Limite | Impact |
|--------|--------|
| `includes()` est strict — le moindre écart de formatage break le match | Fichier relu normalement, pas de blocage erroné |
| Lecture en `offset`/`limit` → chaque portion est trackée séparément | Relire le fichier complet après une lecture partielle → miss → relu, acceptable |
| Le gain dépend du fournisseur (Anthropic cache le préfixe du prompt) | Sur Anthropic, bénéfice principal = éviter l'encombrement du contexte, pas l'économie monétaire |
| Fichier modifié entre deux lectures (mtime changé) → fingerprint différent | `read` normal, comportement correct |
