---
"@flatkit/player": minor
---

The sound starts at the first gesture on the page when the browser kept it locked. With `autoplay`, the clips are scheduled at load, outside any gesture: Safari leaves the AudioContext suspended and no later click asked again, so a looping clip at frame 0 stayed silent until a pause/play. The first pointer press or release, key or tap anywhere on the page now resumes the context and puts the clips of every playing player back on its playhead. A host that worked around it (audio off then on at the first gesture) can drop that.
