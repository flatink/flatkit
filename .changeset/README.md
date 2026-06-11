# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets). It records the
intended version bumps and changelog entries for the published `@flatkit/*` packages.

When you make a change worth releasing, add a changeset:

```sh
pnpm changeset
```

Pick the bump (patch / minor / major) and write a one-line summary. Commit the generated file in
`.changeset/` with your PR. The release workflow turns merged changesets into a "Version Packages" PR
and, once that is merged, publishes to npm.

The four published packages are versioned **in lockstep** (a release bumps them all to the same
version) — see `fixed` in `config.json`.
