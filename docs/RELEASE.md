# Release process

This project should release small, useful versions instead of batching unrelated work. A release is appropriate when the project gains a user-visible fix, scanner improvement, docs improvement, or GitHub Action behavior change.

## Cadence

When the project is active, aim for a release at least monthly. Release sooner for fixes that unblock CI usage or correct bad coverage results.

## Preflight

Before cutting a release:

```bash
git status --short
npm ci
npm run check
npm run build
```

Then dogfood the CLI against at least one real project or fixture:

```bash
npx msw-inspector --report-file msw-inspector.json --format json
```

Review the report for obvious false positives, false negatives, or unsupported patterns that should be documented.

## Versioning

Use semver:

- Patch: bug fixes, docs, small output improvements.
- Minor: new supported static patterns, new CLI options, GitHub Action additions.
- Major: breaking CLI, JSON schema, or package behavior changes.

Update `CHANGELOG.md` before publishing.

## Publish checklist

1. Confirm `npm run check` and `npm run build` pass.
2. Update `CHANGELOG.md`.
3. Bump `package.json` with `npm version patch`, `npm version minor`, or `npm version major`.
4. Push the commit and tag.
5. Publish to npm with `npm publish`.
6. Create a GitHub release from the tag with the changelog notes.
7. Open or update a follow-up roadmap issue for the next release.

Do not publish from a dirty worktree unless the only changes are intentional release files.
