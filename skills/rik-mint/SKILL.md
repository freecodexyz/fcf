---
name: rik-mint
description: Use this skill when the task is to mint, create, register, or verify an fcf Repository Identity Key (RIK) for a GitHub repository using @freecodexyz/cli, GitHub Actions OIDC, repository secrets and variables, and Base Sepolia.
license: Apache-2.0
metadata:
  author: freecodexyz
  version: 1.0.0
  category: developer-tools
  tags:
    - fcf
    - rik
    - github-actions
    - oidc
    - evm
    - base-sepolia
    - agent-tools
---

# RIK Mint

Use this skill to help an AI agent mint an fcf Repository Identity Key (RIK) for a GitHub repository.

A RIK is minted by running the fcf registration workflow in the target repository. The workflow requests a GitHub Actions OIDC token, proves repository ownership to the RIK contract, and sends the on-chain `register` transaction from the wallet linked to that repository.

## Use This Skill For

- Minting or registering a RIK for `OWNER/REPO`.
- Setting up `.github/workflows/fcf-register.yml` in the target repository.
- Creating and linking the fcf wallet used by the registration workflow.
- Setting `FCF_CONTRACT` and `FCF_RPC_URL` GitHub Actions variables.
- Dispatching and monitoring the `Register Repository` GitHub Actions workflow.
- Verifying that a repo registration transaction succeeded.

## Core Rules

- Work inside the target repository, or explicitly clone/open `OWNER/REPO` before making changes.
- Verify `git remote get-url origin` matches the requested `OWNER/REPO` before setting secrets, variables, or workflows.
- Do not read, print, copy, commit, or ask for the fcf wallet private key. Use `fcf wallet link` to write it to the encrypted GitHub Actions secret.
- Do not run `fcf wallet create --force` unless the user explicitly asks to replace the local fcf wallet.
- Do not overwrite an existing `.github/workflows/fcf-register.yml` without inspecting it first and confirming the intended behavior.
- The actual mint should happen through GitHub Actions OIDC. Do not try to fake repository ownership or bypass JWT validation.
- Treat workflow dispatch as a transaction-spending action. If the user has not clearly asked to complete minting end-to-end, ask before dispatching the workflow.
- If a required input is missing, ask one concise question instead of guessing.

## Required Inputs

- Target GitHub repository as `OWNER/REPO` or a local checkout whose `origin` remote points to GitHub.
- RIK contract address. Current Base Sepolia RIK from this repo's README: `0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac`.
- Base Sepolia RPC URL. Public default example: `https://base.sepolia.org`.
- GitHub credentials with permission to write repository Actions secrets, variables, and workflows.
- A funded fcf wallet with enough Base Sepolia ETH to pay for registration gas.

## Standard Workflow

For the complete command sequence, read [references/mint-workflow.md](references/mint-workflow.md).

1. Resolve and verify the target repository.
2. Run `fcf github whoami` from the repo to confirm GitHub API credentials work.
3. Create or reuse the local fcf wallet, then run `fcf wallet link` to set `FCF_PRIVATE_KEY` in the target repo.
4. Set repo variables `FCF_CONTRACT` and `FCF_RPC_URL`.
5. Generate `.github/workflows/fcf-register.yml` with `fcf init`.
6. Commit and push the workflow file if it is new or changed.
7. Ensure the linked wallet address has Base Sepolia ETH.
8. Dispatch the `Register Repository` workflow and monitor it to completion.
9. Capture the registration transaction hash and verify the run status is successful.

## Command Style

Prefer `npm exec` so the agent does not need to mutate global Node packages:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf --help
```

The checked-in registration workflow also uses `npm exec --yes --package=@freecodexyz/cli@alpha -- fcf register`.

## Troubleshooting

For failure modes and recovery steps, read [references/troubleshooting.md](references/troubleshooting.md).
