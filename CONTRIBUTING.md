# Contributing to ocpp-ws-io

First off, thank you for considering contributing to **ocpp-ws-io**! Every contribution helps make OCPP development better for everyone.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Commit Convention](#commit-convention)
- [Code Style](#code-style)
- [Testing](#testing)
- [Release Process](#release-process)

## Getting Started

This project is a **monorepo** managed with [Turborepo](https://turbo.build/) and npm workspaces:

```
ocpp-ws-io/
├── packages/
│   ├── ocpp-ws-io/       # Core library
│   └── ocpp-logger/      # Structured logger (WIP)
├── apps/
│   └── docs/             # Documentation site
```

## Development Setup

### Prerequisites

- **Node.js** ≥ 18.0.0
- **npm** ≥ 10.x
- **Git**

### Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/ocpp-ws-io.git
cd ocpp-ws-io

# 2. Install dependencies
npm install

# 3. Build all packages
npm run build

# 4. Run tests
npm test
```

### Useful Commands

| Command                                        | Description                     |
| ---------------------------------------------- | ------------------------------- |
| `npm run build`                                | Build all packages              |
| `npm test`                                     | Run all tests                   |
| `npm run dev`                                  | Start dev mode (all packages)   |
| `npm run lint`                                 | Lint all packages               |
| `npm test -w packages/ocpp-ws-io`              | Run tests for core package only |
| `npm run test:watch -w packages/ocpp-ws-io`    | Watch mode for core tests       |
| `npm run test:coverage -w packages/ocpp-ws-io` | Run tests with coverage         |

## How to Contribute

### Reporting Bugs

Found a bug? Please [open an issue](https://github.com/rohittiwari-dev/ocpp-ws-io/issues/new?template=bug_report.yml) with:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (Node.js version, OS, ocpp-ws-io version, OCPP protocol version)

### Suggesting Features

Have an idea? Please [open a feature request](https://github.com/rohittiwari-dev/ocpp-ws-io/issues/new?template=feature_request.yml) with:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Submitting Code

1. **Check existing issues** — Your idea may already be tracked
2. **Open an issue first** for significant changes — let's discuss before you invest time
3. **Fork the repo** and create a branch from `main`
4. **Write tests** for any new functionality
5. **Follow the code style** — see [Code Style](#code-style) below
6. **Submit a pull request** — see [Pull Request Process](#pull-request-process)

## Pull Request Process

### Branch Naming

Use descriptive branch names with the following prefixes:

| Prefix      | Usage                     |
| ----------- | ------------------------- |
| `feat/`     | New features              |
| `fix/`      | Bug fixes                 |
| `docs/`     | Documentation changes     |
| `refactor/` | Code refactoring          |
| `test/`     | Test additions or changes |
| `chore/`    | Maintenance tasks         |

Examples: `feat/ocpp21-certificate-mgmt`, `fix/reconnect-race-condition`, `docs/redis-adapter-guide`

### PR Checklist

Before submitting your PR, ensure:

- [ ] Your code builds without errors (`npm run build`)
- [ ] All tests pass (`npm test`)
- [ ] You've added tests for new functionality
- [ ] You've updated documentation if needed
- [ ] Your commits follow the [commit convention](#commit-convention)
- [ ] You've linked any related issues

### Review Process

1. A maintainer will review your PR
2. They may request changes — please address them in new commits
3. Once approved, a maintainer will merge the PR
4. Your contribution will be included in the next release 🎉

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Each commit message should be structured as:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                           |
| ---------- | ----------------------------------------------------- |
| `feat`     | New feature                                           |
| `fix`      | Bug fix                                               |
| `docs`     | Documentation changes                                 |
| `style`    | Formatting, missing semicolons, etc. (no code change) |
| `refactor` | Code refactoring (no feature or bug fix)              |
| `test`     | Adding or updating tests                              |
| `chore`    | Build process, dependencies, tooling                  |
| `perf`     | Performance improvement                               |
| `ci`       | CI/CD changes                                         |

### Scopes

Use the package or area name: `core`, `browser`, `redis`, `server`, `client`, `types`, `docs`

### Examples

```
feat(core): add OCPP 2.1 DataTransfer support
fix(client): resolve reconnect loop on auth failure
docs: update clustering guide with node-redis example
test(server): add mTLS handshake test cases
chore: update TypeScript to 5.8
```

## Code Style

- **TypeScript** — All source code must be in TypeScript
- **Strict mode** — `strict: true` in `tsconfig.json`
- **Formatting** — Use the project's existing formatting conventions
- **Naming** — Use `camelCase` for variables/functions, `PascalCase` for classes/types/interfaces
- **No `any`** — Avoid `any` types where possible; use `unknown` or proper generics
- **Documentation** — Add JSDoc comments for public APIs

## Testing

Tests use [Vitest](https://vitest.dev/). Write tests for:

- All new public APIs
- Bug fixes (add a regression test)
- Edge cases and error handling

```bash
# Run all tests
npm test

# Run with watch mode
npm run test:watch -w packages/ocpp-ws-io

# Run with coverage
npm run test:coverage -w packages/ocpp-ws-io
```

### Test Structure

```
packages/ocpp-ws-io/test/
├── client.test.ts        # Client tests
├── server.test.ts        # Server tests
├── ...
```

## Release Process

Releases are automated via GitHub Actions:

1. A maintainer bumps the version and creates a git tag: `git tag v1.2.3`
2. Pushing the tag triggers the [publish workflow](.github/workflows/publish.yml)
3. The workflow runs tests, builds, and publishes to npm
4. Pre-release tags (`v1.2.3-beta.1`, `v1.2.3-rc.1`) publish to the corresponding npm dist-tag

> **Note:** Only maintainers can create releases. If you believe a release is needed, open an issue.

---

Thank you for helping make **ocpp-ws-io** better! 💚
