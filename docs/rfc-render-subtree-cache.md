# RFC — Cache de sous-arbre « contenu-static » (perf rendu)

> ## ⛔ CORRECTION (2026-06-19) — le diagnostic de cette RFC est FAUX. Ne pas implémenter le cache bitmap.
> Le **problème de perf est réel** (carrefour ~78 ms/frame, ~13 fps, confirmé). Mais la cause **n'est PAS la
> rasterisation**. Profil CPU du carrefour complet :
> ```
>  63%  applyExprChannels   ← évaluation des expressions de canal
>  11%  exprScope
>   8%  (dessin skia)
>   0.3% paintRegion         ← la « rasterisation répétée » accusée par la RFC
> ```
> **Le goulot = l'évaluation des expressions de canal (~74 %), pas le dessin.** L'expérience **greybox était
> biaisée** : les rectangles n'ont **aucune expression de canal interne** — c'est ça qui les rendait rapides,
> pas leur rasterisation. Un cache bitmap optimiserait les 0,3 % et toucherait le hot path de rendu pour rien.
>
> **Cause réelle.** `applyExprChannels` (`engine/cel.ts`) reconstruisait **tout le contexte d'éval**
> (`{ ...opts.ctx, ...spaceConversions }` = toutes les variables + les canaux de chaque objet nommé) **par
> item à expression, par frame** ; les instances `.flat` multiplient ça.
> **Fix livré (0.16.1)** : (1) un petit **overlay** (space conversions + time/frame) bâti une fois par layer
> et réutilisé (on ne mute que `self`/`value`) ; (2) `opts.ctx` (le contexte scène) **consulté par référence**
> dans l'évaluateur (`evalExpr`/`resolveName`, comme `MATH_CTX` l'était déjà) au lieu d'être copié.
> **Résultat : 77,9 → 16,6 ms (~13 → ~60 fps, ×4,7), rendu PIXEL-IDENTIQUE** (60 steps de sim), 648 tests verts.
> Aucune chirurgie de rendu, aucun risque de régression visuelle. Le reste de cette RFC est **conservé pour
> archive** (la lecture du renderer reste juste ; seule la conclusion « cacher le bitmap » était la mauvaise piste).
>
> _Leçon : **profiler avant de concevoir le fix.** Le greybox a induit en erreur (confond contenu vectoriel
> et expressions de canal). `node --cpu-prof` sur `perfcheck.mjs` aurait pointé `applyExprChannels` direct._

---

> **Pour l'agent qui implémente dans flatkit.** Objectif : les scènes animées lourdes (beaucoup d'objets
> avec des expressions de canal + des instances `.flat`) rament parce que le renderer **re-peint tout
> l'arbre à chaque frame**. On veut **cacher le bitmap d'un sous-arbre dont le CONTENU ne change pas**, et
> ne ré-appliquer que sa **transformation** au blit. Cible mesurée : une activité passe de ~12 fps à ≥55 fps.
>
> Analyse rédigée après lecture du renderer (refs `file:line` ci-dessous). **Ce qui est marqué `[À VÉRIFIER]`
> doit être confirmé dans le code avant de t'y fier** — je n'ai pas lu tout le moteur.

---

## 1. Preuve mesurée (le problème est réel et chiffré)

