# FlatInk prompts — teaching the language to a model

These files ship inside `@flatkit/compiler`, so an integrator never has to copy the grammar by hand. A
copied reference drifts from the language, and the drift is paid in DSL that the end user's compiler
rejects. Read them from the installed package:

```js
import { readFileSync } from 'node:fs'
const core = readFileSync(new URL('../prompts/flatink-core.md', import.meta.resolve('@flatkit/compiler')), 'utf8')
```

In a browser (or when you want something smaller and always in sync with the engine), prefer the
generated cards instead — they interpolate the real function/channel lists and are a fraction of the size:

```js
import { languageCard, drawingCard, llmContext } from '@flatkit/compiler'

llmContext(doc)              // behavior card + drawing card + the names of THIS scene
languageCard()               // behavior only: events, channels, expressions
drawingCard()                // composition only: shapes, paints, filters, text, clipping
```

## What each file is for

| File | Use it when |
|---|---|
| `flatink-core.md` | the model writes a whole `.flatink` or `.flat` from scratch — the full reference |
| `flatink-lite.md` | the task is small and the prompt budget is tight — the same language, condensed |
| `role-asset-creator.md` | the model draws a **symbol library** (`.flat`): shapes, gradients, filters |
| `role-motion-designer.md` | the model animates: timelines, cels, tweens, channel expressions |
| `role-coder.md` | the model writes behavior: events, variables, interactions, `send` |

Pair a role file with `flatink-core.md`: the role sets the job, the core sets the grammar.

## Validating what comes back

Never ship generated DSL unchecked. `checkProgram` runs exactly what `flatc --check` runs, on a string,
with no subprocess — and its report is a serviceable repair prompt:

```js
import { checkProgram } from '@flatkit/compiler'

const { ok, report } = checkProgram(srcFromTheModel)
if (!ok) retry(report)
```
