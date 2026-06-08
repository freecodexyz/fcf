# fcf CLI

TypeScript CLI for fcf.

It currently supports repository registration against the RIK contract, GitHub Actions setup, wallet helpers, and GitHub repository secrets/variables helpers.

## Install

```shell
npm install -g @freecodexyz/cli@alpha --registry=https://npm.pkg.github.com
```

## Usage

Run from source:

```shell
pnpm dev -- --help
```

Installed command:

```shell
fcf --help
```

## Commands

- `fcf init`: create the GitHub Actions registration workflow.
- `fcf register --contract <addr>`: register the current repository on-chain.
- `fcf keys sync --contract <addr>`: sync GitHub OIDC signing keys to the contract.
- `fcf list --contract <addr>`: list recent repository registrations.
- `fcf wallet create`: create a local wallet.
- `fcf wallet link`: save the local wallet private key as a GitHub Actions secret.
- `fcf github whoami`: show the authenticated GitHub user.
- `fcf github secrets get|set`: read or write repository secrets metadata/values.
- `fcf github vars get|set`: read or write repository variables.

## Development

Use Node 24 and pnpm 10.

```shell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Contract ABI updates are generated from the Foundry project:

```shell
pnpm abi
```

## Publishing

`pnpm publish --tag <tag>` publishes the package to GitHub Packages, creates a
GitHub Release named from the package version, and appends the generated release
notes to `CHANGELOG.md`.

Authenticate with a GitHub token that can publish packages and write releases.
The post-publish release step reads `GH_TOKEN`, `GITHUB_TOKEN`,
`NODE_AUTH_TOKEN`, or the current `gh auth token`.