Outil : `flatink-edu/tools/perfcheck.mjs` (boote `@flatkit/player` headless, joue N frames en chronométrant
`stepSim(1)+render()`, sort ms/frame + FPS estimé). Headless skia-canvas ≠ FPS navigateur EXACT, mais **signal
relatif fiable**. Cas de test canonique : `flatink-edu/activities/carrefour.flatpack` (un carrefour : sim
d'agents + 121 bindings `object{}` + 9 instances `.flat`).

| activité (en jeu, `running=1`) | ms/frame | FPS estimé |
|---|---|---|
| **carrefour intégré** (avec assets) | **82** | **~12** 🔴 |
| carrefour **greybox** (MÊME sim, rectangles) | 6,3 | ~160 ✓ |
| écluse `lock_boat` (réf animée) | 16 | ~61 ✓ |

**Conclusion forte :** greybox et intégré ont la **même logique de sim** (`every frame`, arrays, agents) → 6 ms.
L'intégré ajoute **+76 ms de pur RENDU**. Le coût n'est **pas** l'évaluation des expressions ni la sim : c'est
la **rasterisation répétée du contenu** (régions + sous-arbres `.flat`) à chaque frame. C'est ÇA qu'on attaque.

---

## 2. Comment le renderer marche aujourd'hui (lu dans `packages/player/src/drawScene.ts`)

Chemin : `renderLayers` (l.819) → `renderItems` (l.557) → `renderOneItem` (l.593). **Mode immédiat** : chaque
frame, l'arbre est parcouru et chaque feuille re-peinte. Détails clés :

- **`renderOneItem`, cas conteneur (l.606-631)** :
  - **l.615 `if (tint || filterStr)`** → on isole le sous-arbre hors-écran et on passe par **`compositeFiltered`**
    (le cache).
  - **`else` (l.626-630)** → on rend les enfants **directement, SANS aucun cache** (`renderContainerChildren`).
  - ⚠️ **DONC : le cache n'existe QUE pour les objets tintés/filtrés.** La grande majorité des objets (pas de
    filtre) ne touchent **jamais** le cache → re-rasterisés chaque frame. C'est le cœur du problème, et c'est
    *différent* de « le cache bail sur les expressions » : pour la plupart des objets, **il n'y a pas de cache du tout**.

- **`compositeFiltered` (l.228-310)** : pour un sous-arbre **static**, garde le **bitmap FINAL en espace ÉCRAN**
  et le re-blitte si la signature n'a pas changé (HIT, l.241-248, « THE paper-theatre win »). Sinon il
  re-rasterise via `draw(octx)`.
  - **`filterCacheSlot` (l.215-221)** : **signature = la matrice de transformation ÉCRAN** (`a,b,c,d,e,f`) + tint
    + filtre + `imageEpoch`. → un objet qui **bouge** voit sa signature changer **chaque frame** → jamais de HIT.
  - **`isRenderStatic` (l.197-211)** : **disqualifie tout objet qui a une expression de canal** (`hasExpr`, l.189,
    l.200), un `text bind`, une timeline/cel animée, ou une instance d'un symbole à timeline. Donc même si on
    élargissait le cache au cas non-filtré, un objet expression-bindé ne cacherait **jamais** (sig + isRenderStatic).

- **Infra de cache existante (réutilisable)** : `CacheSlot` / `FilterCacheEntry` (l.53+), `ensureCacheCanvas`
  (l.313), `acquireScratch`, la map `rctx.filterCache` **fournie par le player** (absente en éditeur/preview →
  pas de cache → rendu live, l.47-48, l.216). `imageEpoch` invalide tout au chargement d'un asset.

- **Transformation** : dans `renderOneItem`, `ctx` est positionné par `applyTransform(ctx, ctm)` (l.622/628) où
  `ctm = it.transform`. Les **expressions de canal** modifient cette transform/alpha en amont (`[À VÉRIFIER]` :
  où exactement les expressions x/y/scaleX/scaleY/rotation/opacity sont appliquées à `it.transform` /
  `opacity` — voir `@flatkit/engine/cel` `applyExprChannels`, et `resolveLayerAt`). `compositeFiltered` rasterise
  avec `octx.setTransform(dev…)` (l.271-273), donc **transform écran cuite dans le bitmap**.

---

## 3. L'insight qui débloque

Les **6 canaux d'expression** (`x · y · scaleX · scaleY · rotation · opacity`, cf. `types` `ExprChannel`
`[À VÉRIFIER]`) modifient **uniquement la transformation et l'alpha** d'un objet — **jamais son CONTENU**. Le
contenu d'un objet ne change que par : un `text bind`, une **timeline/état interne** (un `.flat` animé, un
`state` piloté), ou des **enfants** eux-mêmes dynamiques.

> Donc un objet **avec des expressions de canal mais dont le CONTENU est statique** est
> **« contenu-static, transform-dynamic »** : on peut rasteriser son contenu **une seule fois** (en espace local)
> et **re-blitter avec la transform du frame**. La partie chère (rasteriser paths + sous-arbre `.flat`) ne
> dépend **pas** de la transform → elle devient cachable même quand l'objet bouge.

