# RFC — playback INDÉPENDANT par instance (façon MovieClip) : `loop` / `once` + surface DSL

> **Pour l'agent qui implémente dans flatkit.** Ceci n'est PAS un patch précis : c'est une **intention + un
> besoin + un test reproductible + des zones d'ombre à explorer**. Le demandeur (Klem) dit explicitement :
> « conçois le MODÈLE, ne te contente pas de débloquer le symptôme ». Diagnostic posé côté EDU (mesuré au vrai
> player), la cause moteur est localisée ci-dessous — mais à toi de choisir la bonne forme et de creuser les
> subtilités (déterminisme, fps-domain, éditeur) avant de coder.
>
> **Contexte** : c'est la suite directe de `rfc-states-vs-nested-loops.md` (déjà livré : un état épingle la
> POSE du parent mais laisse couler l'horloge des enfants → les sous-boucles tournent sous un état). Cette
> RFC-ci attaque le PALIER suivant, révélé à l'usage : **les sous-boucles restent esclaves de la longueur de
> boucle de leurs ancêtres.** On veut le modèle « MovieClip » de Flash : une horloge indépendante par instance.

---

## 1. L'intention (le pourquoi — lis ça en premier)

FlatInk-EDU construit une **bibliothèque d'assets animés `.flat`** (symboles tween) qu'on **compose** ensuite
en activités, et la direction produit est : **un animateur peaufine les boucles À LA MAIN, en keyframes, sans
scripting.** On a maintenant des « assets à états bouclables » (baigneur `marche`/`panique`, transfo `ok` avec
frémissement idle). À l'usage, **deux trous bloquants** sont apparus :

1. **Une sous-boucle est tronquée/réinitialisée par la longueur de boucle de TOUT ancêtre.** Si le symbole
   parent (ou l'activité hôte) a une timeline plus courte — ou non multiple — que la sous-boucle, le wrap de
   l'ancêtre **remet la sous-boucle à mi-cycle** → **« saut » visible**. On est obligés de bricoler les durées
   en **LCM** (parent = plus petit multiple commun de toutes les sous-boucles), ET ça **re-casse** dès qu'on
   compose l'asset dans une activité dont la timeline racine n'est pas, elle aussi, un multiple. Intenable.

2. **Pas d'animation « qui joue une fois puis s'arrête ».** Tout ce qui est imbriqué **boucle** (ou est figé en
   `singleFrame`). On n'a aucun moyen keyframe-natif de jouer un one-shot (un « plouf », une explosion, un
   claque qui se fige) qui s'arrête sur sa dernière image. Le seul contournement actuel = **détourner la
   transition d'un state-machine** (deux anchors début→fin, scrub une fois, tient à destination) — un hack, pas
   un modèle.

Le modèle juste existe déjà, c'est celui de **Flash** :

- **Graphic symbol** = *esclave de la timeline parente*. Sa frame dérive de la frame du parent → **tronqué** si
  le parent est plus court. Options : **Loop / Play Once / Single Frame** (+ first-frame offset).
- **MovieClip** = *horloge INDÉPENDANTE*. Son playhead est avancé par le **battement de cœur global du runtime**
  (les frames écoulées), **indépendamment de la longueur de la timeline parente**. Contrôlable par instance
  (`stop()`/`play()`/`gotoAndStop()`). Ne « joue » qu'au runtime (frame 1 figée en autoring).

**flatkit n'implémente aujourd'hui QUE le modèle Graphic.** On veut ajouter le modèle MovieClip (horloge
indépendante), ce qui règle (1) ET (2) d'un coup.

## 2. Le besoin concret (cas réels EDU)

1. **Le baigneur** (`flatink-edu/assets/animated/baigneurs.flat`, symbole `Baigneur`) : 2 sous-boucles
   `BaigneurMarche` (48f) + `BaigneurPanique` (32f), sélectionnées par état. Aujourd'hui on a dû mettre le
   parent à `timeline 24 96` (= LCM(48,32)) pour que ça ne saute pas. On veut **supprimer cette contrainte** :
   chaque sous-boucle doit tourner sur SA durée, peu importe la durée du parent ou de l'activité hôte.
2. **TransfoClaque** (même dossier) : idle `Fremissement` (36f) qui tourne dans l'état `ok`. Parent `24 90`,
   `90 % 36 = 18 ≠ 0` → même saut latent. Même besoin.
3. **One-shots** (à venir, très demandés) : éclaboussure, étincelles de réussite, « claque » du transfo qui
   grille et **reste grillé**. Besoin d'un mode **« joue une fois et tiens la dernière image »**.

## 3. Le comportement observé + la CAUSE (localisée dans le moteur)

