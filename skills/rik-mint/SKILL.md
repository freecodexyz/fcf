---
name: rik-mint
description: Mint, create, register, or verify an fcf Repository Identity Key (RIK) for a GitHub repository using @freecodexyz/cli, GitHub Actions OIDC, repository secrets and variables, and a matched RIK deployment and Base network. Use for Base Mainnet or Base Sepolia RIK onboarding, registration workflow setup, wallet linking, workflow dispatch, transaction monitoring, and registration verification.
---

# RIK Mint

Use this skill to help an AI agent mint an fcf Repository Identity Key (RIK) for a GitHub repository.

A RIK is minted by running the fcf registration workflow in the target repository. The workflow requests a GitHub Actions OIDC token, proves repository ownership to the RIK contract, and sends the on-chain `register` transaction from the wallet linked to that repository.

The current project documents `0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac` on Base Sepolia. It has a Base Mainnet deployment helper, but no Base Mainnet RIK address is currently documented. Require a confirmed deployed address before minting on Base Mainnet.

## Core Rules

- Work inside the target repository, or explicitly clone/open `OWNER/REPO` before making changes.
- Verify `git remote get-url origin` matches the requested `OWNER/REPO` before setting secrets, variables, or workflows.
- Do not read, print, copy, commit, or ask for the fcf wallet private key. Use `fcf wallet link` to write it to the encrypted GitHub Actions secret.
- Do not run `fcf wallet create --force` unless the user explicitly asks to replace the local fcf wallet.
- Do not overwrite an existing `.github/workflows/fcf-register.yml` without inspecting it first and confirming the intended behavior.
- The actual mint should happen through GitHub Actions OIDC. Do not try to fake repository ownership or bypass JWT validation.
- Always set `FCF_CONTRACT` and `FCF_RPC_URL` explicitly and verify they target the same network. The CLI defaults `RPC_URL` to Base Mainnet when it is absent, while its currently configured RIK address is the documented Base Sepolia deployment.
- For a new RIK deployment, confirm the contract owner has synced active GitHub Actions OIDC signing keys before minting. Do not run the owner-only `fcf keys sync` command unless the user explicitly authorizes it and the signing wallet is the contract owner.
- Treat workflow dispatch as a transaction-spending action. If the user has not clearly asked to complete minting end-to-end, ask before dispatching the workflow.
- If a required input is missing, ask one concise question instead of guessing.

## Required Inputs

- Target GitHub repository as `OWNER/REPO` or a local checkout whose `origin` remote points to GitHub.
- Target network and RIK contract address. The current documented Base Sepolia RIK is `0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac`; do not infer a Base Mainnet address.
- RPC URL for the same network as the contract. Base's public endpoints are `https://mainnet.base.org` and `https://sepolia.base.org`.
- GitHub credentials with permission to write repository Actions secrets, variables, and workflows.
- A funded fcf wallet with enough ETH on the selected Base network to pay for registration gas.
- A RIK deployment provisioned with active GitHub Actions OIDC signing keys.

## Standard Workflow

For the complete command sequence, read [references/mint-workflow.md](references/mint-workflow.md).

1. Resolve and verify the target repository.
2. Run `fcf github whoami` from the repo to confirm GitHub API credentials work.
3. Create or reuse the local fcf wallet, then run `fcf wallet link` to set `FCF_PRIVATE_KEY` in the target repo.
4. Verify the RPC chain ID and set matched repo variables `FCF_CONTRACT` and `FCF_RPC_URL`.
5. Generate `.github/workflows/fcf-register.yml` with `fcf init`.
6. Commit and push the workflow file to the default branch if it is new or changed.
7. Ensure the linked wallet address has ETH on the selected Base network.
8. Dispatch the `Register Repository` workflow and monitor it to completion.
9. Capture the transaction hash, require `status=success`, and verify the repository token on-chain.

## Command Style

Prefer `npm exec` so the agent does not need to mutate global Node packages:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf --help
```

The checked-in registration workflow also uses `npm exec --yes --package=@freecodexyz/cli@alpha -- fcf register`.

## Troubleshooting

For failure modes and recovery steps, read [references/troubleshooting.md](references/troubleshooting.md).
