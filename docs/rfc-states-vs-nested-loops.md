# RFC — `states` fige les timelines imbriquées (vers des « états animés » hand-tunables)

> **Pour l'agent qui implémente dans flatkit.** Ceci n'est PAS une demande de patch précis : c'est une
> **intention + un besoin + un test reproductible + des zones d'ombre à explorer**. Le demandeur (Klem)
> dit explicitement : « il y a peut-être des subtilités auxquelles je n'ai pas pensé » — donc **conçois le
> modèle, ne te contente pas de débloquer le symptôme**. Diagnostic posé côté EDU (comportement observé au
> vrai player), pas côté moteur : à toi de trouver le mécanisme exact et la bonne forme.

---

## 1. L'intention (le pourquoi — lis ça en premier)

FlatInk-EDU construit une **bibliothèque d'assets animés `.flat`** (symboles tween) qu'on **compose** ensuite
en activités. La direction produit que veut Klem :

> **Un animateur doit pouvoir peaufiner les animations À LA MAIN, en keyframes, dans un éditeur — autant que
> possible SANS scripting** (sans écrire des `expr`/formules).

Le pivot : on a aujourd'hui deux mécaniques d'animation dans un `.flat`, et elles ne se combinent pas comme il
faudrait :
- **`states { … }`** = des poses nommées posées sur des `cel` (ex. voiture-top : `roule`/`freine`/`crashe`),
  avec cross-fade `transition`. **C'est hand-tunable (keyframes), mais un état est une POSE FIGÉE.**
- **`expr <canal> "<formule de time/clock>"`** = une idle continue (ex. bateau qui tangue). **Ça boucle, mais
  c'est du SCRIPTING** — pas ce qu'un animateur règle à la main.

Le manque : **pas de moyen, en keyframes, d'avoir un état qui EST lui-même une boucle animée** (ni une idle qui
tourne PENDANT un état).

## 2. Le besoin concret (2 cas réels)

1. **Le baigneur** : un personnage avec deux **boucles** — `marche` (cycle de marche) et `panique` (cycle
   agité). Klem veut **UN `.flat` `Baigneur` avec 2 « états » `marche`/`panique`, chacun étant une boucle
   hand-animée**, sélectionnable. Aujourd'hui on est obligé de faire 2 symboles séparés (`BaigneurMarche`,
   `BaigneurPanique`) — ce qu'il refuse à juste titre.
2. **TransfoClaque** (un transformateur) : 3 états `ok`/`chaud`/`claque`. Il voudrait une **idle qui tourne
   DANS l'état `ok`** (un léger frémissement permanent), pas une pose morte. Aujourd'hui : impossible en
   keyframes — l'état est figé.

Idée de Klem (bonne piste, voir §4) : **et si le cel d'un état posait un SOUS-SYMBOLE qui a sa propre
timeline ?** L'état choisit quel sous-symbole-boucle est visible, chaque boucle tourne toute seule.

## 3. Le comportement observé (mesuré au VRAI player, reproductible)

Méthode : `@flatkit/player` headless (skia-canvas), `new FlatPlayer(canvas, doc, {autoplay:false})`, on
`stepSim(1)` N fois + `render()`, on compare les buffers PNG à 2 instants (≠ ⇒ ça anime). `flatc --render`
NE convient PAS : il **fige** les instances sur leur frame 0 — seul le player les anime.

| cas testé | résultat |
|---|---|
| `Spin` seul (boucle cel tweenée : `cel 0/12/24 → rotate 0/180/360`) | ✅ **anime** |
| `ParentNoState` (timeline simple) qui **instancie** `Spin` | ✅ **anime** (la timeline imbriquée tourne) |
| `Parent` **avec `states { calme at 0  agite at 24 }`** qui instancie `Spin` | ❌ **FIGÉ** |
| `voiture-top` (réel, `states`, état initial `roule`) | ❌ figé (= pose, attendu) |

**Conclusion** : une instance de sous-symbole **joue bien sa propre timeline** — SAUF si le parent a des
`states`. Le **pin d'état gèle tout le sous-arbre** (les timelines imbriquées comprises). C'est donc une
**limite de l'ENGINE** (la façon dont l'état épingle la frame cascade sur les enfants), pas du player.

### Le test, à reproduire tel quel
`.flat` (mets-le dans un dossier, compile chaque symbole avec `flatc --preview <f>.flat --symbol <Nom> -o /tmp/x.flatpack`) :
```
symbol "Spin" {
  timeline 24 24
  layer "c" {
    group "g" at 0,0 pivot 0,0 { layer "c" { rect -8 -8 16 16 4 fill #c9874a } }
    cel 0  tween ease linear { pose "g" rotate 0 }
    cel 12 tween ease linear { pose "g" rotate 180 }
    cel 24 tween ease linear { pose "g" rotate 360 }
  }
}
symbol "ParentNoState" { timeline 24 24  layer "c" { instance "Spin" as "s" } }
symbol "Parent" {
  timeline 24 48
  states state { calme at 0  agite at 24  initial calme }
  layer "c" {
    instance "Spin" as "s"
    group "box" at 34,0 { layer "c" { circle 0 0 9 fill #6aa3e0 } }
    cel 0  { pose "s" opacity 1    pose "box" opacity 0.25 }
    cel 24 { pose "s" opacity 0.25 pose "box" opacity 1 }
  }
}
```
Harnais (Node, depuis un repo avec `@flatkit/player` + `skia-canvas`) :
```js
import { Canvas, Image, Path2D } from 'skia-canvas';
import { readFileSync } from 'node:fs';
globalThis.Path2D=Path2D; globalThis.Image=Image; globalThis.devicePixelRatio=1;
globalThis.window={devicePixelRatio:1,addEventListener(){},removeEventListener(){},requestAnimationFrame:()=>0,cancelAnimationFrame(){}};
globalThis.requestAnimationFrame=()=>0; globalThis.cancelAnimationFrame=()=>{};
const doc=JSON.parse(readFileSync(process.argv[2],'utf8')); const {FlatPlayer}=await import('@flatkit/player');
const c=new Canvas(doc.width,doc.height); c.getBoundingClientRect=()=>({width:doc.width,height:doc.height,left:0,top:0,right:doc.width,bottom:doc.height});
const p=new FlatPlayer(c,doc,{autoplay:false,input:false,audio:false});
const g=async()=>{p.render();return await c.toBuffer('png')};
for(let i=0;i<3;i++)p.stepSim(1); const b1=await g(); for(let i=0;i<8;i++)p.stepSim(1); const b2=await g();
console.log(b1.equals(b2)?'❌ statique':'✅ animé');
```

