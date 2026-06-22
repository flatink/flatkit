# Mini-suivi — `spring`/`smooth` : réagir au MOUVEMENT d'un param (pas seulement à sa VALEUR)

> Suite à `design-channel-modifiers-spike.md` (livré en 0.19.8 — merci, ça marche très bien pour le « ressort
> vers une valeur »). Petit manque découvert en câblant le cas-phare (le balancier de grue). Intention + repro +
> cause + pistes de fix. Court : c'est un seul verrou.

## 1. Le besoin (le cas-phare de la RFC)

Le balancier de grue : le câble **pend à la verticale au repos**, **swingue quand le chariot se déplace**
(`crochetX` change), puis **revient à la verticale**. C'est un pendule à **pivot mobile** : la physique dépend de
la **VITESSE** du pivot, pas de sa position. Or un `spring rotation "<cible>"` poursuit une **valeur** : il réagit à
la VALEUR de la cible, pas à son mouvement. Donc :
- `spring rotation "rad(0)"` → reste vertical mais ne bouge jamais (rien ne le perturbe).
- `spring rotation "rad((crochetX-0.5)*k)"` → penche selon la POSITION (lean permanent au repos) — pas ce qu'on veut.

Il manque un moyen de dire « réagis à **combien crochetX a bougé récemment** ».

## 2. La seule façon de le synthétiser aujourd'hui — et pourquoi elle est bloquée

Pattern classique : un suiveur lissé + le retard comme signal de vitesse.
```
group "Lag"      smooth x "clamp(crochetX,0,1)" k 0.16 { … }            # poursuit crochetX (en retard)
group "Suspente" spring rotation "rad(-(clamp(crochetX,0,1) - Lag.x) * 30)" stiffness 0.06 damping 0.22 { … }
```
`(crochetX - Lag.x)` = le retard = **0 au repos** (→ cible 0 → vertical ✓) et **≠ 0 pendant un déplacement**
(→ swing ✓). C'est correct sur le papier.

**Blocage** : dans un **symbole**, un cross-ref `Lag.x` dans l'expression-cible **ne résout PAS la valeur intégrée
par le modificateur** de `Lag` — il lit ~0 (la pose statique / base). Donc `(crochetX - Lag.x)` ≈ `crochetX`
(constant), la cible ne revient jamais à 0 → le câble part de travers et **ne revient pas à la verticale**, et il
n'y a aucune réaction au mouvement réel.

## 3. Repro

`flatink-edu/assets/animated/grue.flat` (groupe `PenduleLag` `smooth x` + `Suspente` `spring rotation` lisant
`PenduleLag.x`). Observé : repos NON vertical, jamais de retour ; le swing ne suit pas le mouvement de `crochetX`.
(Déduit aussi du source : `<Name>.x` rend la pose, pas la sortie du modificateur ; cf. l'identité par-instance des
items imbriqués déjà notée dans le spike §6.)

## 4. Pistes de fix (au choix — du plus ciblé au plus puissant)

1. **Cross-ref → valeur INTÉGRÉE** : qu'un `<Name>.<canal>` lise la **valeur live** (modificateur/transition)
   du frère, pas la pose statique — la même valeur que le renderer utilise. C'est le fix minimal du pattern
   ci-dessus. (Lié au plumbing « chemin d'instance » du spike §6, que vous avez déjà fait pour l'état keyé.)
2. ⭐ **Une primitive `velocity(expr)`** (delta par pas de `expr`, lissé) — alors plus besoin de helper ni de
   cross-ref : `spring rotation "rad(-velocity(crochetX) * gain)"`. C'est sans doute **le plus simple ET le plus
   réutilisable** (« réagis à la vitesse de X » : aiguilles, curseurs, leviers, ressorts d'inertie partout). Évite
   tout le plumbing d'identité de la piste 1.
3. (variante) un `changed(expr)` / dérivée exposée au contexte d'expr.

## 5. Portée / état actuel

- Aujourd'hui les modificateurs couvrent « réagir à une **valeur** » (super) ; il manque « réagir au **mouvement** ».
- En attendant, côté EDU : la physique réactive vit **dans l'activité** (`var`+`every frame`, où le cross-ref
  marche), et l'asset garde un *idle* d'ambiance. Pas bloquant — juste : le « feel réactif voyage avec l'asset »
  (l'argument n°1 de la RFC) reste partiel tant que ce verrou tient.
- Reco : **`velocity()` (piste 2)** si le coût est proche de la piste 1 — bénéfice bien plus large.
