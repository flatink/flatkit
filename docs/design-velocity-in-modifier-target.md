# Design spike — `velocity()` dans une cible de modificateur (réagir au MOUVEMENT)

> **Statut : IMPLÉMENTÉ.** `velocity(expr)` valide uniquement dans une cible de `spring`/`smooth`, résolu par la
> passe d'avance (état possédé par le binding, séparé `velocityState` keyé par instance), par seconde (dt =
> pas × SIM_STEP), 0 au repos/render/seek. `expr.ts` intact (velocity injecté dans le ctx). Lint : connu en
> cible, **signalé hors cible**. Doc auteur : `animating-symbols.md`.

> Suite à `followup-modifiers-react-to-velocity.md` (besoin : un canal qui réagit à la **vitesse** d'un param,
> pas à sa valeur — le balancier de grue à pivot mobile). Option B validée (edu) : `velocity()` **résolu par la
> passe d'avance du modificateur** (état possédé par le binding), **pas** une fonction stdlib pure (= le piège
> « B-func » sans identité de site, écarté). Ce doc fixe la sémantique, le mécanisme advance↔render, le coût.

## 1. Surface d'auteur (validée)
`velocity(<expr>)` valide **uniquement dans une cible de `spring`/`smooth`** (lint l'exige). Composable.
```
# .flat
group "Suspente" spring rotation "rad(-velocity(crochetX) * 40)" stiffness 0.06 damping 0.22 { … }
# .flatink
object "Hero" { spring rotationDeg = -velocity(crochetX) * 40 { stiffness 0.06 damping 0.22 } }
```
Composable (≠ un `kind: sway` figé) : `"rad(-velocity(crochetX)*40 + 2*sin(time))"` (balancier réactif + idle).

## 2. Sémantique
- `velocity(x) = (x - prev) / dt` — `prev` = valeur de `x` au tick précédent ; `dt` = temps réel avancé ce tick.
- **Repos** (`x` constant) → `velocity 0` → cible 0 → câble **vertical automatiquement** (plus de lean, plus de
  helper/cross-ref). C'est la propriété qui règle le cas-phare.
- **Accès aléatoire** (seek / `--render` / contact) → pas d'avance → `velocity 0` → **snap = repos = vertical** →
  cohérent avec la sémantique d'accès aléatoire existante.
- **Init** (création / seek) → `prev = x courant` → `velocity 0` au 1er pas (aucun à-coup au load).

## 3. Où vit l'état
`ModState` étendu : `{ pos, vel, prev?: number[] }`. `prev[i]` = valeur précédente du **i-ème** `velocity()` de la
cible (ordre d'évaluation — stable car l'AST est fixe). **Keyé par (chemin d'instance, canal)** comme `pos`/`vel`
→ multi-grue correct **d'office** (pas d'ambiguïté de nom, pas de cross-ref).

## 4. Le point clé : advance ↔ render, SANS toucher `expr.ts`
`velocity` n'est PAS dans `MATH_CTX` (sinon fonction pure = B-func). C'est une fonction **injectée dans le contexte
d'éval**, que `resolveName` consulte déjà (`expr.ts` regarde `ctx` avant `base`) → **zéro changement à `expr.ts`**.

- `ResolveOpts` gagne `velocityFor?: (key: string, ch: ExprChannel) => (arg: number) => number`.
- `cel.ts` (branche modificateur, ~3 lignes) : `evalCtx.velocity = (id !== undefined && opts.velocityFor?.(stateKey, c)) || ZERO_VEL` avant d'évaluer la cible. (`ZERO_VEL = () => 0`.)
- **ADVANCE** : le player fournit `velocityFor`, lié à `channelState[key].prev`. La closure retournée gère un
  **compteur d'occurrence** interne (`i`) ; à chaque appel : `v = (arg - (prev[i] ?? arg)) / dt ; prev[i] = arg ; i++ ; return v`. La passe d'avance évalue donc la cible **avec** `velocityFor` → la valeur intégrée poursuit la vraie vitesse.
- **RENDER / SNAP** : `velocityFor` absent → `velocity = () => 0`. (Au render live la cible n'est de toute façon pas
  utilisée — on lit `pos` intégré ; elle ne sert qu'au snap, où `velocity 0` = repos.)

Conséquence : la pureté du render est préservée (velocity=0), l'état reste possédé par le binding (identité stable),
et le seul code « stateful » est la closure d'avance — exactement l'invariant de la conception d'origine.

## 5. `dt` : par seconde (tranché)
`velocity = (arg - prev) / (steps × SIM_STEP)` où `steps` = pas fixes consommés ce tick. **Par seconde** → gains
lisibles (`* 40`, pas `* 4000`), **déterministe** (la séquence de `steps` est déterminée par la suite de frames ;
headless `stepSim(N)` → `dt = N × SIM_STEP`). L'alternative par-pas (`arg - prev`) est plus simple mais les gains
deviennent minuscules → on garde **par seconde**.

## 6. Touch points & coût
| Zone | Changement | Taille |
|---|---|---|
| `types` | `ModState.prev?` ; `ResolveOpts.velocityFor?` | minime |
| `engine/expr.ts` | **rien** (velocity via le ctx) | 0 |
| `engine/cel.ts` | injecter `evalCtx.velocity` dans la branche modificateur | ~3 lignes |
| `player.ts` | construire `velocityFor` (closure sur `channelState[key].prev`, compteur, `dt`), le passer à la passe d'avance ; absent au render | le vrai travail |
| `drawScene` (`collectModifierTargets`) | fileter `velocityFor` dans les opts de `resolveLayerAt` | petit |
| `dsl`/`flatFormat` | `velocity` parse déjà comme un call (cible = string) → transparent | ~0 |
| `lint` | `velocity` arité 1 ; **erreur si hors cible de modificateur** ; le target reste un `exprSite` | petit |
| tests | kernel (repos=0, suit une vitesse), advance (arg changeant → swing), render/seek=0, multi-instance, déterminisme, init sans à-coup | — |

**Coût : Moyen** (comparable au wiring modificateur initial). Le seul neuf : `velocityFor` injecté + compteur
d'occurrence + petit reroutage de l'avance. **Risque : faible** — `expr.ts` intact, render pur, état keyé par
instance comme le reste, snap-au-repos gratuit.

## 7. Limites
- `velocity()` **seulement dans une cible de modificateur** (lint l'exige) — ailleurs (expr pure) ça n'a pas de
  passe stateful, donc 0/erreur.
- Argument arbitraire OK (`velocity(crochetX)`, `velocity(Hero.x)`…) — on dérive la valeur évaluée.
- N occurrences de `velocity()` par cible supportées (un slot `prev[i]` chacune).
- Pas d'`each "Sym" as i` (cohérent avec la limite modificateur existante).
