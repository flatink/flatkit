# RFC — primitives STATEFUL (`smooth` / `spring`) dans les expressions de canal d'un symbole

> **Pour l'agent qui implémente dans flatkit.** Intention + repro + cause + proposition + sémantique + garde-fous.
> But : qu'un **asset (`.flat`) puisse porter son propre « feel » réactif** (un crochet qui balance quand on le
> déplace, une aiguille qui se cale, un curseur avec inertie) **sans** comportement de scène. Aujourd'hui c'est
> impossible côté symbole, et même un hack en `value` ne tourne pas dans le player normal.

---

## 1. L'intention / le symptôme

FlatInk a deux couches : les **symboles `.flat`** (dessin + timeline + **expressions de canal pures**) et la
**scène/activité `.flatink`** (comportement stateful : `var`, `every frame`, interactions). Un symbole est
**stateless** par design : un canal se lie à une expression pure de `time`/`frame`/params/`value`.

Problème : beaucoup d'assets réutilisables ont un **« feel » physique qui DOIT réagir à un paramètre piloté par
l'activité** — et ce feel est *stateful* (il intègre vitesse/position dans le temps) :
- une **grue** dont le crochet (`crochetX`) se déplace → le câble **balance** puis se cale (ressort) ;
- une **aiguille** de cadran qui rejoint sa valeur avec overshoot ;
- un **curseur / levier** avec inertie ; un liquide qui ballotte ; une antenne qui vibre.

Aujourd'hui ce ressort ne peut vivre **que dans la scène** (`var v; every frame { v = … }`). Conséquences :
1. **L'asset n'est pas autonome** : chaque activité qui pose la grue doit **re-câbler** le même ressort à la main.
   Le « feel » ne voyage pas avec l'asset — c'est l'inverse de l'intérêt d'une bibliothèque d'assets.
2. **La galerie/preview ne peut pas le montrer** : un aperçu instancie le symbole sans comportement de scène, donc
   le balancier est invisible → l'auteur ne peut pas régler/voir le ressort au moment où il dessine l'asset.

## 2. Repro (cas réel : la grue de chantier)

`assets/animated/grue.flat` expose `crochetX` (0→1, manipulable) : le chariot coulisse, le câble descend. On veut
le **bonus** : quand `crochetX` change, le câble part en arrière puis revient (pendule). Impossible dans le symbole.

Tentative (hack) — un canal auto-lissant via le nom réservé `value` :
```
group "Pendule" expr x "lerp(value, crochetX, 0.14)"   # poursuit la cible
group "Suspente" expr rotate "(crochetX - Pendule.x) * 75"   # le retard = le balancier
```
- ✅ compile (le cross-ref `Autre.x` passe), et **fonctionne si on appelle `stepSim()` à la main** (intégration frame
  par frame).
- ❌ **ne tourne PAS dans le player normal** (galerie `autoplay:true, input:false`) : le crochet bouge (setParam),
  mais le ressort reste plat → « rien ne se passe ».

## 3. La cause

Dans le player, la **simulation stateful n'est avancée que s'il y a des actions `onEnterFrame`** (≈
`chunk-MK5IIGCD.js`, la boucle `tick`) :
```js
const rootSim = this.doc.timeline?.onEnterFrame;
const symSims  = symTLs.filter(s => s.tl.onEnterFrame?.length);
if (rootSim?.length || symSims.length) { this.simActive = true; /* runActions(...) en pas de SIM_STEP */ }
else { this.simActive = false; }   // ← aucun pas de simu
```
Or :
- un **symbole `.flat` n'a pas de `var` / `every frame` / `onEnterFrame`** (couche comportement = scène uniquement ;
  aucune démo `.flat` n'en a) → `simActive` reste faux pour un asset seul ;