Dans le carrefour : les voitures `.flat` qui **se déplacent** (transform) avec une frame interne stable, le
décor bindé → re-blits quasi gratuits. Seuls les frames où le **contenu** change vraiment (voiture
`roule→crashe`, feu qui change) re-rasterisent.

---

## 4. Design proposé

### 4.1 Nouvelle classification `contentStatic(it)`
Comme `isRenderStatic` MAIS **les propres expressions de canal de l'objet ne le disqualifient PAS** (elles ne
touchent que la transform). Disqualifient toujours : `text bind`, la **timeline/cel propre** de l'objet, une
**instance dont le symbole a une timeline** OU **dont un `state`/param peut changer**, et tout **enfant
non-contenu-static**. (Factoriser avec `isRenderStatic` : extraire le cœur, paramétrer « ignore-own-channel-exprs ».)

### 4.2 Cache de bitmap de sous-arbre GÉNÉRAL (pas seulement filtré)
Aujourd'hui le cache ne sert que sous `if (tint || filterStr)`. Il faut un chemin de cache **aussi pour le cas
non-filtré** (le `else` l.626), gaté sur `contentStatic(it)` + `rctx.filterCache` présent.

Principe (généralise `compositeFiltered`) :
1. Rasteriser le contenu du sous-arbre **en espace LOCAL** dans un buffer : taille = la **bbox locale** de
   l'objet (`it.box` w/h pour groupes/instances `[À VÉRIFIER]` pour le pivot/offset) × un **scale écran
   représentatif** (bucketé), **sans** la translation/rotation/le scale variable du frame.
2. Clé de cache = **signature de CONTENU** : `id + bucket(scale) + tint + filtre + imageEpoch + contentVersion`
   — **PAS** la matrice de transform complète (c'est tout l'enjeu).
3. Au frame : si HIT, **blitter le buffer avec la transform complète** (`ctx.setTransform(M·1/s)` + `drawImage` +
   `globalAlpha *= opacity`). MISS → rasteriser une fois (puis HIT les frames suivants).

### 4.3 Le point délicat — la décomposition de transform (où les bugs se cachent)
On rasterise à un repère canonique (scale `s`, rotation identité, origine locale), on blitte avec `M` (la
transform local→écran composée par le caller). Le blit = `M` « moins » le `s` déjà cuit dans le buffer
(`setTransform(M.a/s, M.b/s, M.c/s, M.d/s, M.e, M.f)` puis `drawImage(buffer,0,0)`), **en tenant compte de
l'offset de la bbox locale / du pivot**. À écrire avec soin et à **tester pixel-près** (une erreur ici =
contenu décalé/mal-scalé → artefact visible).

### 4.4 Invalidation / `contentVersion`
- **Transform/opacity (canaux) changent** → on garde le buffer, on re-blitte. ✓
- **Contenu change** → re-rasteriser. Sources : frame interne d'un `.flat` qui avance, `state`/param d'instance
  qui change, valeur d'un `text bind`, enfant dynamique. → soit on **exclut** ces sous-arbres du cache (via
  `contentStatic` qui les classe non-static), soit on **cache par frame interne** (clé incluant la frame du
  symbole) pour les `.flat` dont l'anim joue. `imageEpoch` (chargement d'asset) invalide déjà — réutiliser.
- **Éditeur/preview** : `rctx.filterCache` absent → pas de cache → rendu live (garder tel quel).

---

## 5. Risques & garde-fous (c'est le HOT PATH du renderer — un bug = artefacts partout)

- **Non-régression visuelle** : `packages/player/src/drawScene.test.ts` (341 l) doit rester vert ; **ajouter des
  cas** (objet contenu-static qui se déplace → HIT après 1ʳᵉ frame, contenu qui change → MISS). + **diff visuel**
  sur des activités de réf (écluse, un escape, une activité simple) : pixels **quasi identiques** exigés avant/après.
