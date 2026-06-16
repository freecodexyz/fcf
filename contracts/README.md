<div>
    <img src="../assets/fcf-canvas-landscape-contracts.png" />
</div>

# Contracts

Foundry workspace for fcf EVM contracts.

## Contracts

- `src/RIK.sol`: [Repository Identity Key](https://x.com/paoloanzn/status/2062559466760159598?s=20), an ERC-721 that registers GitHub repository identities from GitHub Actions OIDC JWTs.

## Commands

Run from this directory:

```shell
forge fmt --check
forge build --sizes
forge test -vvv
```

Deploy scripts live in `script/` and deployment helpers live beside this README.
