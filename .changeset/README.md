# Changesets

This repository uses Changesets for versioning and npm publication.

- Add a changeset when a public package changes: `pnpm changeset`.
- The release workflow opens a version PR on `main`.
- Merging the version PR publishes the fixed train to npm with provenance.

The first release publishes the current `0.1.0` packages. Subsequent releases use the
version PR.
