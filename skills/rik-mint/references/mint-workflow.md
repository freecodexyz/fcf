# RIK Mint Workflow

Use this workflow to mint a Repository Identity Key for a GitHub repository on Base Mainnet or Base Sepolia. Keep the network, RPC URL, contract address, wallet funding, and verification calls aligned.

## 1. Confirm The Target Repository

If already in a local checkout, verify the remote:

```bash
git remote get-url origin
```

The remote must point to the requested GitHub repository, for example `https://github.com/OWNER/REPO.git` or `git@github.com:OWNER/REPO.git`.

If not already in the repo, ask for the local path or clone it if the user has asked you to handle repository setup:

```bash
gh repo clone OWNER/REPO
```

Check the worktree before editing:

```bash
git status --short
```

Do not revert unrelated user changes.

## 2. Set Common Values

Use user-provided, verified values when available. The project currently documents this Base Sepolia deployment:

```bash
FCF_NETWORK=base-sepolia
FCF_CONTRACT=0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac
FCF_RPC_URL=https://sepolia.base.org
FCF_CHAIN_ID=84532
```

For Base Mainnet, require the deployed RIK address instead of guessing it:

```bash
FCF_NETWORK=base-mainnet
FCF_CONTRACT=<deployed-base-mainnet-rik-address>
FCF_RPC_URL=https://mainnet.base.org
FCF_CHAIN_ID=8453
```

Base's public RPC endpoints are rate-limited; use the user's provider URL when supplied. Verify the RPC chain before writing repository variables or spending funds:

```bash
cast chain-id --rpc-url "$FCF_RPC_URL"
```

Require the result to equal `FCF_CHAIN_ID`. If `cast` is unavailable, query `eth_chainId` with another JSON-RPC client. Do not proceed on a mismatch.

When running local fcf commands that read chain state, set `RPC_URL` explicitly. The current CLI otherwise defaults to Base Mainnet:

```bash
RPC_URL="$FCF_RPC_URL" npm exec --yes --package=@freecodexyz/cli@alpha -- fcf list --contract "$FCF_CONTRACT"
```

## 3. Verify GitHub Credentials

The fcf CLI reads GitHub auth from local git credentials. From the target repo:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github whoami
```

If this fails, set up GitHub credentials before continuing. With GitHub CLI:

```bash
gh auth status
gh auth login
gh auth setup-git
```

The authenticated GitHub user must be allowed to write Actions secrets, Actions variables, and workflow files for the target repository.

## 4. Create Or Reuse The fcf Wallet

Try to create the local wallet:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf wallet create
```

If it reports that a wallet already exists, do not use `--force`; reuse the existing wallet.

Link the wallet to the repository as the encrypted `FCF_PRIVATE_KEY` GitHub Actions secret:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf wallet link
```

The command prints the public wallet address. Save that address in working notes and ask the user to fund it with ETH on `FCF_NETWORK` if it is not already funded. Never inspect or print the private key file.

## 5. Set GitHub Actions Variables

Set the target RIK contract and RPC URL in repository variables:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github vars set FCF_CONTRACT "$FCF_CONTRACT"
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github vars set FCF_RPC_URL "$FCF_RPC_URL"
```

Optionally confirm variable metadata:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github vars get FCF_CONTRACT
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf github vars get FCF_RPC_URL
```

## 6. Add The Registration Workflow

Generate the GitHub Actions workflow:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf init
```

If `.github/workflows/fcf-register.yml` already exists, inspect it. The expected workflow has:

```yaml
name: Register Repository
on:
  workflow_dispatch:
permissions:
  contents: read
  id-token: write
```

It should use Node 24 through `actions/setup-node@v6`, map `FCF_RPC_URL` to `RPC_URL`, and map the encrypted `FCF_PRIVATE_KEY` secret to `PRIVATE_KEY`.

The registration step should run:

```bash
npm exec --yes --package=@freecodexyz/cli@alpha -- fcf register --contract "$FCF_CONTRACT"
```

Only run `fcf init --force` when the user agrees to replace the existing workflow.

## 7. Commit And Push The Workflow

If the workflow file is new or changed, follow the target repository's contribution and approval rules. Stage only that file unless the user requested broader changes:

```bash
git status --short
git add .github/workflows/fcf-register.yml
git commit
git push
```

The workflow must exist on the repository's default branch before GitHub accepts `workflow_dispatch`. If it is already present there and the desired version exists at the ref to run, skip this step.

## 8. Verify Wallet Funding

Use the public address printed by `fcf wallet link`:

```bash
cast balance "$FCF_WALLET_ADDRESS" --ether --rpc-url "$FCF_RPC_URL"
```

If `cast` is unavailable, query the balance with another JSON-RPC client. Do not dispatch until the address has enough ETH on the selected network.

## 9. Dispatch The Registration Workflow

Use GitHub CLI when available:

```bash
gh workflow run fcf-register.yml -R OWNER/REPO
```

If running the version from a non-default branch after the workflow exists on the default branch, include the branch ref:

```bash
gh workflow run fcf-register.yml -R OWNER/REPO --ref BRANCH
```

Find and watch the run:

```bash
gh run list -R OWNER/REPO --workflow fcf-register.yml --limit 1
gh run watch RUN_ID -R OWNER/REPO --exit-status
```

Fetch logs if you need the transaction hash:

```bash
gh run view RUN_ID -R OWNER/REPO --log
```

The successful registration log includes a line like:

```text
registered: 0x... status=success
```

## 10. Verify The Mint

Get the GitHub repository database ID:

```bash
gh repo view OWNER/REPO --json databaseId --jq .databaseId
```

List recent RIK registrations and look for `repo=<databaseId>`:

```bash
RPC_URL="$FCF_RPC_URL" npm exec --yes --package=@freecodexyz/cli@alpha -- fcf list --contract "$FCF_CONTRACT"
```

If the event is older than the default list window, rerun with `--from-block <block>`.

Require the workflow log to report `status=success`; a transaction hash alone is insufficient. When `cast` is available, also verify that the token exists and is owned by the linked wallet:

```bash
cast call "$FCF_CONTRACT" "ownerOf(uint256)(address)" "$REPO_ID" --rpc-url "$FCF_RPC_URL"
```

The RIK token ID is the GitHub repository database ID. Report the network, contract address, repository ID, transaction hash, receipt status, and current token owner.
