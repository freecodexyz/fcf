// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";
import {B20FactoryLib} from "base-std/lib/B20FactoryLib.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";

/**
 * @title FCFWrapper
 * @notice Immutable 1:1 wrapper between the Base fcf ERC-20 and a freshly deployed B20 Asset token.
 */
contract FCFWrapper is Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address private constant _FCF_TOKEN = 0x67A7CA081Dc79B45fD1FA059Cd3b8dCcA779Aba3;
    string private constant _WRAPPED_NAME = "Wrapped Freecode";
    string private constant _WRAPPED_SYMBOL = "WFCF";
    uint8 private constant _WRAPPED_DECIMALS = 18;

    IERC20 private immutable _underlying;
    IB20 private immutable _wrappedB20;
    address private immutable _treasury;

    error FCFWrapperInvalidReceiver(address receiver);
    error FCFWrapperInvalidTreasury(address treasury);
    error FCFWrapperInvalidRecoverRecipient(address recipient, address treasury);
    error FCFWrapperNoUnderlyingReceived(uint256 balanceBefore, uint256 balanceAfter);
    error FCFWrapperUnauthorizedRecover(address caller, address treasury);
    error FCFWrapperZeroAmount();

    event FCFDeposited(address indexed caller, address indexed receiver, uint256 requested, uint256 minted);
    event FCFWithdrawn(address indexed caller, address indexed receiver, uint256 amount);
    event FCFRecovered(address indexed caller, address indexed treasury, uint256 amount);

    /**
     * @dev Deploys the paired B20 Asset token and permanently removes its default admin.
     *
     * Requirements:
     *
     * - `treasury_` must not be the zero address.
     * - `salt` must not collide with an existing B20 Asset for this wrapper address.
     *
     * Emits the B20 factory and B20 role events during construction.
     */
    constructor(address treasury_, bytes32 salt) {
        if (treasury_ == address(0)) revert FCFWrapperInvalidTreasury(treasury_);

        _underlying = IERC20(_FCF_TOKEN);
        _treasury = treasury_;

        bytes[] memory initCalls = new bytes[](3);
        initCalls[0] = B20FactoryLib.encodeGrantRole(B20Constants.MINT_ROLE, address(this));
        initCalls[1] = B20FactoryLib.encodeGrantRole(B20Constants.BURN_ROLE, address(this));
        initCalls[2] = abi.encodeCall(IB20.renounceLastAdmin, ());

        bytes memory params = B20FactoryLib.encodeAssetCreateParams(
            _WRAPPED_NAME, _WRAPPED_SYMBOL, StdPrecompiles.B20_FACTORY_ADDRESS, _WRAPPED_DECIMALS
        );

        address wrappedB20_ =
            StdPrecompiles.B20_FACTORY.createB20(IB20Factory.B20Variant.ASSET, salt, params, initCalls);
        _wrappedB20 = IB20(wrappedB20_);
    }

    /**
     * @notice Returns the Base fcf ERC-20 address wrapped by this contract.
     */
    function fcfToken() public pure returns (address) {
        return _FCF_TOKEN;
    }

    /**
     * @notice Returns the ERC-20 token that backs the wrapped B20.
     */
    function underlying() public view returns (IERC20) {
        return _underlying;
    }

    /**
     * @notice Returns the wrapped B20 Asset token minted and burned by this contract.
     */
    function wrappedB20() public view returns (IB20) {
        return _wrappedB20;
    }

    /**
     * @notice Returns the immutable treasury that receives recovered excess collateral.
     */
    function treasury() public view returns (address) {
        return _treasury;
    }

    /**
     * @notice Deposits fcf from the caller and mints wrapped B20 to the caller.
     *
     * Requirements:
     *
     * - `amount` must be non-zero.
     * - The caller must have approved this wrapper to transfer at least `amount` fcf.
     *
     * Emits an {FCFDeposited} event.
     */
    function deposit(uint256 amount) external nonReentrant returns (uint256 minted) {
        address caller = _msgSender();
        return _deposit(caller, caller, amount);
    }

    /**
     * @notice Deposits fcf from the caller and mints wrapped B20 to `receiver`.
     *
     * Requirements:
     *
     * - `receiver` must not be the zero address or this wrapper.
     * - `amount` must be non-zero.
     * - The caller must have approved this wrapper to transfer at least `amount` fcf.
     *
     * Emits an {FCFDeposited} event.
     */
    function depositFor(address receiver, uint256 amount) external nonReentrant returns (uint256 minted) {
        return _deposit(_msgSender(), receiver, amount);
    }

    /**
     * @notice Burns wrapped B20 from the caller and withdraws fcf to the caller.
     *
     * Requirements:
     *
     * - `amount` must be non-zero.
     * - The caller must have approved this wrapper to transfer at least `amount` wrapped B20.
     *
     * Emits an {FCFWithdrawn} event.
     */
    function withdraw(uint256 amount) external nonReentrant returns (uint256 withdrawn) {
        address caller = _msgSender();
        return _withdraw(caller, caller, amount);
    }

    /**
     * @notice Burns wrapped B20 from the caller and withdraws fcf to `receiver`.
     *
     * Requirements:
     *
     * - `receiver` must not be the zero address or this wrapper.
     * - `amount` must be non-zero.
     * - The caller must have approved this wrapper to transfer at least `amount` wrapped B20.
     *
     * Emits an {FCFWithdrawn} event.
     */
    function withdrawTo(address receiver, uint256 amount) external nonReentrant returns (uint256 withdrawn) {
        return _withdraw(_msgSender(), receiver, amount);
    }

    /**
     * @notice Mints wrapped B20 for excess fcf held by the wrapper to the immutable treasury.
     *
     * @dev `to` is accepted only when it equals {treasury}; this preserves the OZ `_recover(to)`
     *      shape while preventing arbitrary recovery destinations.
     *
     * Requirements:
     *
     * - The caller must be {treasury}.
     * - `to` must equal {treasury}.
     *
     * Emits an {FCFRecovered} event.
     */
    function recover(address to) external nonReentrant returns (uint256 recovered) {
        address caller = _msgSender();
        address treasury_ = _treasury;
        if (caller != treasury_) revert FCFWrapperUnauthorizedRecover(caller, treasury_);
        recovered = _recover(to);
        emit FCFRecovered(caller, treasury_, recovered);
    }

    /**
     * @dev Pulls fcf from `caller` and mints the received balance delta to `receiver`.
     */
    function _deposit(address caller, address receiver, uint256 amount) internal virtual returns (uint256 minted) {
        if (receiver == address(0) || receiver == address(this)) revert FCFWrapperInvalidReceiver(receiver);
        if (amount == 0) revert FCFWrapperZeroAmount();

        IERC20 underlying_ = _underlying;
        uint256 balanceBefore = underlying_.balanceOf(address(this));
        underlying_.safeTransferFrom(caller, address(this), amount);
        uint256 balanceAfter = underlying_.balanceOf(address(this));
        if (balanceAfter <= balanceBefore) revert FCFWrapperNoUnderlyingReceived(balanceBefore, balanceAfter);

        minted = balanceAfter - balanceBefore;
        _wrappedB20.mint(receiver, minted);
        emit FCFDeposited(caller, receiver, amount, minted);
    }

    /**
     * @dev Pulls wrapped B20 from `caller`, burns it from this wrapper, and releases fcf to `receiver`.
     */
    function _withdraw(address caller, address receiver, uint256 amount) internal virtual returns (uint256 withdrawn) {
        if (receiver == address(0) || receiver == address(this)) revert FCFWrapperInvalidReceiver(receiver);
        if (amount == 0) revert FCFWrapperZeroAmount();

        IERC20(address(_wrappedB20)).safeTransferFrom(caller, address(this), amount);
        _wrappedB20.burn(amount);
        _underlying.safeTransfer(receiver, amount);

        emit FCFWithdrawn(caller, receiver, amount);
        return amount;
    }

    /**
     * @dev Mints wrapped B20 to `to` for fcf collateral that is not yet represented by B20 supply.
     */
    function _recover(address to) internal virtual returns (uint256 recovered) {
        address treasury_ = _treasury;
        if (to != treasury_) revert FCFWrapperInvalidRecoverRecipient(to, treasury_);

        recovered = _underlying.balanceOf(address(this)) - _wrappedB20.totalSupply();
        _wrappedB20.mint(treasury_, recovered);
    }
}
