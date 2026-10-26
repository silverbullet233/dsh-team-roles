# Development and releases

Use Node 26.0.0 to match CI. In a clean checkout, install locked dependencies with `npm ci --ignore-scripts --no-audit --no-fund`, then run `npm run build:release` and `npm run test:release`. `npm ci` replaces existing development dependencies.

The build verifies the SHA-256 of the pure Remote metadata helper from the supported official DSH commit. It does not install native DSH services or run providers. The release test subset covers runtime-independent behavior; it excludes tests requiring a complete native DSH build.

## Native integration

Use a separate checkout without npm-installed `node_modules`, and the complete compatible build described in [runtime requirements](docs/runtime.md). The connector refuses to replace existing unmanaged dependencies:

```sh
npm run runtime:connect -- /absolute/path/to/built-dsh
npm run runtime:verify
npm run build
npm run test:unit
npm run test:native
npm run test:runtime
```

The connector supplies checkout-only dependencies; it is not an installation step. Tests use isolated synthetic fixtures. Optional [credential helpers](docs/auth.md) must preserve native authentication.

## Package validation

```sh
mkdir -p dist/release
npm pack --dry-run
npm pack --pack-destination dist/release
node scripts/release/check-tarball.mjs dist/release/dsh-team-roles-0.3.0.tgz
```

The check validates package contents and writes `SHA256SUMS`. For native install/load acceptance, run `node scripts/test-portable-package.mjs <compatible-runtime> <built-tarball>`; it creates a temporary profile and performs no paid inference.

## Release procedure

1. Update the package version and lockfile, run the relevant checks, and merge changes into the default branch.
2. Tag that merged commit as `v<package.json version>` and push the tag normally. Never move an existing version tag.
3. Wait for the **Release package** workflow. Review the draft's `.tgz`, `SHA256SUMS` and compatibility notes, then publish manually.

The workflow requires the tag/version to match and the commit to belong to the default branch. PR jobs are read-only; only tag pushes can create drafts. Re-running a failed tag job resumes identical partial draft assets. Published versions or differing assets are refused without replacement. Changed release bytes require a new version. npm publication is separate.

The plugin still requires its compatible native DSH runtime; a successful package-only CI run does not certify native integration or another DSH release. Keep action/source pins and runtime compatibility checks intact.
