# RFC — Cacher `pathToPolygons` dans le hit-test (le VRAI fix du lag souris)

> Pour l'agent flatkit. Le coalescing du `pointermove` (0.17.1) était juste, mais le lag souris **persiste**
> sur `voyage-bouchee` (flatink-edu). Le profil CPU du **vrai navigateur** désigne un coût **ailleurs** : le
> hit-test re-aplatit les courbes de Bézier à chaque move.

---

## La preuve (CPU profile navigateur — `voyage-bouchee`, vrais mouse-moves, ~3 s)

- **`pointermove` = 146 ms/event** (62 events sur la trace → 9 s de la trace en handlers de move).
- **Layout/reflow = 0 ms** → ce n'est PAS un `getBoundingClientRect`/reflow. **Render coalescé** (0.17.1 OK,
  `playing:true`) → pas le dessin non plus.
- Top self-time du profil :

  | fonction | self-time | fichier |
  |---|---|---|
  | `mid` (subdivision) | 2529 ms | engine/src/path.ts |
  | `flattenCubic` | 1403 ms | engine/src/path.ts |
  | `flatEnough` | 630 ms | engine/src/path.ts |
  | `pointInPolygons` | 380 ms | player/src/hit.ts |
  | `pathToPolygons` | 138 ms | engine/src/path.ts |
  | **(garbage collector)** | **3524 ms** | — |

→ Le hit-test **re-aplatit les Bézier en polygones à CHAQUE move, sans cache** → subdivision de courbes +
**GC massive** (les polygones alloués puis jetés en boucle).

## Origine

`pathToPolygons(path, tol = 0.25)` (`packages/engine/src/path.ts:68`) flatten les courbes via
`flattenCubic`/`flatEnough`/`mid` — et **alloue** des tableaux de points. Elle est appelée **par hit-test, par
item** :
- `packages/player/src/hit.ts` : l.103 `hitRegion` (`pointInPolygons(pathToPolygons(r.path), pt)`), l.26
  `pointInMask`.
- `packages/player/src/regionHit.ts:35`.

Aucune mémoïsation → on re-aplatit le **même** path à chaque pixel de souris.

## Le fix — mémoïser `pathToPolygons`

La géométrie d'un path est **invariante** : elle est définie une fois dans le flatpack, en **espace local**
(seul le `transform` de l'item change entre frames, pas le path lui-même). → l'aplatir **une fois**, réutiliser.

- Un cache dans `pathToPolygons` : **`WeakMap<Path, Polygon[]>`** (ou par couple `(path, tol)` si `tol` varie).
  Clé = l'objet `path` (stable, vient du doc). Hit → renvoie le cache ; miss → flatten + stocke. Le WeakMap se
  GC tout seul, zéro fuite.
- Les appelants **chauds** (`hitRegion`/`pointInMask`) passent `it.path` / `r.path` = la **même référence**
  réutilisée d'un move à l'autre → cache hit. (Les rares appelants qui construisent un path neuf — hit.ts l.66/80,
  le geste « path-follow » — ratent le cache mais sont rares et hors hot-path souris.)

## Subtilités

- **Invariance** : valable tant que les paths sont statiques (le cas normal). Un path **`bind`-piloté**
  (géométrie dynamique) changerait → soit la clé de cache inclut la valeur résolue, soit on ne cache pas ces
  paths-là. À vérifier s'il en existe (probablement aucun aujourd'hui).
- **Identité de résultat** : pure mémoïsation → les hits doivent être **identiques** (garde `hit.test.ts` /
  `playerDrag` / `playerFeedback` verts).
- **Bonus GC** : supprimer la ré-allocation par-move coupe aussi la pression GC (≈ la moitié du coût observé).
- Indépendant du coalescing 0.17.1 (qui reste juste) — c'était un coût **séparé** que le coalescing ne pouvait
  pas couvrir.

## Mesure avant/après

Re-profiler `voyage-bouchee` en bougeant la souris (Chrome perf trace) : `pointermove` doit chuter de
**~146 ms → sub-ms** (plus de flatten ni de GC par-move). Côté EDU, on peut aussi mesurer dans le navigateur
(dispatch de quelques `pointermove` + `performance.now()`).

## Honnêteté

Diagnostic depuis le **profil navigateur réel**, pas le headless — qui m'avait menti (mon point de test tombait
à côté des régions courbes → court-circuit, 0,4 ms ; même moteur V8, donc l'écart était l'ÉTAT, pas le runtime).
Le coût est sans ambiguïté `pathToPolygons` + flatten de courbes + GC.
