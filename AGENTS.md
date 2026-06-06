# AGENTS.md

Guidance for AI coding agents working in this repository. See
<https://agents.md/> for the file convention.

## Project Overview

- Project name: write it as `fcf` in prose and commands.
- Purpose: CLI tooling and EVM smart contracts for the
  `@freecodexyz` funding layer.
- Repository shape: small monorepo with a TypeScript CLI in `cli/` and a
  Foundry Solidity project in `contracts/`.
- CLI stack: Node 24 in CI, ESM TypeScript, `pnpm@10.24.0`, Commander, Viem,
  tsup, tsx, TypeScript, and Vitest.
- Contract stack: Foundry, Solidity `^0.8.24`, OpenZeppelin Contracts, and
  `forge-std` as git submodules under `contracts/lib/`.
- Core contract: `RIK`, an ERC-721 "Repository Identity Key" that registers a
  GitHub repository identity from a GitHub Actions OIDC JWT.

## Environment Setup

- Use Node 24 for CLI work to match GitHub Actions.
- Use Corepack and pnpm in `cli/`; there is no root `package.json`.
- Initialize submodules before contract work:
  `git submodule update --init --recursive`.
- Install Foundry for contract build/test commands: `forge`, `cast`, and
  `anvil` are expected for local contract workflows.
- `contracts/foundry.toml` has `ffi = true` because the Foundry tests call a
  Node fixture generator via `vm.ffi`.

## Commands

| Purpose | Command |
| --- | --- |
| Install CLI dependencies | `cd cli && corepack enable && pnpm install --frozen-lockfile` |
| Run CLI from source | `cd cli && pnpm dev -- --help` |
| CLI typecheck | `cd cli && pnpm typecheck` |
| CLI tests | `cd cli && pnpm test` |
| CLI build | `cd cli && pnpm build` |
| Regenerate committed ABI | `cd cli && pnpm abi` |
| Contract format check | `cd contracts && forge fmt --check` |
| Contract build with sizes | `cd contracts && forge build --sizes` |
| Contract tests | `cd contracts && forge test -vvv` |
| Local Anvil deploy helper | `./local-rpc.sh src/RIK.sol:RIK` |
| Sepolia deploy script | `cd contracts && PRIVATE_KEY=... ./deploy-sepolia.sh` |
| Finds agents TODOs when asked | `rg -F 'TODO (AGENT)'` |

Do not run release/versioning commands such as `cd cli && pnpm version:minor`
or `cd cli && pnpm prepublishOnly` unless the user explicitly asks for a
release path. They mutate `cli/package.json`.

## Repository Structure

- `.github/workflows/test-cli.yml`: CLI CI; installs with pnpm and runs
  `pnpm test` under `cli/`.
- `.github/workflows/test-contracts.yml`: contract CI; runs `forge fmt --check`,
  `forge build --sizes`, and `forge test -vvv` under `contracts/`.
- `.github/workflows/fcf-register.yml`: checked-in registration workflow emitted
  by the CLI `init` command.
- `local-rpc.sh`: root helper that starts Anvil, deploys a contract, prints the
  RPC URL/private key/owner/contract address, and waits until interrupted.
- `cli/src/index.ts`: Commander CLI entrypoint.
- `cli/templates/fcf-register.yml`: workflow template emitted by CLI `init`.
- `cli/src/oidc.ts`: JWT base64url helpers, parsing, and GitHub `kid` hashing.
- `cli/src/importAbi.ts`: loads the committed static ABI by default.
- `cli/src/abi/RIK.json`: committed generated ABI used by the published CLI.
- `cli/scripts/generate-abi.mjs`: copies the ABI from the Foundry artifact into
  `cli/src/abi/RIK.json`.
- `contracts/src/RIK.sol`: repository identity ERC-721 and JWT verification.
- `contracts/src/JsonClaim.sol`: minimal byte-search JSON claim helper.
- `contracts/test/RIK.t.sol`: Foundry regression tests for registration,
  ownership, JWT claims, keys, and expiry.
- `contracts/test/fixtures/load-fixture.mjs`: Node helper used by `vm.ffi` to
  generate deterministic RSA/JWT fixtures for Solidity tests.
- `contracts/script/Deploy.s.sol`: Foundry deploy script.
- `contracts/deploy-sepolia.sh`: Sepolia deploy wrapper using `PRIVATE_KEY` and
  optional `SEPOLIA_RPC_URL` / `VERIFY`.
- `contracts/lib/`: git submodules and vendor code. Do not edit directly.

## Architecture Boundaries

- `RIK.tokenIdOf(githubRepoId)` is intentionally identity mapping; the token ID
  is the GitHub repository ID.
- `RIK.register()` must validate the JWT before minting: active `kid`, RSA
  signature, `aud`, `repository_id`, `repository_owner_id`, issuer, `exp`,
  `nbf`, and duplicate registration.
