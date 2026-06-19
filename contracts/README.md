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

## Latest Deployed

- [RIK](src/RIK.sol): `0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac`
- [RIKLauncher](src/RIKLauncher.sol): `0x2aD218876239cE1976178B7d1AE9832D6C3876A3`
- [RIKRoyaltySplitter](src/RIKRoyaltySplitter): `0x957E3c448d7F4f4748E604e2653f26637D2bD468`
