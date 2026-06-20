# MINI-RFC — le lint (`flatc --check`) doit connaître les `params` d'un symbole dans ses `expr`

> **Pour l'agent qui implémente dans flatkit.** Petite RFC : un **faux positif du linter**, cause localisée à
> un seul endroit. Intention + repro + cause + résultat voulu + garde-fous. Le correctif est mécanique, mais
> respecte le **scoping** (§4.1).

---

## 1. L'intention / le symptôme

Un symbole `.flat` peut exposer des `params` (color/number/bool) et les **lire dans une `expr`** — c'est
supporté au RUNTIME (le param est injecté dans le scope de l'instance) et compilé sans souci par
`flatc --preview`. Exemple réel (FlatInk-EDU) : `papillon-libre.flat` fige son battement via
`expr scaleX "… * (1 - stationnaire)"`, `bateau.flat` calme le roulis via `expr rotation "… * roulis"`,
`niveau-eau-sas.flat` via `niveau`, etc. **Ça marche** (vérifié au vrai player : `setParam(stationnaire=1)`
fige, MAD 0.00).

MAIS `flatc --check` (le lint sémantique) **rejette** ces mêmes `expr` :
```
[Bateau] 2:7: error: unknown variable "roulis" — declare it with "let"
[PapillonLibre] 2:7: error: unknown variable "stationnaire" — declare it with "let"
```
→ le linter ne sait pas que les `params` d'un symbole sont des variables valides dans ses `expr`. C'est un
**faux positif** : le runtime ET `--preview` les résolvent ; seul le lint est désynchronisé. Inoffensif
aujourd'hui pour EDU (les assets passent par `--preview`/`--play`, jamais `--check`), mais c'est un papercut
pour quiconque lint un asset, et ça mine la confiance dans le « generate → lint → fix ».

## 2. Reproduction

Sur les assets réels (déjà en place) : `flatc <repo>/assets/animated/papillon-libre.flat --check` crache
`unknown variable "stationnaire"/"roulis"/…` pour tout symbole qui lit un de ses params dans une `expr`, alors
que le même fichier passe `--preview` et s'anime correctement au player.

Au niveau API (le chemin exact) — un Doc avec un symbole dont une `expr` lit son param :
```
symbol "S" {
  timeline 24 24
  params { number k = 1 }
  layer "c" {
    group "g" at 0,0 pivot 0,0  expr scaleX "k"  { layer "c" { circle 0 0 10 fill #fff } }
  }
}
```
`lintDocReport(parsedDoc)` renvoie aujourd'hui `[S] …: error: unknown variable "k"`. Attendu après fix : `''`.

## 3. La cause (localisée — un seul endroit)

`packages/compiler/src/programDoc.ts` — `lintDoc()` lint **chaque scope** (scène + chaque symbole, via
`scopes(doc)`), et construit le contexte par `docLintContext(doc, editPath, allVars)` (≈ L45-53) :
```ts
return {
  variables: [...Object.keys(doc.variables ?? {}), ...(extraVars ?? [])],  // ← globales scène + vars des autres scopes
  labels: …,
  functions: …,
  objects: objectNames(contextLayers(doc, editPath)),
}
```
**`variables` n'inclut JAMAIS les `params` du symbole du scope courant.** Puis `lint()`
(`packages/compiler/src/lint.ts`) bâtit `knownIds = new Set([...STD_IDS, ...STD_CONSTANTS, ...variables])`
(≈ L72) et émet `unknown variable "<id>"` pour tout identifiant d'`expr` hors de `knownIds` (≈ L105-106). Les
params n'y étant pas, ils sont signalés à tort.

Le scope porte pourtant l'info : `scopes(doc)` (≈ L58-59) donne pour chaque symbole un `editPath`
`[{ kind:'symbol', symbolId, name }]` → on peut retrouver le `SymbolDef` et ses params. Le pattern existe déjà
côté CLI : `new Set([...(symbol.states ?? []).map((s)=>s.param), ...(symbol.params ?? []).map((p)=>p.name)])`
(`packages/compiler/src/cli/flatc.ts` ≈ L358).

## 4. Ce qu'on veut

Quand on lint le scope d'un symbole, ses **noms de params** (et de **state params**) sont des variables
connues de ses `expr`. Concrètement : dans `docLintContext`, si `editPath` pointe un symbole, ajouter à
`variables` les `symbol.params.map(p => p.name)` + `(symbol.states ?? []).map(s => s.param)`.

### 4.1 Garder le SCOPING (important)
Les params doivent être ajoutés **seulement au scope de LEUR symbole**, pas globalement — sinon un param
`niveau` déclaré dans le symbole A masquerait une vraie faute de frappe `niveau` dans le symbole B (qui ne le
déclare pas). Comme `docLintContext` est déjà appelé **par scope** (`editPath`), c'est naturel : résoudre le
symbole de l'`editPath` et n'ajouter QUE ses params. (Ne PAS les verser dans `allScopeVariables`, qui est
global.)

### 4.2 Subtilités à vérifier
- **State params** : un `states { … param: state }` expose aussi un nom de param réglable/observable — l'inclure
  (cohérent avec le CLU `flatc.ts` ≈ L358).
- **Type des params** : color/number/bool. Un param **color** lu dans une `expr` numérique est douteux, mais
  l'ajouter aux known-ids ne CRÉE pas d'erreur (au pire ça en masque une rare) ; le plus simple = tous les
  params. À toi de juger s'il faut restreindre aux number/bool.
- **Scène vs symbole** : le scope `scene` (root, `editPath = []`) n'a pas de params de symbole → inchangé.
- **`params { … }` côté DSL de scope** : `scopeProgram` réimprime le programme d'un scope ; vérifie que la
  source lintée et la liste de params proviennent bien du MÊME symbole (pas de décalage d'`editPath`).

## 5. Garde-fous
- **Monotone sûr** : le fix ne fait qu'**ajouter** des noms valides aux known-ids → il ne peut que **retirer**
  des faux positifs, jamais introduire de nouvelle erreur. Une vraie variable inconnue (non-param, non-`let`)
  reste signalée.
- **Acceptation** : le repro §2 (`lintDocReport` sur le symbole `S`) renvoie `''` ; `flatc --check` sur
  `flatink-edu/assets/animated/{papillon-libre,bateau,engrenage,niveau-eau-sas}.flat` ne signale plus
  `unknown variable` pour leurs params ; un `expr` qui référence un identifiant **non déclaré** (ni param, ni
  `let`) reste une erreur (ajouter un test : param connu = OK, voisin typo = erreur).
- **Non-régression** : le lint de la scène (`var`/`let`) et les autres diagnostics inchangés ; tests
  `lint.test.ts` / `programDoc.test.ts` au vert (+ un cas « param dans expr » ajouté).

## 6. Honnêteté sur le périmètre
Diagnostic : le lint par-scope (`docLintContext`, `programDoc.ts`) ne verse pas les params du symbole courant
dans `ctx.variables`, alors que `lint.ts` les exige dans `knownIds`. Le runtime et `--preview` résolvent
pourtant ces params. Fix attendu = un seul point (`docLintContext`), **scopé au symbole** (§4.1), avec un test
qui distingue « param connu » de « voisin inconnu ». Rien d'autre dans la chaîne ne bouge.
