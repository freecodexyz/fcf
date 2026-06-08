# fcf

Smart contracts and tooling for the FCF protocol.

[Website](https://freecodefund.xyz) · [X](https://x.com/freecodexyz)

## Monorepo

- `contracts/`: EVM contracts for the protocol.
- `cli/`: command-line tooling for repository setup and protocol operations.

## Create a RIK

Create your own **Repository Identity Key**. It lets a GitHub repository register its identity on-chain using a GitHub Actions OIDC token. 

**RIK** it's the first protocol that certifies **Proof-of-Ownership** by minting a unique on-chain token only the repo owner can issue.

_Note: FCF is currently testing on Sepolia._

Latest RIK contract:

```text
0xf696da98df236a36536e9385dAf05D196579612B
```

From the repository you want to register:

```shell
npm install --global @freecodexyz/cli@alpha
fcf wallet create
fcf wallet link
fcf github vars set FCF_CONTRACT 0xf696da98df236a36536e9385dAf05D196579612B
fcf github vars set FCF_RPC_URL <your-sepolia-rpc-url>
fcf init
```

Then:

1. Fund the created wallet with Sepolia ETH.
2. Commit and push `.github/workflows/fcf-register.yml`.
3. Run the `Register Repository` workflow from GitHub Actions.

The workflow mints the RIK for that repository.
