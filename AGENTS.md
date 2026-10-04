# Hana agent notes

This is a Scaffold-HBAR npm workspace with a Next.js App Router app and a Hardhat contracts package. Read `README.md` before changing setup or receipt behavior.

## Commands

- `npm run next:dev` — local app
- `npm run next:check-types` — TypeScript check
- `npm run next:test` — deterministic policy replay tests
- `npm run next:lint` — frontend lint
- `npm run next:build` — production build
- `npm run hardhat:compile` — compile the included Hedera contracts

## Invariants

- Bonzo reads are read-only. Never add borrow, repay, approval, liquidation, or wallet signing flows.
- Keep Hedera signing keys server-only; never prefix secrets with `NEXT_PUBLIC_` or commit `.env.local`.
- Missing, stale, or malformed source data must evaluate to `unknown`; never silently use fixtures as live values.
- Keep policy and observation schemas versioned and messages under 1,024 UTF-8 bytes.
- Replay only supported observation schemas with a matching policy. Clearly distinguish publisher-recorded evidence from independent verification of source data.