Mesuré au vrai player (headless skia-canvas, `@flatkit/player` 0.17.3). Sur `Baigneur` réel :

| version du parent | pas-de-wrap (dernière frame visible → frame 0), MAD pixels | verdict |
|---|---|---|
| `timeline 24 24` (parent plus court que les enfants) | **2.285** = **7,1×** le pas médian (2,0× le plus gros pas interne) | ❌ saut |
| `timeline 24 96` (= LCM(48,32), stopgap) | **0.002** ≈ 0 | ✅ propre |

Les sous-boucles natives sont propres en isolé (couture marche 47→0 = `0.000`, panique 31→0 = `0.063`). **Le
saut ne vient donc PAS des keyframes** : il vient de la subordination de l'horloge enfant au wrap du parent.

**La cause, localisée :**

- `packages/engine/src/timeline.ts` — `resolveInstanceFrame()` calcule la frame imbriquée par
  `((parentFrame % dur) + dur) % dur`, et **`independent` est stubbé sur `synced`** :
  ```ts
  if (pb?.mode === 'singleFrame') return pb.frame ?? 0
  // 'synced' and 'independent' (V1 = like synced): loop within [0, duration), graphic-symbol style.
  const dur = Math.max(1, symbolDuration)
  return ((parentFrame % dur) + dur) % dur
  ```
- `packages/engine/src/params.ts` — `instanceFrames()` passe `parentClock` (l'horloge avancée transmise par
  le scope du dessus) à `resolveInstanceFrame`. Or au root, cette horloge = `this.frame` **BOUCLÉE**.
- `packages/player/src/drawScene.ts` — au render racine (≈ L957) on passe `this.frame` (le playhead bouclé)
  sans `clockFrame` ; `clockOf()` (≈ L397) = `rctx.clockFrame ?? frame` → **les enfants ridebnt la frame
  bouclée de l'ancêtre**. Le pin d'état laisse couler cette horloge (acquis de la RFC précédente), mais elle
  est déjà wrappée par la durée de l'ancêtre.
- `packages/player/src/player.ts` — un **battement monotone existe déjà** : `this.mono` (L183), accumulé
  AVANT le wrap (L1089 en `stepSim`, L1176 en rAF), **jamais bouclé**. Mais il n'alimente QUE `expr clock`
  (L731 : `clock: this.mono / this.fps`). **Il n'est pas câblé aux instances imbriquées.** ← c'est la pièce
  manquante : l'horloge MovieClip existe, on ne la branche simplement pas.
- `packages/engine/src/flatFormat.ts` — le parser d'`instance` (≈ L1337-1344) ne lit **aucun** champ
  `playback` (ni `loop`, ni `once`, ni `synced`, ni first-frame). **Le DSL `.flat` n'expose pas le mode** →
  tout asset est forcément Graphic/synced. (`PlaybackMode = 'synced' | 'singleFrame' | 'independent'` et
  `loop?: boolean` « reserved » existent côté types, `packages/types/src/index.ts` ≈ L146-151, mais inertes.)

### Le test, à reproduire tel quel

`.flat` minimal (`/tmp/repro.flat`) — un parent **plus court** que sa sous-boucle. ⚠ NB : on prend une
**translation** (mouvement asymétrique), PAS une rotation de carré — un carré a une symétrie à 90°, donc
frame 23 (~172°) ressemblerait à frame 0 et masquerait le saut (vérifié : ça donne un faux « clean »).
```
symbol "Slide" {                 // boucle 48f : va à droite (cel 24) puis revient (cel 48 = cel 0)
  timeline 24 48
  layer "c" {
    group "g" at 0,0 pivot 0,0 { layer "c" { circle 0 0 8 fill #c9874a } }
    cel 0  tween ease linear { pose "g" at -20,0 }
    cel 24 tween ease linear { pose "g" at  20,0 }
    cel 48 tween ease linear { pose "g" at -20,0 }
  }
}
symbol "ShortParent" {           // dur 24 < 48 : aujourd'hui ça tronque Slide et ça saute au wrap
  timeline 24 24
  layer "c" { instance "Slide" as "s" }
}
```
Compile le preview : `flatc /tmp/repro.flat --preview --symbol ShortParent -o /tmp/repro.flatpack`
(le doc racine a alors `durationFrames = 24` et une instance `synced` `preview_instance`).

