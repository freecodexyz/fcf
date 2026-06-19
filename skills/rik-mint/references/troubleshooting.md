# RIK Mint Troubleshooting

## GitHub Auth Fails

Symptom:

```text
fcf: Unable to find stored git credentials; exiting.
```

Cause: `fcf` uses `git credential fill` for GitHub API auth.

Fix with GitHub CLI:

```bash
gh auth login
gh auth setup-git
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github whoami
```

The token must have enough access to manage Actions secrets and variables on the target repo.

## Wallet Already Exists

Symptom:

```text
fcf: wallet already exists ... use --force to overwrite; exiting.
```

Do not overwrite it by default. Continue with:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf wallet link
```

Only use `fcf wallet create --force` after explicit user approval because it replaces the local wallet used for future fcf actions.

## Wallet Has No Funds

Symptom: the workflow fails during transaction submission or receipt wait with an insufficient-funds style error.

Fix: fund the linked wallet address with Base Sepolia ETH, then rerun the `Register Repository` workflow. The wallet address is printed by `fcf wallet create` and `fcf wallet link`.

## Workflow Cannot Request OIDC Token

Symptom: registration cannot obtain a GitHub OIDC token.

Expected workflow permissions:

```yaml
permissions:
  contents: read
  id-token: write
```

Fix: update `.github/workflows/fcf-register.yml`, commit, push, and rerun the workflow.

## Missing Contract Or RPC Variable

Symptom: workflow fails because `FCF_CONTRACT` or `RPC_URL` is empty.

Fix:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github vars set FCF_CONTRACT "$FCF_CONTRACT"
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github vars set FCF_RPC_URL "$FCF_RPC_URL"
```

The workflow maps `FCF_RPC_URL` into the CLI's `RPC_URL` environment variable.

## Existing Registration Workflow

Symptom:

```text
fcf: .github/workflows/fcf-register.yml already exists; exiting.
```

Fix: inspect the existing workflow. If it already matches the expected registration workflow, keep it. If it is stale or incorrect, ask before running:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf init --force
```

## RIK Already Minted

Symptom: the workflow transaction reverts because the repository ID is already registered.

Fix: treat the RIK as already minted. Verify with:

```bash
gh repo view OWNER/REPO --json databaseId --jq .databaseId
RPC_URL="$FCF_RPC_URL" npm exec --yes --package=@freecodexyz/cli@alpha -- fcf list --contract "$FCF_CONTRACT" --from-block <block>
```

## JWT Audience Mismatch

Symptom:

```text
fcf: aud mismatch: want 0x..., got ...; exiting.
```

Cause: the OIDC token audience does not match the registering wallet address. The CLI normally requests the correct audience inside GitHub Actions.

Fix: do not manually provide an OIDC token unless it was requested for the lowercase wallet address that signs the transaction. Prefer rerunning the standard workflow.

## GitHub Signing Key Not Active On Contract

Symptom: the contract rejects the JWT key or signature even though the workflow is fresh.

Cause: the active GitHub Actions OIDC JWKS key may not be synced to the RIK contract.

Fix: only the contract owner should run `fcf keys sync --contract <addr>`. Do not weaken signature checks or bypass key validation.

## Workflow Dispatch Not Found

Symptom: `gh workflow run fcf-register.yml` cannot find the workflow.

Fix: commit and push `.github/workflows/fcf-register.yml` to the branch GitHub Actions will use. If using a non-default branch, dispatch with:

```bash
gh workflow run fcf-register.yml -R OWNER/REPO --ref BRANCH
```
