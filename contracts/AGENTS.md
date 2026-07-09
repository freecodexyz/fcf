# AGENTS.md

## Role

You are editing a Solidity smart-contract repository. Optimize for auditability, semantic consistency, and small override surfaces. Write code in the OpenZeppelin v5 style: private state, explicit invariants, custom errors, narrow interfaces, and tests that prove behavior.

## Scope

These rules apply to Solidity contracts, libraries, interfaces, scripts, and tests. When a deeper directory has its own `AGENTS.md`, follow the closest file for that subtree.

## Solidity code rules

Use named imports only. Do not use wildcard imports. Prefix interfaces with `I`. Mark contracts `abstract` when they are not deployable as-is.

```solidity
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVault {
    function totalAssets() external view returns (uint256);
}

abstract contract BaseVault is IVault {
    // Not deployable without a concrete asset/accounting implementation.
}
```

Keep every state variable `private` and underscore-prefixed. Expose reads through `public view virtual` getters. Do not make storage public just to get an auto-generated getter. Changes to state must go through functions that enforce events and invariants.

```solidity
mapping(address account => uint256 balance) private _balances;
uint256 private _totalSupply;

function balanceOf(address account) public view virtual returns (uint256) {
    return _balances[account];
}

function totalSupply() public view virtual returns (uint256) {
    return _totalSupply;
}
```

Use one mutation choke point per state concept. Public/external functions and convenience internals validate inputs, resolve `_msgSender()`, then delegate to one `internal virtual` function that performs the actual state change. Thin aliases are not virtual; override the underlying choke point instead.

```solidity
function transfer(address to, uint256 value) public virtual returns (bool) {
    address owner = _msgSender();
    _transfer(owner, to, value);
    return true;
}

function _transfer(address from, address to, uint256 value) internal {
    if (from == address(0)) revert ERC20InvalidSender(address(0));
    if (to == address(0)) revert ERC20InvalidReceiver(address(0));
    _update(from, to, value);
}

function _update(address from, address to, uint256 value) internal virtual {
    // All balance and supply mutation for this concept happens here.
}
```

In reusable contracts, do not read `msg.sender` or `msg.data` directly. Inherit/use `Context` and call `_msgSender()` and `_msgData()` so meta-transaction variants can override semantics.

```solidity
function deposit(uint256 assets) external virtual {
    address caller = _msgSender();
    _deposit(caller, caller, assets);
}
```

Use custom errors, not revert strings, for domain failures. Prefer ERC-6093 names for token errors such as `ERC20InvalidSender`, `ERC20InsufficientBalance`, and `ERC20InvalidSpender`. Revert on failure; do not return `false` unless an external standard forces the signature.

```solidity
error VaultZeroAssets();
error VaultUnauthorizedAccount(address account);

function _deposit(address caller, address receiver, uint256 assets) internal virtual {
    if (assets == 0) revert VaultZeroAssets();
    if (receiver == address(0)) revert ERC20InvalidReceiver(address(0));

    // Do not write: require(assets != 0, "zero assets");
}
```

Use `address(0)` deliberately. In token update choke points it is the sentinel for mint and burn, and standard `Transfer` events must encode mint/burn through zero-address endpoints. Boundary wrappers such as `_mint` and `_burn` still validate invalid zero-address usage.

```solidity
function _mint(address to, uint256 value) internal {
    if (to == address(0)) revert ERC20InvalidReceiver(address(0));
    _update(address(0), to, value);
}

function _burn(address from, uint256 value) internal {
    if (from == address(0)) revert ERC20InvalidSender(address(0));
    _update(from, address(0), value);
}
```

Emit events immediately after the state mutation they describe. New events should be past-tense, e.g. `OwnershipTransferred`, `TokensBurned`, `RoleGranted`. Index address, account, and role fields that off-chain systems filter on; leave amounts unindexed unless there is a clear indexing reason.

```solidity
event DepositCompleted(address indexed caller, address indexed receiver, uint256 assets);

function _deposit(address caller, address receiver, uint256 assets) internal virtual {
    _totalAssets += assets;
    emit DepositCompleted(caller, receiver, assets);
}
```

Cache storage reads when the value is used more than once. Every `unchecked` block must be locally justified by a preceding check or an adjacent comment proving overflow or underflow impossible.

```solidity
uint256 fromBalance = _balances[from];
if (fromBalance < value) {
    revert ERC20InsufficientBalance(from, fromBalance, value);
}
unchecked {
    // Safe because value <= fromBalance was checked above.
    _balances[from] = fromBalance - value;
}
```