Harnais (Node, depuis un repo avec `@flatkit/player` + `skia-canvas` ; mesure le **pas de wrap** = la
discontinuité visible à la couture de boucle) :
```js
import { Canvas, Image, Path2D } from 'skia-canvas'
import { readFileSync } from 'node:fs'
globalThis.Path2D = Path2D; globalThis.Image = Image; globalThis.devicePixelRatio = 1
globalThis.window = { devicePixelRatio: 1, addEventListener(){}, removeEventListener(){}, requestAnimationFrame:()=>0, cancelAnimationFrame(){} }
globalThis.requestAnimationFrame = ()=>0; globalThis.cancelAnimationFrame = ()=>{}
const doc = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const { FlatPlayer } = await import('@flatkit/player')
const w = doc.width, h = doc.height
const c = new Canvas(w, h); c.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h })
const p = new FlatPlayer(c, doc, { autoplay: false, input: false, audio: false })
const ctx = c.getContext('2d'), dur = doc.timeline.durationFrames
const px = f => { p.seek(f); p.render(); return Uint8ClampedArray.from(ctx.getImageData(0,0,w,h).data) }
const mad = (a,b) => { let s=0; for (let i=0;i<a.length;i++) s+=Math.abs(a[i]-b[i]); return s/a.length }
const F = []; for (let f=0; f<dur; f++) F.push(px(f))
const steps = []; for (let f=1; f<dur; f++) steps.push(mad(F[f],F[f-1]))
const wrap = mad(F[dur-1], F[0]); steps.push(wrap)
const med = [...steps].sort((a,b)=>a-b)[Math.floor(steps.length/2)] || 1
console.log(`wrap MAD=${wrap.toFixed(3)} = ${(wrap/med).toFixed(1)}x median → ${wrap > 2.5*med ? '❌ JUMP' : '✅ clean'}`)
```
**Attendu aujourd'hui** : `❌ JUMP` (mesuré : wrap MAD ≈ 10.4 = **7,5×** le pas médian). Slide ne va que de
x=-20 à x≈+18,3 (frame 23) puis **snap à -20**, n'atteint jamais le retour +20→-20 (frames 24→48) qui recoud
la boucle. C'est le bug. (Le `--render` NE convient pas : il fige les instances — seul le player les anime.)

## 4. Ce qu'on veut (résultat, pas implémentation imposée)

Un **mode de playback par instance imbriquée**, calqué sur Flash, choisissable en keyframes (DSL) :

| mode | horloge | comportement | usage |
|---|---|---|---|
| `synced` *(défaut actuel, inchangé)* | frame de l'ancêtre | Graphic : scrubbé/tronqué par le parent | lip-sync, scrub éditeur, déterminisme |
| `independent` (alias `loop`) | **monotone (`mono`)** | MovieClip : boucle sur SA durée, **immunisé contre le wrap de TOUT ancêtre** | états-boucles, idles |
| `once` | **monotone, CLAMPÉ** `[0, dur-1]` | joue **une fois puis TIENT** la dernière frame | one-shots (plouf, explosion, claque figée) |
| `singleFrame` *(déjà là)* | — | figé sur une frame | pose morte |

**Critères d'acceptation :**
- Le test §3, avec l'instance passée en `independent` (nouvelle syntaxe DSL), doit donner **`✅ clean`**
  **alors que `ShortParent` reste en `timeline 24 24`** — c.-à-d. Slide traverse son cycle complet (va jusqu'à
  x=+20 PUIS revient à -20) et boucle proprement, **sans** dépendre de la durée du parent ni d'un LCM.
- En `once` : la sous-boucle joue 0→dur **une seule fois** puis reste sur la dernière image, **à travers
  plusieurs wraps** de l'ancêtre court (vérifiable : après mono ≫ dur, l'image est stable = la dernière frame).
- `synced` et `singleFrame` rendent **exactement comme avant** (non-régression, cf. §6).
- Surface DSL : un `.flat` doit pouvoir déclarer le mode, p.ex. `instance "Slide" as "s" loop` /
  `... once` / `... synced` (ou un attribut `playback independent` — à toi de choisir l'idiome le plus propre
  et round-trip-safe dans `flatFormat.ts` ; aujourd'hui le parser d'`instance` ne lit rien de tout ça).

L'infra est déjà là : `mono` existe et est déterministe. Le cœur du fix = **transmettre une horloge monotone
(au lieu de la frame bouclée) aux instances `independent`/`once`**, et que `resolveInstanceFrame` boucle (resp.
clampe) sur la durée propre de l'enfant.

## 5. Subtilités à creuser (Klem en attend — ne les balaie pas)