- Preserve the issuer string exactly:
  `https://token.actions.githubusercontent.com`.
- The CLI requests GitHub OIDC tokens with the lowercase signer address as the
  audience; the contract compares `aud` against `Strings.toHexString` of
  `msg.sender`.
- GitHub JWKS `kid` values are stored on-chain as `keccak256(Buffer.from(kid))`;
  keep `jwtKid()` and contract key lookups aligned.
- `keys sync` is the path that imports active GitHub RSA keys into the contract.
  Do not weaken key filtering or signature validation.
- `JsonClaim` is deliberately small and byte-oriented. If claim parsing changes,
  add regression tests for missing claims, mismatched claims, and valid compact
  JWT payloads.
- `cli/src/importAbi.ts` defaults to the committed static ABI. `SKIP_STATIC_ABI`
  switches to the Foundry artifact path for local development.
- Keep `cli/templates/fcf-register.yml` and
  `.github/workflows/fcf-register.yml` behavior in sync when registration
  workflow semantics change.
- Contract ABI changes must be followed by `cd cli && pnpm abi` so the packaged
  CLI ABI stays current.

## Code Style

- Prefer small, direct changes. Avoid broad refactors unless the user asks.
- Match nearby formatting in each file. There is no configured TypeScript
  formatter in the CLI package.
- TypeScript is strict ESM with `module: nodenext`, `verbatimModuleSyntax`,
  `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.
- Use `node:` built-in imports in new TypeScript files.
- Use type-only imports when importing TypeScript types, e.g. `import type`.
- Keep CLI command behavior explicit through Commander options and `die()`
  messages rather than silent fallbacks.
- Solidity code should pass `forge fmt`; use custom errors for contract-specific
  failures when practical.
- Use `// forge-lint: disable-next-line(...)` only next to the exact line that
  needs it, and keep a short reason nearby when the reason is not obvious.
- Comments should explain constraints or non-obvious behavior, not restate names.

## Testing

- For CLI-only changes, run `cd cli && pnpm typecheck` and `cd cli && pnpm test`.
- For contract-only changes, run `cd contracts && forge fmt --check`,
  `cd contracts && forge build --sizes`, and `cd contracts && forge test -vvv`.
- For ABI-affecting contract changes, also run `cd cli && pnpm abi`,
  `cd cli && pnpm typecheck`, and `cd cli && pnpm build`.
- Keep Foundry tests deterministic and local. Do not hit GitHub, Sepolia, or
  other live RPC endpoints from unit tests.
- Contract tests may use `vm.ffi` with `contracts/test/fixtures/load-fixture.mjs`;
  avoid adding more external process dependencies unless necessary.
- Add CLI tests as Vitest tests under `cli/src/` or a future `cli/test/`
  directory. Mock `fetch`, Viem clients, and filesystem writes rather than using
  live network calls.

## Git/PR Workflow

- Recent human commit format: `(type) imperative summary`.
- Examples from this repo: `(feat) add deployment script for RIK contract`,
  `(fix) add shebang to index.ts for execution in github actions`,
  `(chore) bump cli version`.
- AI-created commit format when the user asks for a commit:
  `(type) (openai/gpt-5.5, reviewed T|F, tested T|F) imperative summary`.
- Before creating an AI commit, ask the user whether a human reviewed the
  changes so `reviewed T|F` is accurate.
- Mark `tested T` only after the relevant checks have run successfully.
  Otherwise use `tested F`.
- Before committing, inspect `git status --short`, `git diff`, and
  `git log --oneline -10`; stage only intended files.
- Run `git diff --check` before commit/PR handoff.

## Boundaries

- Never edit, print, copy, infer, or commit real secrets: `.env`, `.env.*`,
  `PRIVATE_KEY`, GitHub tokens, RPC credentials, wallet data, or provider keys.
- Do not commit `contracts/.dev-wallet-data` or values printed by
  `local-rpc.sh`. Anvil keys are disposable but still should not enter commits.
- Do not deploy, broadcast transactions, sync production keys, or call live RPCs
  unless the user explicitly asks.
- Do not change production/provider configuration without explicit approval:
  environment variable names, default RPC behavior, GitHub OIDC issuer,
  workflow permissions, contract addresses, or default package tags.
- Do not edit generated or dependency directories directly: `cli/node_modules/`,
  `cli/dist/`, `contracts/cache/`, `contracts/out/`, `contracts/broadcast/`,
  or `contracts/lib/`.
- The committed static ABI at `cli/src/abi/RIK.json` is generated but tracked;
  update it only through `cd cli && pnpm abi` when the contract ABI changes.
- Never replace pnpm with npm/yarn or Foundry with another contract toolchain
  without explicit user approval.
