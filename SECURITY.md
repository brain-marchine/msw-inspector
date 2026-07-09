# Security Policy

## Supported versions

Security fixes target the latest published npm package and the `main` branch. Backports may be considered when the impact is clear, but users should generally upgrade to the latest release.

## Reporting a vulnerability

Please do not open a public issue with exploit details.

Use GitHub private vulnerability reporting for this repository when it is available. If private reporting is not enabled, open a minimal public issue asking for a private disclosure path and leave out sensitive details until a private channel is established.

Helpful report details include:

- affected package version
- Node.js and npm versions
- a minimal reproduction or proof of concept
- expected impact
- whether the issue is already public

## Scope

The most relevant reports are vulnerabilities in the CLI, the analyzer, the GitHub Action wrapper code, or published package artifacts. Dependency vulnerabilities are also useful when they are exploitable through normal `msw-inspector` usage.

## Disclosure

The maintainer will review reports as availability allows, coordinate a fix when needed, and publish release notes or an advisory when the issue affects users.
