# Contributing to ocpp-smart-charge-engine

Thank you for your interest in contributing! This library is part of an open-source OCPP infrastructure ecosystem, and every contribution — bug reports, feature ideas, documentation improvements, and code — is valued.

---

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9

### Setup

```bash
git clone https://github.com/rohittiwari-dev/ocpp-smart-charge-engine.git
cd ocpp-smart-charge-engine
npm install
npm test        # run the full test suite
npm run build   # verify the build compiles
```

---

## How to Contribute

### 🐛 Reporting Bugs

Before filing an issue, please check that it hasn't already been reported.

When filing a bug, include:
- Node.js version (`node --version`)
- Package version
- A minimal reproducible code snippet
- Expected vs. actual behavior

### 💡 Suggesting Features

Open a [GitHub Discussion](https://github.com/rohittiwari-dev/ocpp-smart-charge-engine/discussions) or an issue with the `enhancement` label. Please describe:
- The use case / problem you're solving
- Why this belongs in the engine vs. the user's dispatcher
- Any OCPP spec sections that are relevant

### 📦 Adding a New Strategy

Strategies live in `src/strategies/`. A strategy is a pure function:

```typescript
import type { StrategyFn } from "../types.js";

export const myStrategy: StrategyFn = (sessions, effectiveGridLimitKw) => {
  // Return one SessionProfile per session
  return sessions.map((session) => buildSessionProfile(session, /* allocatedKw */));
};
```

1. Create `src/strategies/my-strategy.ts`
2. Export it from `src/strategies/index.ts`
3. Add it to the `Strategy` union type in `src/types.ts`
4. Handle it in `engine.ts` `resolveStrategy()` switch
5. Add tests in `test/`

### 🔧 Submitting a PR

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes — keep them focused and atomic
3. Ensure all tests pass: `npm test`
4. Ensure TypeScript compiles cleanly: `npx tsc --noEmit`
5. Add or update tests for your change
6. Update `CHANGELOG.md` under `[Unreleased]`
7. Submit a PR against the `main` branch

---

## Code Style

- TypeScript strict mode (`strict: true`, `exactOptionalPropertyTypes: true`)
- No external runtime dependencies — this is a zero-dependency library
- All public APIs must be documented with JSDoc
- Prefer explicit types over inference for public-facing interfaces

---

## Project Structure

```
src/
├── index.ts          ← Public API — only export from here
├── engine.ts         ← SmartChargingEngine class
├── types.ts          ← All public types and interfaces
├── errors.ts         ← Typed error classes
├── builders.ts       ← OCPP version-specific profile builders (subpath export)
└── strategies/
    ├── index.ts      ← Re-exports
    ├── utils.ts      ← Shared buildSessionProfile helper
    ├── equal-share.ts
    ├── priority.ts
    └── time-of-use.ts
test/
└── engine.test.ts    ← Vitest test suite
```

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add ROUND_ROBIN strategy
fix: handle zero-priority sessions in PRIORITY strategy
docs: add V2G example to README
test: add minChargeRateKw edge cases
chore: bump tsup to 8.x
```

---

## License

By contributing, you agree that your contributions will be licensed under the **MIT License**.
