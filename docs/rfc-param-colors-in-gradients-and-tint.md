# RFC — couleurs PARAMÉTRABLES dans les gradients (`radial`/`linear`) et le `tint`

> **Pour l'agent qui implémente dans flatkit.** Ceci n'est PAS un patch précis : c'est une **intention + un
> besoin + un test reproductible + des zones d'ombre à explorer**. Le demandeur (Klem) attend : « conçois le
> MODÈLE, ne te contente pas de débloquer le symptôme ». Le diagnostic moteur est localisé ci-dessous — à toi
> de choisir la bonne forme (notamment la syntaxe de couleur+alpha) et de creuser les subtilités (cache de
> paint, interpolation, scope de résolution, round-trip) avant de coder.

---

## 1. L'intention (le pourquoi — lis ça en premier)

FlatInk-EDU bâtit une **bibliothèque d'assets animés `.flat`** réutilisables, dont des **effets génériques**
(halos, glows, dégradés) censés être **recolorables** pour servir dans plusieurs contextes (un halo doré sous
une lune, bleu sous une vanne, vert sous une plante…). Le recoloriage doit être **hand-tunable en keyframes** :
un `param color` exposé, réglé dans l'éditeur / la galerie, sans scripting.

Aujourd'hui, **seul un fill SOLIDE peut être piloté par un param de couleur** (`fill <param>`). Dès que la
couleur vit dans un **dégradé** (`radial(...)` / `linear(...)`) ou dans un **`tint`**, le param ne peut plus
l'alimenter — la couleur est gravée en dur. Résultat concret côté EDU : l'asset `halo-pulse.flat` déclarait un
`param color teinte` « le cœur du dégradé », mais le fill était `radial(..., 0:#ffe9a8cc, 1:#ffe9a800)` (hex
gravé) → le param était **MORT** (un color-picker sans effet dans la galerie). On a dû le **retirer**. Or les
halos/glows sont précisément les assets qu'on veut recolorer le plus.

**Le manque** : un param de couleur ne peut pas (encore) servir de couleur **dans un stop de gradient ni dans
un tint** — alors que c'est exactement là que vivent les effets recolorables.

## 2. Le besoin concret (cas réel EDU)

`halo-pulse.flat` : un cercle à dégradé radial qui respire. On veut :
```
params { color teinte = #ffe9a8  "Teinte du halo" }
...
circle 0 0 60 fill radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0)   // même teinte, alpha qui s'estompe
```
→ régler `teinte` recolore le halo (cœur + bord), en gardant la **chute d'alpha** radiale. Même besoin pour un
`tint <param> <amount>` (Flash-style) sur un sous-arbre — recolorer un glow/une braise par instance.

C'est le pendant naturel de `fill <param>` (déjà supporté pour les solides) étendu aux gradients et au tint.

## 3. Le comportement observé + la CAUSE (localisée dans le moteur)

Un `fill teinte` SOLIDE marche (recolorable). Un `radial(..., 0:teinte, 1:...)` ne marche pas : selon la forme,
le parser **refuse** l'identifiant dans un stop, ou la couleur de stop reste un hex gravé résolu nulle part.

**Cause, localisée :**
- **Le modèle ne porte la couleur-param QUE sur le solide.** `Region.fillParam?: string` /
  `strokeParam?: string` (`packages/types/src/index.ts` ≈ L274/276) sont les seuls champs « couleur liée à un
  param ». En face, `Stop = { offset: number; color: string }` (L45) et `Tint = { color: string; amount: number }`
  (L48) ne portent **qu'un hex littéral** — aucun champ pour un param.
- **La résolution param→couleur n'a lieu que pour le solide.** Dans `packages/player/src/drawScene.ts` :
  `fillStyleFor()` fait `if (region.fillParam) { const c = colorParams?.[region.fillParam]; … }` (≈ L565) et le
  stroke pareil (≈ L693), via le scope `colorParams?: Record<string,string>` (≈ L52, alimenté en entrant dans
  une instance, `colorParams: color` ≈ L455). MAIS l'application d'un gradient fait
  `for (const s of paint.stops) g.addColorStop(clamp01(s.offset), s.color)` (≈ L560) — `s.color` BRUT, aucune
  résolution. Et le tint fait `octx.fillStyle = tint.color` (≈ L289) — brut aussi.