## 4. Ce qu'on veut (résultat, pas implémentation imposée)

Pouvoir faire, **en keyframes hand-tunables**, un symbole dont les « états » sont des **boucles animées**
sélectionnables, et/ou une idle qui tourne pendant un état. Deux familles de design possibles (à toi/avec Klem) :

- **(A) Les timelines imbriquées ne sont pas gelées par le pin d'état du parent.** Un état du parent change la
  POSE (transform/opacité) des enfants, mais chaque instance imbriquée continue de jouer sa propre timeline.
  → l'idée de Klem (§2) marche : un état pose le sous-symbole-boucle voulu, qui tourne. Le plus composable.
- **(B) « États bouclables »** : un état n'est pas un instant `at N` mais une **plage** `[a..b]` qui boucle
  (ex. `marche` = frames 0..23 en boucle, `panique` = 24..47 en boucle). Pas besoin de sous-symboles ; tout
  vit dans une timeline. Plus simple à éditer (un seul plan de montage), mais moins « composable ».

Probablement **(A)** est le plus aligné avec « bibliothèque d'assets composables », mais **(B)** est peut-être
plus naturel pour un éditeur de timeline. À arbitrer.

## 5. Subtilités à creuser (Klem en attend — ne les balaie pas)

1. **Tous les états ne DOIVENT pas s'animer.** `voiture-top.crashe` = épave figée : c'est voulu. Donc le fix
   ne doit pas forcer toute pose à bouger. → opt-in ? (un état/instance déclare s'il boucle), ou bien « la
   pose s'applique mais l'instance garde sa timeline » par défaut, et figer devient un choix explicite.
2. **`clock` survit-il déjà au pin d'état ?** Une `expr` en `clock` (monotone) tourne peut-être PENDANT un
   état épinglé (contrairement à `frame`/`time` qui sont liés à la timeline). **À tester** : si oui, c'est un
   indice fort sur *comment* le pin fonctionne (il fige `frame`, pas `clock`) et une demi-échappatoire existante.
3. **Transitions d'état × boucles.** Pendant le cross-fade `transition` entre `marche` et `panique`, les deux
   boucles tournent et se mélangent en opacité. Phase ? Ça pique-t-il visuellement ? Faut-il aligner/realigner
   les phases ?
4. **Reset vs continuité de phase** au changement d'état : la boucle imbriquée repart-elle à la frame 0, ou
   continue-t-elle où elle en était ? (Gros impact sur le ressenti — une marche qui « saute » est moche.)
5. **Déterminisme & resume.** Le moteur EDU s'appuie sur `stepSim`/`render` déterministes (tests, perfcheck,
   `--render` fige). Des timelines imbriquées indépendantes = plusieurs horloges. Comment `--render --frame N`
   doit-il les traiter (les figer reste OK pour un PNG, mais à documenter) ?
6. **Éditeur (le vrai but).** Klem veut un éditeur où on **scrubbe/peaufine les keyframes**. Si les boucles
   imbriquées ont leur propre horloge indépendante du parent, comment l'éditeur les représente-t-il et les
   édite-t-il (scrub parent vs scrub enfant) ? Le modèle choisi doit rester **éditable à la main**, pas juste
   correct au runtime. C'est le critère n°1.
7. **Perf.** N timelines imbriquées qui tickent — surveiller (cf. le récent fix `applyExprChannels` 0.16.1 :
   l'éval par-frame est le hot path). Que ça ne ré-explose pas.
8. **Compat ascendante.** Des `.flat` existants comptent-ils sur le gel (improbable, le gel semble incident) ?
   Vérifier que voiture-top/bateau/baigneurs/transfo-claque rendent pareil.

## 6. Garde-fous
- **Non-régression visuelle** sur les `.flat` à états existants (voiture-top, transfo-claque) + les assets EDU
  (`flatink-edu/assets/animated/*.flat`).
- Le **harnais §3** doit, après fix, donner ✅ pour le `Parent`-avec-états (la boucle imbriquée tourne) **sans**
  casser le cas voiture-top voulu-figé (cf. subtilité 1).
- Cycle de release : build local + valider dans flatink-edu (`flatc` local, `assets.html`) avant de publier
  `@flatkit/*` (cf. `flatkit/CLAUDE.md`).

## 7. Honnêteté sur le périmètre
J'ai diagnostiqué un **comportement** (états gèlent les timelines imbriquées), pas le **mécanisme moteur**.
Commence par **localiser la cause** (comment le pin d'état propage la frame aux enfants — `engine/cel.ts`
`resolveLayerAt`/la résolution des `states` + l'instanciation des symboles), confirme avec le harnais, **puis**
choisis (A)/(B) avec Klem. L'objectif final n'est pas « débloquer l'imbrication » — c'est **rendre possible une
animation à états, bouclée, peaufinable à la main**. Conçois pour ça.
