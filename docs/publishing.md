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

`scripts/build-package.ts` also copies the root `LICENSE` into the package at
pack time, so there are no checked-in copies to drift. `pnpm pack:check` packs
every public package, verifies the required files and license text,
rejects test files, source files, `workspace:`/`catalog:` protocols and `.ts`
specifier leaks, then runs `publint`.

## Versions

All 15 public packages are in one Changesets fixed group at v0.2. Pre-1.0:
minor = breaking, patch = fix. Split adapters into independent versions only
when community adapters exist.

## Publishing (initial setup)

The `0.1.0` and `0.2.0` trains are published. These steps document how the first publish was
set up.

1. Claim the `@auththread` npm scope: npmjs.com → Organizations → Create
   organization → `auththread`.
2. Create a **granular access token** at npmjs.com → Access Tokens → Generate
   New Token. Give it `@auththread` read/write access, an expiry, and permission
   to bypass 2FA for CI. Do not use an all-packages token.
3. Store it as the repository secret `NPM_TOKEN` under Settings → Secrets and
   variables → Actions. The release workflow writes it to `$HOME/.npmrc` for
   the publish step. Never commit it or put it in a project `.npmrc`.
4. Merge the version PR or run `pnpm release` from a clean checkout. For a
   local publish, use `npm login` or export `NPM_TOKEN` and add it to your
   user-level `~/.npmrc`.
5. After the packages exist, configure npm trusted publishing for each package
   (GitHub Actions, repository `ben-pick/auththread`, workflow `release.yml`)
   and remove the `NPM_TOKEN` secret and workflow env.
6. Verify the provenance record on npm and the `repository.url` in each package.
7. Tag the release train `vX.Y.Z` so the container workflow builds the matching
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
  Node consumers. Auth0 Actions should use `@auththread/auth0-actions`, which is
  a dedicated dependency-free CommonJS package.
- The page snippet is a plain file in `@auththread/auth0/page/snippet.js`; it is
  versioned with the package and pinned by the customer with SRI.