1. **Quelle horloge monotone descend, exactement ?** `mono` est au root. Pour une instance à 3 niveaux de
   profondeur dont un ancêtre est `synced` et un autre `independent`, quelle valeur ride l'enfant ? Probable :
   un `independent` REBASE l'horloge sur le mono global (il ignore l'ancêtre), un `synced` continue de suivre la
   frame de son parent. Définis proprement la composition (et ce que `clockFrame` porte le long de la
   descente : aujourd'hui `clockOf = rctx.clockFrame ?? frame`).
2. **Déterminisme & `--render`.** Une horloge indépendante = plusieurs playheads. Définis la phase d'un clip
   `independent` comme `mono mod dur` (et `once` = `min(mono, dur-1)`), avec **départ canonique à 0** → reste
   reproductible. `--render --frame N` doit poser une base claire (p.ex. `mono = N`) et documenter que les
   clips indépendants rendent à `N mod dur` (les figer reste OK pour un PNG, mais sois explicite). Les tests
   golden/`stepSim` doivent rester déterministes.
3. **Domaine de fps.** `mono` est en frames root-fps (`+= SIM_STEP*fps`). Si un sous-symbole a un `fps`
   différent du root, le `mod dur` doit se faire dans le **bon domaine** (cf. `subFps` déjà utilisé dans
   drawScene). Chez EDU tout est en 24, mais conçois-le correctement (un clip 12fps ne doit pas tourner 2× trop
   vite).
4. **Phase au changement d'état / à l'apparition.** Avec `mono`, une sous-boucle ne se réinitialise jamais (la
   phase est continue) — c'est voulu (« une marche qui saute est moche »). Mais pour `once`, le « début » est
   QUAND ? Si un état devient visible à mi-course, le one-shot doit-il (re)partir de 0 à ce moment, ou est-il
   ancré à mono global ? → il faut sans doute une notion de **start-frame / phase-offset par instance** (le
   first-frame de Flash), ou un re-trigger explicite. Tranche, et dis comment ça s'édite.
5. **Contrôle par-instance (parité MovieClip complète — peut être un palier 2).** Flash a `stop()`/`play()`/
   `gotoAndStop()` PAR clip ; nos actions (`actions.ts`) n'ont que `play`/`pause`/`gotoFrame` sur le **playhead
   racine** (`pause` est global). Faut-il un verbe d'action ciblant une instance (ré-armer un `once`, stopper
   une boucle) ? Pas requis pour `loop`/`once` en keyframes, mais dis si ton modèle le permet proprement plus
   tard (p.ex. via `setParam`/un canal de playback) ou si ça force une refonte.
6. **Éditeur (le vrai but).** Klem veut scrubber/peaufiner les keyframes. Un clip `independent` a une horloge
   propre : comment l'éditeur le scrub-t-il (scrub parent vs scrub enfant) ? Le `freezeNested` actuel (éditeur =
   nested figé sur frame 0, runtime = joue) est sans doute le bon défaut d'autoring (= Flash, MovieClip figé en
   autoring). Confirme que le modèle reste éditable à la main, pas juste correct au runtime.
7. **Perf.** N horloges qui tickent + un `mod` par instance/frame — surveille le hot path (cf. fix
   `applyExprChannels` 0.16.1). Que ça ne ré-explose pas.
8. **Compat ascendante.** `synced` reste le défaut (playback absent) → tous les `.flat` existants inchangés.
   Vérifie qu'aucun asset EDU ne comptait sur la troncature (improbable, c'est le bug qu'on corrige).

## 6. Garde-fous
- **Non-régression visuelle** : `voiture-top`, `transfo-claque`, `bateau`, et tous les
  `flatink-edu/assets/animated/*.flat` rendent pareil en `synced` (le défaut). Golden/`stepSim` au vert.
- Le **test §3 passé en `independent`** doit donner ✅ **avec le parent court** (sans LCM), et `once` doit
  tenir sa dernière image à travers les wraps.
- Cycle de release : build local + valider dans flatink-edu (`flatc` local, `assets.html` dans le navigateur =
  le vrai juge) AVANT de publier `@flatkit/*` (cf. `flatkit/CLAUDE.md`). Après release, EDU pourra **retirer le
  stopgap LCM** : `Baigneur` repassera à une durée minimale + ses sous-instances en `loop`, et `TransfoClaque`
  idem (au lieu de `24 90`/`24 108`).

## 7. Honnêteté sur le périmètre
J'ai localisé la **cause** (les instances imbriquées ride la frame BOUCLÉE de l'ancêtre via
`resolveInstanceFrame`, et `independent`+`mono` ne sont pas câblés ; le DSL n'expose pas le mode), pas imposé le
**mécanisme**. Commence par **reproduire** le saut (test §3), **confirme** que `mono` est la bonne source
d'horloge, **puis** conçois les modes `independent`/`once` + leur surface DSL + le déterminisme `--render`.
L'objectif final n'est pas « débrancher le wrap » — c'est **le modèle MovieClip de Flash : une horloge
indépendante par instance, peaufinable à la main**, pour des assets vraiment composables.
