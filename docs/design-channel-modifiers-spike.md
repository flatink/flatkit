# Design spike — modificateurs de canal STATEFUL (`smooth` / `spring`) — option B

> **Statut : IMPLÉMENTÉ (option B, keying v2 par chemin d'instance).** Livré : modèle + format `.flat`
> (`spring`/`smooth`, sucre `rotate`/`rotationDeg`), noyau d'intégration pur borné, résolution moteur
> (snap en accès aléatoire), avance player non gardée par `onEnterFrame` (tick + `stepSim`, vidée au seek),
> et lint `flatc --check` du `target`. Le keying par chemin (§6) a été fait d'emblée → deux instances d'un
> symbole à modificateur interne sont indépendantes, sans refactor du hot path. Doc auteur :
> `animating-symbols.md`. La forme de binding `.flatink` (scène) reste à faire si un besoin scène-side surgit.

> Réponse de conception à `rfc-stateful-spring-smooth-channels.md`. Compare-toi à la RFC : même
> résultat utilisateur (un asset qui porte son « feel » réactif), mais l'état est **explicite** (un
> binding déclaré), pas caché dans une expression « pure ». But du doc : donner le **vrai coût** avant
> de s'engager, et exposer le seul point dur (identité par-instance des items imbriqués).

## 0. Principe