- les **expressions de canal `value`** ne sont pas intégrées par cette boucle (elles sont (ré)évaluées au rendu, sans
  garantie d'avance temporelle stable hors `stepSim`).

⇒ Il n'existe **aucun moyen, côté symbole, d'avoir un canal qui intègre dans le temps** de façon fiable dans tous
les contextes de lecture (preview, activité).

## 4. La proposition

Ajouter une **petite famille de fonctions STATEFUL** utilisables dans les expressions de canal, **intégrées une fois
par frame par le player** (pas gardées par `onEnterFrame` ni par `input`), avec un **état par (instance, site
d'appel)** :

```
smooth(target, k)                       # lisseur 1er ordre (lag exponentiel). état = valeur lissée.
spring(target, stiffness, damping)      # ressort 2e ordre (overshoot/oscillation). état = position + vitesse.
```

Exemples (dans le symbole, l'asset devient autonome) :
```
# le crochet balance quand crochetX change, puis se cale — DANS l'asset, zéro code de scène :
group "Suspente" expr rotate "(spring(crochetX, 0.08, 0.86) - crochetX) * 175"

# une aiguille qui rejoint sa valeur en douceur :
group "Aiguille" expr rotate "smooth(rad(valeur * 270), 0.18)"
```

(Optionnel, si peu coûteux) `velocity(expr)` = delta par frame d'une expression (pour dériver « ça bouge »),
et/ou `damp(value, target, k, dt)` framerate-correct façon Unity.

**Pourquoi des fonctions et pas un `var` de symbole** : c'est **déclaratif** (ça reste une liaison de canal, pas une
couche comportement dans le symbole), minimal à spécifier, et ça compose avec le reste des exprs. Le nom réservé
`value` (« valeur courante du canal ») montre que la notion d'état-par-canal existe déjà ; on la formalise proprement.

## 5. Sémantique / détails

- **État** : porté par le site d'appel, **par instance** (deux grues = deux ressorts indépendants). Persiste entre
  frames ; (ré)initialisé à `target` à la création de l'instance et sur un saut de timeline (`seek`/reset).
- **Avance** : une fois par frame de lecture, avec un `dt` (idéalement `SIM_STEP` fixe, comme la simu existante) →
  **indépendant du framerate** + déterministe pour une séquence de frames donnée. **Ne doit PAS** dépendre de
  `onEnterFrame`/`simActive` ni de `input` (sinon on retombe sur le bug actuel).
- **Accès aléatoire (`seek`, `--render`, planche-contact)** : pas d'intégration possible → **snap à `target`** (la
  pose de repos). Ainsi un rendu statique montre l'état stabilisé (pas un transitoire arbitraire), et la lecture
  live anime le ressort. (C'est le comportement attendu pour un preview/poster frame.)
- **Bornes** : `spring` borné (amortissement ∈ ]0,1[, clamp interne anti-runaway) — pure et ne peut pas diverger/hang.
- **Compat** : purement **additif** (nouvelles fonctions stdlib), aucun changement cassant. Marche aussi en scène.

## 6. Pourquoi dans le moteur (et pas en scène)

- **Assets autonomes** : le « feel » voyage avec le `.flat` → une bibliothèque d'assets *réutilisables* au sens fort
  (on les pose, ils réagissent), au lieu de re-câbler un ressort par activité.
- **Previewables** : la galerie `/assets.html` (et tout aperçu d'un symbole seul) montre enfin le balancier → on
  règle le ressort en dessinant l'asset.
- **Moins de boilerplate** côté activités ; **parité** avec Rive / After Effects, où un *spring*/*inertia* est un
  modificateur natif d'une propriété, pas un script.

## 7. Alternatives considérées

- **Scène `var` + `every frame`** (état actuel) : marche, mais l'asset n'est pas autonome ni previewable (cf. §1).
  Reste l'échappatoire pour de la logique complexe — `smooth`/`spring` ne la remplacent pas, ils couvrent le 90 %
  « feel physique d'un canal ».
- **`every frame` AU NIVEAU DU SYMBOLE** : ouvrirait toute la couche comportement dans les symboles — plus lourd à
  spécifier/sécuriser que deux fonctions déclaratives. À garder pour une RFC séparée si un besoin le justifie.

## 8. Garde-fous / résultat attendu

- Après : `expr rotate "(spring(crochetX, .08, .86) - crochetX) * 175"` dans `grue.flat` → le crochet balance en
  live (galerie + activité), **sans** code de scène ; en `--render`/contact il est au repos (snap).
- Aucune régression sur les assets sans ces fonctions (chemin inchangé). Pas de dépendance à `onEnterFrame`/`input`.
- Idéalement : `flatc --check` connaît `smooth`/`spring` (arité) comme les autres fns stdlib.