- **Scaling** : re-blitter un buffer mis à l'échelle floute. → bucketer le `scale` (re-rasteriser au-delà d'un
  delta), et **plafonner la taille du buffer**.
- **Rotation** : DÉCISION (cf. §7) — soit blitter avec rotation (rotation d'un raster = léger flou, plus de HIT),
  soit rasteriser à la rotation courante et re-raster sur delta de rotation (moins de HIT, plus net).
- **Mémoire** : un buffer par sous-arbre contenu-static → **borner** (LRU, nb max / px max, éviction). Surveiller
  sur une grosse scène.
- **`.flat` instanciés** = le gros gain ET le cas le plus subtil : une instance qui **se déplace** avec frame
  interne stable → cache+re-blit (énorme) ; une dont la **timeline interne joue** ou dont le `state` change →
  doit re-rasteriser ce(s) frame(s). Bien classer.

---

## 6. Plan de validation (mesuré, pas à l'œil seul)

1. **`perfcheck.mjs` AVANT/APRÈS** sur `carrefour.flatpack` (`--vars '{"running":1,"phases":[1,3,4,2,4,5],"durs":[3,1,1,3,1,2]}'`).
   Cible : **82 ms → ≤ ~16 ms** (niveau écluse) idéalement vers les 6 ms du greybox. (perfcheck vit dans
   flatink-edu ; soit on le réutilise, soit on réplique le micro-harnais : `new FlatPlayer(canvas, doc,
   {autoplay:false,input:false,audio:false})` + `stepSim(1)`/`render()` chronométrés.)
2. **`pnpm test`** (dont `drawScene.test.ts`) vert + nouveaux cas.
3. **Diff visuel** écluse/atelier-eau/un escape : non-régression pixel.
4. Build local + validation dans flatink-edu (`flatc` local) **avant** de publier (`@flatkit/player` ; cycle de
   release dans `flatkit/CLAUDE.md`).

---

## 7. Décisions ouvertes (à trancher au début, idéalement avec l'humain)

1. **Rotation** : re-raster sur delta vs rotate-blit ? (la plupart des cas — vue de dessus, fades — tournent peu).
2. **Granularité du bucket de scale** : combien de paliers avant re-raster ? (compromis netteté/HIT).
3. **Où hooker** : étendre `compositeFiltered` pour gérer le cas non-filtré + le mode local-space, OU un chemin
   parallèle dans `renderOneItem` (l.615/626) ? (Je penche pour factoriser : un seul cache, deux modes.)
4. **Politique d'éviction** mémoire (LRU ? plafond px ?).
5. **`.flat` dont l'anim interne joue** : on les cache par frame interne, ou on les laisse hors cache au début
   (gain déjà énorme sur les `.flat` qui ne font que se déplacer) ?

---

## 8. Carte rapide des points d'entrée (`packages/player/src/drawScene.ts`)
- `isRenderStatic` l.197 · `hasExpr` l.189 · `filterCacheSlot` l.215 · `compositeFiltered` l.228 ·
  `ensureCacheCanvas` l.313 · `renderItems` l.557 · **`renderOneItem` l.593** (le gate filtré/non-filtré **l.615**,
  l'appel cache **l.621**, le `else` sans cache **l.626**) · `renderLayers` l.819.
- Types de cache : `CacheSlot` / `FilterCacheEntry` (l.53+). `rctx.filterCache` fourni par `player.ts`.
- Application des expressions de canal à la transform/opacity : `@flatkit/engine/cel` (`applyExprChannels`,
  `resolveLayerAt`) — **à lire pour la §4.3** (comment décomposer transform de contenu vs transform de blit).

## 9. Honnêteté sur le périmètre
Ce n'est **pas** un patch : c'est une **vraie feature de rendu** (cache de bitmap de sous-arbre + décomposition
de transform + invalidation). Le gain est transverse (toutes les activités animées en profitent). Mais le risque
sur le chemin de rendu central est réel → avance par incréments, garde le diff visuel + `drawScene.test.ts` verts
à chaque pas, et mesure au `perfcheck` (le chiffre, pas l'œil). Le cas de test canonique « doit redevenir fluide »
= `flatink-edu/activities/carrefour.flatpack`.
