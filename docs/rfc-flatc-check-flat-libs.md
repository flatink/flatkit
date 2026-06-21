# MINI-RFC — `flatc --check <library>.flat` doit linter la LIB d'assets (pas la parser comme une scène)

> **Pour l'agent qui implémente dans flatkit.** Petite RFC DX : un seul branchement manquant dans le CLI. Tout
> le moteur nécessaire (`parseFlatLib`, `lintDoc`) existe déjà. Intention + repro + cause + résultat + garde-fous.

---

## 1. L'intention / le symptôme

FlatInk a deux entrées : des **programmes `.flatink`** (composition + logique, une scène) et des **libs
`.flat`** (bibliothèques de symboles/assets visuels). Le linter sémantique (`flatc --check`) est l'outil du
flow « generate → lint → fix ». Il marche pour les `.flatink`. Mais pour une **lib `.flat`**, il n'y a **aucun
moyen propre de la linter en CLI** :
```
$ flatc assets/animated/halo-pulse.flat --check
[scene] 9:1: error: unexpected statement "symbol" (expected an event, "at frame", "label", "let", …)
[scene] 12:3: error: unexpected statement "params" …
[scene] 13:5: error: unexpected statement "color" …
… (14 erreurs de parse)
```
→ `--check` parse le `.flat` comme un **programme/scène**, donc il s'étrangle sur `symbol`/`params`/`layer`.
Conséquence : pour vérifier un asset (y compris les nouveaux lints utiles — params-dans-expr 0.19.1,
color-param dans un paint 0.19.3), l'auteur doit **contourner** : compiler en flatpack (`--preview`) puis
appeler `lintDocReport(doc)` via l'API. Mauvaise DX pour ce qui devrait être un `flatc --check x.flat`.

C'est dommage car **tout est déjà là** : `--preview` sait déjà parser un `.flat` (`parseFlatLib`), et `lintDoc`
sait linter les symboles d'un Doc (scène + chaque symbole). Il manque juste le **branchement** dans `--check`.

## 2. Reproduction
`flatc <repo>/assets/animated/halo-pulse.flat --check` → cascade de `[scene] unexpected statement "symbol"`
(le `.flat` est parsé comme une scène). Aucun moyen d'obtenir le lint par-symbole `[HaloPulse] …`.
Attendu après fix : un lint propre par symbole (ou silence si l'asset est sain), exit ≠0 sur ERROR.

## 3. La cause (localisée — un seul branchement)

`packages/compiler/src/cli/flatc.ts` :
- `--check` passe par `compileOnce(programPath, …)` (≈ L157) → `buildDocFromProgram(programPath)` (≈ L102-153)
  qui fait `parseProgramFull(programSrc)` (≈ L109) — **parse TOUJOURS comme un programme `.flatink`**, quelle
  que soit l'extension. Puis `lintDocReport(doc)` + `docHasErrors(doc)` (≈ L169-170).
- Pour un `.flat`, `parseProgramFull` échoue (une lib n'est pas une scène) → les `[scene] unexpected statement`.
- Pourtant `parseFlatLib` est déjà importé (≈ L15) et utilisé par `--preview` ; et `lintDoc`/`lintDocReport`
  (≈ L23) lintent les symboles de N'IMPORTE quel Doc.

Donc : `--check` ne détecte pas qu'un `.flat` est une **lib** et la fait passer par le mauvais parseur.

## 4. Ce qu'on veut

`flatc <library>.flat --check` (et `flatc a.flat b.flat --check`) **lint la/les lib(s) d'assets** :
1. **Détecter** l'entrée `.flat` (par extension, comme `--preview` le fait déjà ; pas de content-sniffing).
2. `parseFlatLib(src)` → les symboles (et folders) ; pour plusieurs `.flat`, **fusionner** les symboles dans un
   seul jeu (pour que les `instance "X"` cross-lib se résolvent, comme le fait le chemin programme avec ses libs).
3. Assembler un **Doc minimal** : `{ width, height, timeline, variables: {}, layers: [], symbols }` (scène VIDE).
4. `lintDocReport(doc)` → `[<Symbol>] line:col: level: message` (le scope `scene` vide ne produit rien). Exit
   ≠0 sur ERROR via `docHasErrors`, warnings non bloquants — **même contrat que le `--check` programme**.
5. **Ne PAS** lancer `behaviorDiagnostics` (zones de drop, etc. = scène-level, sans objet pour une pure lib).

Bénéfice immédiat : tous les lints existants s'appliquent **gratuitement** aux assets (params-dans-expr 0.19.1,
color-param non déclaré dans un paint 0.19.3, fonctions/objets inconnus…), via le vrai outil `flatc --check`.

### 4.1 Bonus adjacent (à signaler, optionnel)
`flatc --preview <lib>.flat` pourrait **aussi** émettre les WARNINGS de lint (sur stderr, non bloquant) en plus
de compiler le flatpack → l'auteur voit un « dead recolor » pendant qu'il prévisualise, sans `--check` séparé.
À toi de juger si ça vaut le coup ou si ça pollue la sortie `--preview`.

## 5. Subtilités à vérifier
- **Routage** : la détection `.flat` doit cohabiter avec le cas `flatc prog.flatink hero.flat …` (un programme
  AVEC des libs en arguments). Règle simple : si le **1er positionnel** est un `.flatink` → chemin programme
  (inchangé) ; si c'est un `.flat` → chemin lib-lint (les positionnels suivants `.flat` = libs à fusionner).
- **Erreurs de parse de la lib** elle-même (symbole malformé) : les remonter proprement (pas en `[scene]`).
- **Exit code & format** : identiques au `--check` programme (`[scope] line:col: level: msg`, ≠0 sur erreur).
- **`--watch`** : si supporté pour `--check`, le faire marcher aussi pour une lib (re-lint au changement).
- **Aide/usage** : ajouter `flatc <library>.flat --check` dans le help (≈ L52-64), à côté de `--preview`.

## 6. Garde-fous
- **Non-régression** : `flatc <program>.flatink --check` inchangé (même parseur, même sortie, mêmes
  behaviorDiagnostics). Le nouveau chemin ne se déclenche que sur une entrée `.flat`.
- **Zéro nouvelle logique de lint** : on RÉUTILISE `parseFlatLib` + `lintDoc`/`lintDocReport`/`docHasErrors`. Les
  checks (expr, color-param) viennent gratis et restent cohérents avec l'éditeur.
- **Acceptation** : `flatc assets/animated/halo-pulse.flat --check` → **plus de `[scene]` noise**, lint propre
  (silence si sain) ; une lib avec un color-param non déclaré dans un paint → `[<Symbol>] warning: …` (exit 0) ;
  une lib avec une vraie erreur d'expr → exit ≠0 ; un `.flatink` programme → comportement identique à avant.

## 7. Honnêteté sur le périmètre
Diagnostic : `--check` route toujours vers `parseProgramFull` (chemin `.flatink`), même pour un `.flat`, alors
que `parseFlatLib` (déjà importé, utilisé par `--preview`) + `lintDoc` font exactement ce qu'il faut. Fix
attendu = **un branchement** sur l'extension `.flat` dans le dispatch `--check`/`compileOnce`, assemblant un Doc
de symboles à scène vide et appelant le lint existant. Rien d'autre dans le moteur ne bouge ; c'est de la DX.
