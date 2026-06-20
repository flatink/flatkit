# RFC — 2 améliorations : render du `pointermove` coalescé + lecture IMAGE-PAR-IMAGE (cels sans `tween`)

> Pour l'agent flatkit. Deux gains **indépendants**, repérés côté flatink-edu.
> #1 = un vrai bug perf (lag souris, croisé 2×). #2 = une **capacité manquante** : l'animation image-par-image
> (cels non interpolées) ne joue pas — elle gèle. Diagnostic côté **comportement** — à toi le mécanisme exact.

---

## 1. Perf — `onPointerMove` re-render à CHAQUE événement (le lag souris)

**Symptôme** (rapporté 2×, dont l'activité `voyage-bouchee`) : la scène est **fluide au repos**, mais
**bouger la souris n'importe où sur la scène fait ramer fort** (« de ouf »).

**Origine** — `packages/player/src/player.ts`, `onPointerMove`. À **chaque** `pointermove`, inconditionnellement :
- `bustNamed()` (l.460) → met `ctxCache = null` → le render suivant **reconstruit tout le contexte d'expressions** ;
- `hitChains(this.doc, this.frame, this.exprCtx(), p)` (l.473) → hit-test (et `exprCtx()` rebuild le ctx qu'on vient de buster) ;
- `this.render()` (l.483) → **render complet SYNCHRONE**.

**Aucun coalescing** (pas de dirty-flag / rAF-schedule — vérifié : `grep needsRender|dirty|scheduleRender` = vide)
→ **1 render complet par événement**.

**Ce n'est PAS la scène.** `voyage-bouchee` est ultra-léger : render mesuré **~3,6 ms / ~290 fps** (headless, même
à l'état de fin), et **0 objet bindé à `mouse.*`**. Le coût est donc dans le **handling d'input** : `pointermove`
tire à **125–1000 Hz** (souris/trackpad), chaque event force un render + une reconstruction du ctx d'expressions,
**en plus** de la boucle rAF qui rend déjà à 60 fps → le main thread sature. (Bonus absurde ici : `bustNamed()`
invalide tout le cache alors que rien ne binde `mouse.*` → pur gâchis.)

**Fix proposé — coalescer le render du move :**
- si la boucle de lecture (rAF) tourne déjà → **ne pas** render en synchrone (elle rendra le prochain frame, et
  `bustNamed` a déjà invalidé le cache donc ce frame reflétera la souris) ;
- sinon (scène statique, pas de rAF) → planifier **UN** render via `requestAnimationFrame` (dirty-flag), pas un par event ;
- (optionnel) ne `bustNamed()` / `hitChains()` que si utile : si **aucun** objet ne binde `mouse.*` ET aucun handler
  hover/cursor, un move ne nécessite ni ré-éval ni hit-test.

**Subtilités à garder :**
- Il FAUT quand même refléter la souris à ~60 fps pour les objets bindés `mouse.*` (viseur, drag-suit) et le
  hover/cursor → **coalescer, pas supprimer**.
- Tactile / 1er event : pas de rAF préalable → le 1er move doit déclencher un render planifié.
- `grabbed` (drag actif, l.463-471) a déjà son `render()` + `return` : la coalescence ne doit pas dégrader la
  latence d'un drag en cours (peut rester synchrone — à arbitrer).
- Le curseur (`canvas.style.cursor`, l.475) peut rester synchrone (négligeable) même si le render est coalescé.

---

## 2. Modèle — supporter l'animation IMAGE-PAR-IMAGE (cels sans `tween`)

**Le constat** : aujourd'hui un symbole avec plusieurs cels MAIS sans `tween` (et sans `states`) **ne joue pas
image-par-image — il gèle sur la 1ʳᵉ cel**. Vérifié au vrai player : des cels aux valeurs différentes (`cel 0
glow 0.22` … `cel 9 glow 0.5` …), mais frame 2 == frame 11 → aucune lecture. Il faut `tween` partout pour obtenir
ne serait-ce qu'un pas.

**Or l'image-par-image / « stepped » est un style légitime** (chaque cel = une image **tenue**, snap à la
suivante, boucle — le rendu « on 2s », pas de lissage). Le geler n'est pas un garde-fou, c'est une **capacité
manquante**.

**Fix proposé** : un symbole **SANS `states`** joue sa timeline ; à la frame F, la pose = **la dernière cel ≤ F,
tenue** (stepped), et on **n'interpole que vers une cel `tween`**. Donc :
- cels avec `tween` → lecture lissée (déjà le cas) ;
- cels sans `tween` → lecture **image-par-image** (tenue + snap) — **au lieu de geler**.

→ l'animateur **choisit** : `tween` = smooth, pas de `tween` = stepped/snappy. Les deux 100 % keyframes.

**Compat** : un symbole **AVEC `states`** reste piloté par l'état (épinglé sur la frame de l'état), **pas
d'auto-play** → `voiture-top` & co inchangés. Le distingueur = présence de `states`.

(Ça rend le « warning » que j'avais d'abord proposé inutile : le symbole **anime** — en stepped — au lieu de
geler ; s'il le voulait smooth, l'animateur ajoute `tween` en voyant le saccadé. NB : EDU **préfère**
stylistiquement le tween de symboles, mais l'engine doit **supporter** les deux.)

---

## Honnêteté sur le périmètre
J'observe le **comportement** (côté player), pas le détail moteur. Pour **#1**, le coalescing touche le hot path
d'input → garde les tests player verts (`playerDrag`/`playerFeedback`) et vérifie la latence du drag actif + les
objets `mouse.*`-bindés. Pour **#2**, c'est la **résolution de cel au playback** (engine) : tenir la dernière
cel ≤ F même sans `tween` ; garde-fous = les `states` restent épinglées (voiture-top intact) + non-régression
visuelle sur les `.flat` tweenés existants (bateau, baigneurs…). Les deux sont indépendants — fais-les séparément si tu veux.
