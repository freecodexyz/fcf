<div>
    <img src="assets/fcf-canvas-landscape.png" />
</div>

# fcf

Smart contracts and developer tooling for fcf, the funding layer for open-source software.

[Website](https://freecodefund.xyz) · [Docs](https://docs.freecodefund.xyz) · [X](https://x.com/freecodexyz)

fcf brings verifiable repository identity and on-chain funding infrastructure to GitHub-native software projects. The protocol is designed for teams, maintainers, and ecosystems that need transparent ownership, programmable distribution, and crypto-native coordination around public code.

At the foundation of fcf is the **Repository Identity Key** (**RIK**), an ERC-721 identity primitive that binds a GitHub repository to an on-chain token. A RIK can only be minted by the repository owner through a GitHub Actions OIDC proof, creating a public, cryptographically verifiable link between code and wallet-controlled protocol actions.

## Monorepo

- `contracts/`: EVM smart contracts that define protocol identity and funding primitives.
- `cli/`: command-line tooling for repository onboarding and protocol operations.

## Create a RIK

Create a **Repository Identity Key** to register a GitHub repository on-chain and establish verifiable proof of ownership for protocol interactions.

_Note: fcf is currently testing on Base Sepolia._

Install the Claude/Codex skill for AI-agent-managed RIK minting:

```shell
curl -fsSL https://raw.githubusercontent.com/freecodexyz/fcf/main/install-skill.sh | sh
```

The installer auto-detects Claude or Codex and installs `skills/rik-mint` into that agent's skills directory. To override the target, pipe into `AGENT=codex sh` or `SKILLS_DIR=/path/to/skills sh`.

Latest RIK contract:

```text
0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac
```

From the repository you want to register:

```shell
npm install --global @freecodexyz/cli@alpha
fcf wallet create
fcf wallet link
fcf github vars set FCF_CONTRACT 0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac 
fcf github vars set FCF_RPC_URL <your-base-sepolia-rpc-url> # example: https://base.sepolia.org
fcf init
```

Then:

1. Fund the created wallet with Base Sepolia ETH.
2. Commit and push `.github/workflows/fcf-register.yml`.
3. Run the `Register Repository` workflow from GitHub Actions.

The workflow verifies repository ownership through GitHub OIDC and mints the RIK for that repository.

For complete guides, protocol references, and deployment details, visit the [official fcf documentation](https://docs.freecodefund.xyz).
