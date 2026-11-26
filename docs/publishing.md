# Publishing packages

The public packages form one fixed release train. The source exports point at
`src/*.ts` so the workspace typechecks without a build. `publishConfig` swaps
the exports to `dist/*.js` and `dist/*.d.ts` at pack time.

## Build

```sh
pnpm build
pnpm pack:check
```

`scripts/build-package.ts` runs `tsc -p tsconfig.build.json`, then rewrites
relative `.ts` specifiers in declaration files to `.js`. This is required:
`rewriteRelativeImportExtensions` rewrites JavaScript output but not `.d.ts`
files, and consumers cannot resolve `.ts` imports from a published package.

`pnpm pack:check` packs every public package, verifies the required files,
rejects test files, source files, `workspace:`/`catalog:` protocols and `.ts`
specifier leaks, then runs `publint`.

## Versions

All 15 public packages are in one Changesets fixed group at v0.1. Pre-1.0:
minor = breaking, patch = fix. Split adapters into independent versions only
when community adapters exist.

## First publish

1. Claim the `@auththread` npm scope.
2. Create an npm automation token and add `NPM_TOKEN` to the repository.
3. Merge the version PR or run `pnpm release` from a clean checkout.
4. After the packages exist, configure npm trusted publishing for
   `.github/workflows/release.yml` and remove the token.
5. Verify the provenance record on npm and the `repository.url` in each package.
6. Tag the release train `vX.Y.Z` so the container workflow builds the matching
   multi-arch image.

## Snapshots

For product integration before a release:

```sh
pnpm changeset version --snapshot next
pnpm changeset publish --tag next
```

Never publish a snapshot without `--tag next`.

## Browser and Actions boundaries

- `@auththread/browser` and provider `/browser` entrypoints are browser-only.
- `@auththread/auth0/actions` has an ESM build and a bundled CommonJS file for
  the Auth0 Actions runtime.
- The page snippet is a plain file in `@auththread/auth0/page/snippet.js`; it is
  versioned with the package and pinned by the customer with SRI.