- **Le parser n'accepte un id-param que pour `fill`/`stroke` solides.** `isParamRef = () => k.k === 'id' &&
  k.v !== 'linear' && k.v !== 'radial' && k.v !== 'none'` (`packages/engine/src/flatFormat.ts` ≈ L1289) — il
  **exclut explicitement** les gradients. Les stops sont parsés/imprimés en `offset:hex` (`printStops` ≈ L73).
  Le `tint` lit un token brut comme couleur (`const color = this.next().v` ≈ L1225/1479) — un id y serait stocké
  tel quel et rendu comme une couleur invalide.

Donc : l'infrastructure de résolution (`colorParams`) **existe déjà** ; il manque (a) un endroit dans le MODÈLE
pour dire « ce stop / ce tint = tel param » (+ son alpha), (b) la résolution au paint (addColorStop / fillStyle
du tint), (c) la surface DSL.

### Le test, à reproduire tel quel
`.flat` (`/tmp/halo.flat`) :
```
symbol "Halo" {
  timeline 24 60
  params { color teinte = #ffe9a8  "Teinte du halo" }
  layer "c" {
    group "g" at 0,0 pivot 0,0 {
      layer "c" { circle 0 0 60 fill radial(0.5, 0.5, 0.5, 0:teinte@0.8, 1:teinte@0) }
    }
  }
}
```
Aujourd'hui : `flatc --check` **rejette** la syntaxe `0:teinte@0.8` (ou, si tu la fais juste parser, la couleur
n'est pas résolue → rendu cassé/noir). Harnais d'acceptation (Node, `@flatkit/player` + `skia-canvas`) — recolore
via le DÉFAUT (comme la galerie : muter `symbol.params[].default` puis re-résoudre) et vérifie que le rendu
change ET reste un dégradé doux :
```js
import { Canvas, Image, Path2D } from 'skia-canvas'
import { readFileSync } from 'node:fs'
globalThis.Path2D=Path2D; globalThis.Image=Image; globalThis.devicePixelRatio=1
globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){}}
globalThis.requestAnimationFrame=()=>0; globalThis.cancelAnimationFrame=()=>{}
const base=JSON.parse(readFileSync(process.argv[2],'utf8'))               // flatpack compilé du symbole "Halo"
const { FlatPlayer }=await import('@flatkit/player')
const w=base.width,h=base.height
const render=(hex)=>{ const d=structuredClone(base)
  const s=d.symbols.find(x=>x.params?.some(p=>p.name==='teinte')); s.params.find(p=>p.name==='teinte').default=hex
  const c=new Canvas(w,h); c.getBoundingClientRect=()=>({width:w,height:h,left:0,top:0,right:w,bottom:h})
  const p=new FlatPlayer(c,d,{autoplay:false,input:false,audio:false}); p.seek(0); p.render()
  return Uint8ClampedArray.from(c.getContext('2d').getImageData(0,0,w,h).data) }
const mad=(a,b)=>{let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length}
const gold=render('#ffe9a8'), blue=render('#7ec8ff')
console.log('recolor a un effet ? MAD=',mad(gold,blue).toFixed(2), mad(gold,blue)>2?'✅':'❌ (param non câblé au gradient)')
```
Attendu APRÈS fix : `✅` (le halo change de teinte), et le dégradé reste lisse (pas un disque dur).

## 4. Ce qu'on veut (résultat, pas implémentation imposée)

Qu'un **`param color`** puisse servir de couleur **partout où une couleur est acceptée** — pas seulement le
solide : **stops de gradient** et **tint**. Pistes (à arbitrer) :

- **Une « réf couleur » = hex | param**, unifiée. P.ex. `Stop = { offset; color?: string; colorParam?: string;
  alpha?: number }` et `Tint = { color?: string; colorParam?: string; amount: number }`. Au paint, si
  `colorParam` est posé, résoudre via le scope `colorParams` déjà en place (et combiner l'`alpha` du stop),
  sinon garder le comportement hex actuel.
- **Surface DSL** (round-trip-safe dans `flatFormat.ts`) : un stop accepte un id-param avec alpha,
  p.ex. `0:teinte@0.8` (offset:param@alpha) à côté de `0:#ffe9a8cc` (hex). Tint : `tint <param> <amount>`. À toi
  de choisir l'idiome le plus propre ; l'**alpha par stop est nécessaire** (un param couleur est un hue à 6
  digits, sans canal alpha — or les halos veulent « même teinte, alpha qui chute » : cf. §2).

**Critères d'acceptation :**
- Le test §3 passe : recolorer `teinte` (par mutation du défaut, le chemin de la galerie) change la teinte du
  `radial(...)`, le dégradé reste lisse, et ça **round-trip** (`parse(print(doc)) ≡ doc`).
- Un `tint <param> <amount>` se recolore de même.
- **Non-régression** : tous les gradients/tints en HEX existants rendent **au pixel près** comme avant.
- Idéalement EDU peut alors **réintroduire** `param color teinte` dans `halo-pulse.flat` (retiré faute de ce
  support).

## 5. Subtilités à creuser (Klem en attend — ne les balaie pas)

