# Development and releases

Use Node 26.0.0 to match CI. In a clean checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
```

All native dependencies come from the exact supported npm release, `0.2.2-alpha.2`. No DSH source checkout, connector, patched compiler or global dependency install is needed. `npm test` runs unit, native integration, runtime-capability and release-safety tests with isolated synthetic fixtures. It does not use provider credentials or paid inference. Optional [credential helpers](docs/auth.md) preserve native authentication.

## Package validation

```sh
mkdir -p dist/release
npm pack --dry-run
npm pack --pack-destination dist/release
node scripts/release/check-tarball.mjs dist/release/dsh-team-roles-0.4.0.tgz
```

The check validates package contents and writes `SHA256SUMS`. For native install/load acceptance, run `node scripts/test-portable-package.mjs ./node_modules/@deepseek-ai/dsh <built-tarball>`; it creates a temporary profile and performs no paid inference.

## Release procedure

1. Update the package version and lockfile, run the relevant checks, and merge changes into the default branch.
2. Tag that merged commit as `v<package.json version>` and push the tag normally. Never move an existing version tag.
3. Wait for the **Release package** workflow. Review the draft's `.tgz`, `SHA256SUMS` and compatibility notes, then publish manually.

The workflow requires the tag/version to match and the commit to belong to the default branch. PR jobs are read-only; only tag pushes can create drafts. Re-running a failed tag job resumes identical partial draft assets. Published versions or differing assets are refused without replacement. Changed release bytes require a new version. npm publication is separate.

CI runs the synthetic native integration tests against the supported npm release. It does not certify provider inference, browser rendering or another DSH version. Keep action pins and runtime compatibility checks intact.