Treat `type(uint256).max` allowance as infinite and do not decrement it. Use the overloaded-internal pattern for event escape hatches: the simple overload is non-virtual and delegates to the full virtual overload with explicit behavior flags such as `emitEvent`.

```solidity
function _approve(address owner, address spender, uint256 value) internal {
    _approve(owner, spender, value, true);
}

function _approve(address owner, address spender, uint256 value, bool emitEvent) internal virtual {
    _allowances[owner][spender] = value;
    if (emitEvent) emit Approval(owner, spender, value);
}

function _spendAllowance(address owner, address spender, uint256 value) internal virtual {
    uint256 currentAllowance = allowance(owner, spender);
    if (currentAllowance < type(uint256).max) {
        if (currentAllowance < value) {
            revert ERC20InsufficientAllowance(spender, currentAllowance, value);
        }
        unchecked {
            // Safe because currentAllowance >= value was checked above.
            _approve(owner, spender, currentAllowance - value, false);
        }
    }
}
```

Use `SafeERC20` for every external ERC20 interaction. Do not call `transfer`, `transferFrom`, or `approve` raw on token contracts. Use `safeTransfer`, `safeTransferFrom`, `forceApprove`, `safeIncreaseAllowance`, and `safeDecreaseAllowance` as appropriate. Use `Address` helpers for low-level value transfers and function calls.

```solidity
using SafeERC20 for IERC20;

function pull(IERC20 token, address from, uint256 amount) external {
    token.safeTransferFrom(from, address(this), amount);
}

function sweepNative(address payable to, uint256 amount) external onlyOwner {
    Address.sendValue(to, amount);
}
```

For contracts with authority over funds, ownership, upgrades, or roles, prefer two-step ownership transfer or explicit `AccessControl` roles. Do not introduce single-step owner handoff for production authority paths.

```solidity
contract ManagedVault is Ownable2Step, AccessControl {
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

    function harvest() external onlyRole(KEEPER_ROLE) {
        _harvest();
    }
}
```

For upgradeable contracts, use ERC-7201-style namespaced storage structs. Do not add top-level state variables to proxy implementations. Use `initializer`/`reinitializer`, `__Module_init` and `__Module_init_unchained`, and disable initializers on the implementation contract.

```solidity
/// @custom:storage-location erc7201:myapp.storage.Vault
struct VaultStorage {
    uint256 _totalAssets;
    mapping(address account => uint256 shares) _shares;
}

bytes32 private constant VaultStorageLocation =
    0x0f4c8d1c0d5bb98f9f2f2a5c6d97d65b1b18143a6b7397d2f5f7b6f0e6f9b500;

function _getVaultStorage() private pure returns (VaultStorage storage $) {
    assembly {
        $.slot := VaultStorageLocation
    }
}
```

## NatSpec

Every public, external, and `internal virtual` function must explain behavior. Use `@inheritdoc` when implementing an interface without semantic changes. Add `Requirements:` and `Emits:` blocks when a function has preconditions or events. If an alias should not be overridden, say which function should be overridden instead.

```solidity
/**
 * @dev Moves `assets` from `caller` into the vault and credits `receiver`.
 *
 * Requirements:
 *
 * - `assets` must be non-zero.
 * - `receiver` must not be the zero address.
 *
 * Emits a {DepositCompleted} event.
 */
function _deposit(address caller, address receiver, uint256 assets) internal virtual;

/// @inheritdoc IERC20
function balanceOf(address account) public view virtual returns (uint256);
```

## Tests

Add or update tests with every behavior change. Cover normal paths, reverts, event emission, and edge cases. Use fuzz tests for math-heavy code and invariant tests for state machines. Every bug fix must include a regression test that fails without the fix. Do not weaken tests to make a patch pass.

```solidity
function testFuzz_DepositCreditsReceiver(uint256 assets) public {
    assets = bound(assets, 1, type(uint128).max);
    vault.deposit(assets, receiver);
    assertEq(vault.balanceOf(receiver), assets);
}

function invariant_TotalSupplyEqualsAccountedBalances() public view {
    assertEq(vault.totalSupply(), handler.accountedBalances());
}
```

## Do not

Do not use wildcard imports, public state variables, raw `msg.sender` in reusable code, `require(..., "string")` for domain errors, raw ERC20 calls, unexplained `unchecked`, pre-mutation events, single-step ownership transfer for production authority, top-level storage in upgradeable implementations, or multiple override points for the same state transition.