1. **Alpha des stops param.** Un hex de stop encode l'alpha (`#ffe9a8cc`) ; un param couleur est un hue à 6
   digits. Il FAUT un alpha par stop pour le cas halo (même teinte, alpha 0.8→0). Définis le modèle (`alpha?`
   sur le stop) et la syntaxe. Idem : un param couleur pourrait-il lui-même porter un alpha (#rrggbbaa) ? Tranche.
2. **Cache de paint & interpolation.** `paint.ts` construit une clé de cache de gradient depuis `offset@color`
   (`stopsKey` ≈ L28) et interpole les stops (`lerpStops`/`lerpPaint`). Avec des params, la clé doit inclure la
   couleur **RÉSOLUE** (sinon le gradient ne se rafraîchit pas au recolor), et l'interpolation doit se faire sur
   les couleurs résolues. Pareil pour le **cache de composite filtré** : sa signature inclut `tint.color`
   (`filterCacheSlot` ≈ L230, `drawScene.ts`) — utiliser la couleur de tint **résolue** pour que le cache se
   busted au recolor.
3. **Scope de résolution du tint.** `colorParams` est passé à `paintRegion` (≈ L666/669/673) — le solide y a
   accès. Le **tint**, lui, est appliqué dans `compositeFiltered` (≈ L285-289) qui ne reçoit PAS `colorParams`
   aujourd'hui. Il faudra le faire descendre jusque-là (et dans `filterCacheSlot`).
4. **Fallback & valeur par défaut.** Si le param est absent/non résolu, retomber proprement (comme `fillParam`
   retombe sur `region.color`). Un stop param doit-il porter un hex de secours, ou résoudre le `default` déclaré
   du param ? La galerie recolore en **mutant le `default`** puis re-résolvant (les couleurs ne passent PAS par
   `setParam` — cf. note §7) : la résolution doit donc lire le défaut (éventuellement muté) via `colorParams`,
   y compris pour les instances imbriquées (le chemin existe pour `fillParam` → l'étendre).
5. **Round-trip.** `printPaint`/`printStops` (≈ L73-77) et le parse des gradients (≈ L1506+) + du tint
   (≈ L1225/1479) doivent gérer la nouvelle réf couleur, avec le test de round-trip au niveau MODÈLE.
6. **Déterminisme & perf.** Résolution par-frame dans `addColorStop` / le tint = lookups en plus sur le hot
   path. Surveille (cf. fix `applyExprChannels` 0.16.1). Garde le cache de gradient efficace (busté sur couleur
   résolue, pas reconstruit à chaque frame si rien ne change).
7. **Cohérence avec `fill <param>` existant.** Idéalement, unifie : une seule notion de « réf couleur (hex |
   param + alpha) » réutilisée par fill/stroke solides, stops de gradient et tint — plutôt que 3 chemins ad hoc.

## 6. Garde-fous
- **Non-régression** : tous les `.flat` à gradients/tints HEX existants (corpus flatkit + `flatink-edu/assets/`)
  rendent identiques ; golden/tests au vert.
- Le **test §3** doit donner ✅ après fix, sans casser un gradient hex voisin.
- Cycle de release : build local + valider dans flatink-edu (`flatc` local, `assets.html` dans le navigateur =
  le vrai juge ; ré-câbler `teinte` dans `halo-pulse.flat`) AVANT de publier `@flatkit/*` (cf. `flatkit/CLAUDE.md`).

## 7. Honnêteté sur le périmètre
J'ai diagnostiqué une **limite** (les couleurs-params ne sont résolues que pour le fill/stroke SOLIDE ; les
stops de gradient et le tint portent un hex gravé résolu nulle part) et l'ai localisée (`types` `Stop`/`Tint`
vs `fillParam` ; `drawScene` `fillStyleFor`/`addColorStop`/application du tint + scope `colorParams` ; parser
`isParamRef` qui exclut les gradients). Je n'impose pas le mécanisme : commence par **reproduire** (test §3),
**confirme** que `colorParams` est le bon point de résolution, **puis** conçois la « réf couleur » unifiée
(hex | param + alpha) + sa surface DSL + les mises à jour de cache. L'objectif final = **des effets génériques
(halos/glows/dégradés) recolorables à la main**, cohérents avec le `fill <param>` déjà en place.

> **Hors-périmètre mais ADJACENT (à signaler, pas à traiter ici)** : la galerie recolore en **recréant** le
> player (mutation du `default`), parce que **`setParam` ne gère pas la couleur** (cf. `assets.js`, « FRICTIONS
> J »). Une fois les couleurs-params généralisées, un `setParam(inst, '<colorParam>', '#hex')` qui recolore EN
> DIRECT (sans re-montage) serait le complément logique. À garder pour un palier suivant.