Un canal peut être piloté par, au choix : une **expression pure** (aujourd'hui) OU un **modificateur
stateful** qui intègre dans le temps vers une cible. Le modificateur EST le site d'appel → identité d'état
triviale. Les expressions restent pures (`expr.ts` **intouché** — c'est tout l'intérêt vs la RFC littérale).

## 1. Modèle de données — additif

On **n'élargit pas** `expressions: Partial<Record<ExprChannel, string>>` (toucherait tous les lecteurs).
On ajoute un champ **frère**, optionnel, qui laisse l'existant inchangé :

```ts
// packages/types/src/index.ts
export type ChannelModifier =
  | { kind: 'smooth'; target: string; k: number }                          // lag 1er ordre
  | { kind: 'spring'; target: string; stiffness: number; damping: number } // ressort 2e ordre

// sur TimelineTrack ET sur les items poseables (Instance/Group/Text/Image) :
modifiers?: Partial<Record<ExprChannel, ChannelModifier>>
```

`target` est une **expression normale** (donc lint/`--check` la valident exactement comme une expr).
Un canal a soit une `expression`, soit un `modifier` (le modifier gagne, comme une expr gagne sur les keyframes).

## 2. Syntaxe d'auteur

`.flat` (forme primaire — l'asset autonome), à côté de `expr <ch> "<e>"` :
```
spring  rotate "crochetX"          stiffness 0.08 damping 0.86
smooth  rotate "rad(valeur * 270)" k 0.18
```
Parse/serialize : les 2 mêmes sites que `expr` aujourd'hui — `poseAttrs` (`flatFormat.ts:~1489`) et
`printPoseAttrs` (`flatFormat.ts:~113`). Round-trip testé au niveau modèle.

`.flatink` (scène, secondaire — peut venir en v2) : une forme de binding `spring rotation = crochetX { … }`
dans le cas default du parser de bindings (`dsl.ts:~1118`).

## 3. Sémantique d'évaluation

État par modificateur : `{ pos: number; vel: number }` (smooth n'utilise que `pos`). Pas fixe = `SIM_STEP`
(1/60, `player.ts:132`). Intégration par pas (semi-implicite Euler, **bornée** → ne diverge pas, RFC §5) :

```
smooth: pos += (target - pos) * k                 // k ∈ ]0,1]
spring: vel += (target - pos)*stiffness - vel*damping ; pos += vel   // damping ∈ ]0,1[, clamp anti-runaway
```

- **Init / repos** : à la création de l'instance et sur seek/reset → `pos = target`, `vel = 0`.
- **Accès aléatoire** (seek, scrub, `--render`, planche-contact) : **aucune intégration** → le canal vaut
  `target` évalué à cette frame = la **pose de repos** (= état non présent ⇒ on évalue la cible). RFC §5.
- **Lecture live** : la boucle d'avance (§4) met à jour `pos` ; le canal résout vers `pos`.

`target` s'évalue dans le **contexte de l'instance** (le même `self`/params/`time` qu'une expr de canal
aujourd'hui), via `evalExpr` **inchangé**.

## 4. La boucle d'avance — le seul chemin neuf (et il NE doit PAS être gardé par `onEnterFrame`)

C'est le cœur du correctif de la RFC §3. Aujourd'hui la sim est gardée par `onEnterFrame`
(`player.ts:1196-1212`). On ajoute une avance **indépendante** :

- Au load, calculer `hasChannelModifiers` (un asset seul l'active → plus de dépendance à `onEnterFrame`/`input`).
- Dans le tick live (`player.ts:1174-1223`), quantifier `dt` en pas entiers avec le `simSteps` **existant**
  (`player.ts:157`, même horloge fixe que la sim) ; pour chaque pas, pour chaque item à modificateur actif :
  éval `target` → intègre → stocke.
- `stepSim(n)` (headless `--play`, `--render --steps N`) : avance aussi les modificateurs n pas → le ressort
  se déroule de façon **déterministe et testable** (assert `pos` exact après N pas, comme
  `playerDrag.test.ts:547` pour les accumulateurs `onEnterFrame`).
- `seek` (`player.ts:1072`) / load (`player.ts:615`) : **vide** l'état → la prochaine résolution snap au repos.

Lecture de la valeur intégrée au moment du rendu : un callback `channelValueFor(key, ch)` fileté dans
`ResolveOpts`, **calqué sur `itemState`** (`cel.ts:~355`, `player.ts:957`, `drawScene.ts:455`).

## 5. Déterminisme & `--check`

- Intégration à pas fixe quantifiée par `simSteps` → indépendante du framerate, reproductible pour une
  séquence de frames donnée. Même garantie que la sim existante. Seek → cible exacte. `stepSim(N)` → `pos` exact.
- `flatc --check` : valide `target` comme expression (gratuit — c'est un `exprSite` → `analyzeExpr`), plus
  presence/typage des params (`k`, `stiffness` numériques ; `damping ∈ ]0,1[`). Petit ajout `lint.ts`/`dsl.ts`.

## 6. ⚠️ LE POINT DUR — identité par-instance des items IMBRIQUÉS

La récursion de rendu passe l'**`item.id` brut de la définition** (`cel.ts:92` → `body.id`) et repasse le
même callback sans composer de chemin (`drawScene.ts:455`). Conséquence :

- Modificateur sur une **instance top-level** (la grue posée directement dans la scène) → `item.id` unique
  dans le doc → **deux grues = deux ressorts. ✓**
- Modificateur sur un item **imbriqué dans le symbole** (l'exemple RFC : `group "Suspente"` *dans* grue.flat),
  symbole instancié 2× → l'id interne est partagé entre les 2 rendus → **état partagé entre les deux grues. ✗**

L'exemple-phare de la RFC tombe dans le cas ✗. (Cette limite existe **déjà** pour `self.hovered/grabbed` sur
items imbriqués ; elle est juste sans gravité pour l'interaction, et critique pour un ressort.) Deux issues :

- **v1 — accepter la limite** : modificateurs corrects pour les instances top-level et les symboles
  instanciés une fois ; documenter que des instances sœurs d'un symbole à modificateur interne partagent
  l'état. Coût : **0** plumbing. Suffisant si on pose rarement le même asset animé en double.
- **v2 — fileter un chemin d'instance** comme clé d'état : composer `path = parentPath + '/' + instanceId`
  dans la récursion (`drawScene.ts:455`) et keyer l'état par `path + '/' + item.id`. Corrige aussi la même
  faiblesse pour `itemState`/`paramsFor` (bonus). **Ce plumbing est partagé avec l'option A** (les `var`
  par-instance de A ont le problème identique) — ce n'est donc pas un argument A vs B.

## 7. Liste de changements (coût honnête)

| Fichier | Changement | Note |
|---|---|---|
| `types/index.ts` | `ChannelModifier` + champ `modifiers?` (track + items poseables) | additif, non cassant |
| `engine/flatFormat.ts` | parse `smooth`/`spring` (`~1489`) + serialize (`~113`) + round-trip test | 2 sites |
| `engine/cel.ts` (+`timeline.ts`) | à la résolution d'un canal : si modifier → lire la valeur intégrée via le callback ; sinon (accès aléatoire) éval `target` | miroir d'`itemState` |
| `engine/expr.ts` | **rien** | pureté préservée |
| `player.ts` | map `channelState` (calquée sur `paramRt:249`) ; `advanceChannelModifiers(steps)` ; appelée **non-gardée** dans le tick + dans `stepSim` ; vidée sur seek/load ; `channelValueFor` fileté dans les opts de rendu | le vrai travail |
| `compiler` | `dsl.ts` forme de binding `.flatink` (v2, optionnel) ; `lint.ts` validation params | petit |
| *(v2 imbriqué)* | chemin d'instance composé dans la récursion comme clé d'état | **partagé avec A** |

**Effort : Moyen** (v1 top-level) → **Moyen-élevé** (v2 imbriqué correct). **Risque : faible** — `expr.ts`
intact, le modèle d'état reprend `paramRt`, les types sont additifs. Le seul vrai arbitrage est §6.

## 8. Questions ouvertes

1. **v1 top-level vs v2 imbriqué** : l'exemple RFC est imbriqué → si on veut « la grue dans l'asset », il faut
   v2 (le chemin d'instance). Combien d'assets mettront un modificateur sur un item *interne* multi-instancié ?
2. `smooth` : `k` par-pas-fixe (déterministe, simple) vs par-seconde (fps-correct façon Unity `damp`). Reco :
   par-`SIM_STEP`, documenté.
3. Éditeur : scrub = snap (§3) → le ressort ne se règle **pas** en scrubbant ; prévoir un preview en *lecture*.

## 9. Verdict

B-modificateur reste **Moyen** et **à risque faible** tant qu'on assume v1 (top-level). Il garde les
expressions pures, rend l'état explicite et conscient pour moteur/éditeur, et reprend un pattern d'état
par-instance déjà présent (`paramRt`). Le point §6 (imbriqué) est réel mais **n'oppose pas A et B** — A le
paie aussi. Décision préalable à toute implémentation : **viser v1 (top-level) d'abord**, et ne payer le
chemin d'instance (v2) que si un besoin d'asset imbriqué multi-instancié le justifie.
