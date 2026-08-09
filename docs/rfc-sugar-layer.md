# MINI-RFC — accueillir une couche de SUCRE dans flatkit (`@flatkit/sugar`)

> **Pour l'agent qui implémente dans flatkit.** Proposition d'accueil : il existe, hors de ce dépôt, une
> couche de sucre déclaratif éprouvée (`sugarflat`) dont **une partie appartient au langage** et devrait
> vivre ici, tandis que le reste est du métier éducatif et doit rester dehors. Ce document donne l'état
> mesuré de l'existant, la frontière proposée, le plan, et les garde-fous. Il se termine par cinq
> frictions constatées en 0.23 qui relèvent de ce dépôt.
>
> Rien de ce qui suit n'est supposé : chaque chiffre a été mesuré, chaque comportement reproduit avec
> `flatc` 0.23.0.

---

## 1. L'intention

flatkit déplie déjà du sucre avant le parse (`match`, `feedback`). Un dépôt voisin a poussé cette idée
beaucoup plus loin et l'a éprouvée sur ~100 activités : **un bloc déclaratif compact se déplie en
`.flatink` inspectable**, avec un ratio mesuré de 11 lignes → 262, et 10 lignes → 62 pour l'ambiance.

Le problème n'est pas qu'il existe dehors : c'est qu'une partie de ce sucre décrit **le langage**
(animer, lier un skin à une logique, s'échapper vers du DSL brut), et que cette partie **diverge** dès
que flatkit bouge. Trois divergences constatées cette semaine, toutes dans ce sens :

- le sucre `socle` émet encore des captures d'instants sur `time`, alors que 0.23 a fait passer
  `pulse`/`shake` sur `clock` — le `.flatink` produit sort avec un avertissement ;
- la grammaire de dessin a dû être **recopiée à la main** par un intégrateur (cf. friction n° 2) ;
- les prompts pour agents ne sont pas distribués (friction n° 3).

Co-localiser le sucre du *langage* avec le langage est le seul moyen qu'ils bougent ensemble.

## 2. L'existant, mesuré

Emplacement : `flatink-edu/sugarflat/` (dépôt voisin, versionné, **non publié sur npm**).

| | |
|---|---|
| code réel (`desugar/*.mjs`) | **1 883 lignes** |
| dépendances externes | **aucune** — `node:fs`, `node:path`, `node:url` uniquement |
| dépendance à flatkit | **aucune** — c'est du texte vers texte, il ne compile pas |
| `package.json` | **aucun** : dossier de scripts, pas un paquet |
| tests unitaires | **aucun** |
| paires `.sugarflat` / `.flatink` | **24** (goldens tout prêts) |

Le contrat qui rend l'accueil sûr est le non-négociable n° 1 de ce dépôt-là : *« desugar vers du DSL
INSPECTABLE, jamais un format opaque ; le `.flatink` produit reste l'artefact de référence »*. Le sucre
est un outil d'**écriture**, jamais un runtime.

**Compatibilité 0.23, vérifiée :**

```bash
# la sortie du sucre `socle` (11 lignes → 262)
flatc demo-tri.flatink --check
#   → check passed ✓ · 1 warning  (le `time` de la friction n° 6, côté sugarflat)

# la sortie du sucre `motion` (10 lignes → 62), en cels/tween
flatc cosmos.flatink --check              # → check passed ✓
flatc --render cosmos.flatink --frame 60  # → rend, et l'anim a bougé
```

## 3. La frontière proposée : le langage contre le métier

C'est le cœur de la proposition. **Ne pas tout prendre.**

### Ce qui appartient au langage → `@flatkit/sugar` (**335 lignes** au total)

| module | lignes | ce qu'il fait |
|---|---|---|
| `motion.mjs` | 150 | ambiance déclarative → **keyframes tween** (`cel N tween { pose … }`), zéro formule |
| `manifest.mjs` | 88 | extrait d'un `.flatink` son contrat : noms interactifs, vars lisibles, events — **sans aucune position** |
| `index.mjs` | 76 | la détection de bloc + l'échappatoire `raw { … }` (passe verbatim) |
| `skin.mjs` | 21 | trois bindings de skin : `lift` / `follow` / `surface` |

Deux d'entre eux méritent un mot, parce qu'ils dépassent la commodité :

- **`motion` a fait un pivot documenté et prouvé** : l'ambiance ne se déplie plus vers du script
  (`object { canal = sin(…) }`) mais vers des **cels tween**. Raison : une formule
  `sin((frame/240)*6.2832*n + φ)` est cryptique et « exécute-pour-voir », là où des poses **se lisent** et
  **se glissent** dans un éditeur de timeline. Preuve à l'œil : les deux versions d'une même scène rendent
  à l'identique, la version tween n'ayant aucune formule. C'est exactement le genre de sucre qui appartient
  au langage : il exprime en primitives du moteur ce que tout le monde réécrit à la main.
- **`manifest` est ce qui permet à un skin de respecter une logique sans hériter de son layout.** Il rend
  les noms, vars et events, et **jamais les coordonnées**. Le dépôt voisin en fait la démonstration :
  une même logique porte deux compositions opposées (étal de marché horizontal, boutique verticale), le
  même test de gestes passe sur les deux. Un outil générique, utile à tout hôte.

### Ce qui doit rester dehors (**1 514 lignes**)

`shop`, `marchand`, `sim agents`, `flow budget`, `dock`, `scroll`, `socle` (tri / ordonner / placement /
composer / etapes), `gated-action`, `machine`, `recipe`.

Ce sont des choix **pédagogiques**, pas du langage : `marchand … budget 12` ou `etapes … { etape "…" }`
encodent une intention d'exercice scolaire. Ils n'ont pas leur place dans un langage MIT généraliste, et
les y mettre obligerait flatkit à arbitrer des questions de didactique à chaque évolution.

## 4. Le plan

1. **Des goldens d'abord.** Les 24 paires `.sugarflat` / `.flatink` existantes deviennent des tests
   exécutables (déplier → comparer au `.flatink` attendu → `flatc --check` sans avertissement). C'est le
   vrai risque du chantier : 1 883 lignes sans un seul test, et rien d'autre ne prouvera qu'un
   déplacement n'a rien cassé. À faire **avant** de déplacer une ligne.
2. **Extraire les 335 lignes** vers un paquet `@flatkit/sugar`, publié avec le compilateur et testé
   contre lui. Sans dépendance, l'extraction est mécanique.
3. **Corriger au passage** ce que 0.23 a rendu faux : les captures d'instants du desugar doivent passer
   à `clock` (cf. friction n° 6), sans quoi la sortie du sucre ne peut pas viser « zéro avertissement ».
4. **Laisser le métier dehors**, avec une API publique stable pour que les sucres métier s'appuient sur
   `@flatkit/sugar` plutôt que de le recopier.

**Garde-fou à conserver tel quel** — c'est le non-négociable n° 3 de sugarflat, et il a une histoire :
une industrialisation précédente a **dilué le geste créatif** au point que toutes les activités produites
se ressemblaient (diagnostic écrit, note passée de 2/5 à 5/5 après démontage du gabarit). La règle qui en
est sortie : **échappatoire partout**. Tout bloc doit pouvoir être remplacé par du `.flatink` brut
(`raw { … }`). Le sucre couvre le générique répété ; la signature reste libre. Si un sucre commence à
imposer une composition, c'est un bug de conception, pas une fonctionnalité.

**À trier, pas à embarquer** : les dossiers `poc/` (255 fichiers) et `components/` (12) mélangent
expérimentations et code utile. Ne migrer que ce que les goldens couvrent.

---

## 5. Annexe — cinq frictions constatées en 0.23, qui relèvent de ce dépôt

Indépendantes de la RFC, mais rencontrées en même temps et vérifiées.

### F1. ⚠️ Un instant capturé sur `time` puis passé à `pulse` est SILENCIEUX

Le plus coûteux, parce qu'il remplace un défaut visible par un défaut invisible. En 0.21, `pulse`
roulait sur `time` : l'animation **sautait** à chaque tour, donc on la repérait. En 0.23 elle roule sur
`clock`. Un auteur qui garde l'ancien réflexe écrit :

```flatink
when clicked { doneAt = time }
scaleX = 1 + pulse(doneAt, 0.6) * 0.2
```

`clock - doneAt` croît sans fin : **l'animation ne part jamais**. Rien ne saute, rien ne clignote.

**Reproduit** : ce programme passe `flatc --check` **sans un mot** en 0.23.0. Le `time`-wraps warning ne
se déclenche pas, puisque le canal n'utilise pas `time`.

**Piste** : signaler une variable **affectée depuis `time`** et **lue par** `pulse`/`shake` — le lien est
local et statique. Touche toute base migrée depuis 0.21.

### F2. `languageCard()` ne dit rien du dessin

Mesuré : 3 545 caractères, **zéro occurrence** de `path`, `fill`, `linear`, `radial`, `layer`, `filter`,
`image`. Elle décrit le comportement, très bien. Mais un intégrateur qui fait écrire du décor à un modèle
lui donne une référence sans un mot sur les formes — et ce qu'un modèle devine en DSL ne compile pas.

**Piste** : une `drawingCard()` du même format : primitives, peintures, filtres, texte, découpe, et
l'ordre des mots (contenu → `as` → `at` → style), qui est la règle la plus souvent enfreinte.

### F3. Les prompts pour agents ne sont pas distribués

`prompts/flatink-core.md`, `role-asset-creator.md`, `role-motion-designer.md` sont excellents, mais le
dossier est ignoré (`.gitignore:20`) et absent du paquet npm (`dist/`, `bin/`, `README`, `LICENSE`).
Conséquence directe : la grammaire a été **recopiée à la main** ailleurs, avec un test qui compile chaque
exemple pour limiter la casse. Une référence recopiée diverge.

**Piste** : publier ces fichiers dans le paquet, ou les exposer par une fonction comme `languageCard()`.

### F4. La vérification de mise en page ne couvre pas le calage des textes

`docLayoutWarnings` / `docStructureWarnings` sont exposés et utiles, mais la passe de largeur saute les
lignes `wrap` et la passe de bbox ne descend pas dans les groupes. Or un texte qui déborde est le premier
défaut qu'un œil voit. Conséquence : impossible de remplacer une relecture par modèle multimodal (mesurée
à ~140 s par activité) par de la vérification déterministe.

**Piste** : descendre dans les groupes et mesurer les lignes `wrap`, quitte à le réserver à un
`--check --layout` vu le coût.

### F5. `@flatkit/compiler/compile` n'a pas d'export `require`

Les sous-chemins déclarent `types` + `import`, jamais `require`. Un script chargé en CJS — c'est le cas de
`tsx -e '…'` — échoue sur `ERR_PACKAGE_PATH_NOT_EXPORTED`, avec un message qui ne dit pas que le mode de
chargement est en cause. Mineur, mais coûte dix minutes la première fois.
