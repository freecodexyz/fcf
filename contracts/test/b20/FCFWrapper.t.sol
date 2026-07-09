// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IB20} from "base-std/interfaces/IB20.sol";
import {IB20Factory} from "base-std/interfaces/IB20Factory.sol";
import {B20Constants} from "base-std/lib/B20Constants.sol";
import {StdPrecompiles} from "base-std/StdPrecompiles.sol";
import {FCFWrapper} from "../../src/b20/FCFWrapper.sol";

contract MockB20 is IB20 {
    address private constant _FACTORY = 0xB20f000000000000000000000000000000000000;

    string private _name;
    string private _symbol;
    uint8 private _decimals;
    uint256 private _totalSupply;
    uint256 private _adminCount;
    bool private _bootstrapActive;
    bool private _initialized;

    mapping(address account => uint256 balance) private _balances;
    mapping(address owner => mapping(address spender => uint256 allowance)) private _allowances;
    mapping(bytes32 role => mapping(address account => bool member)) private _roles;

    modifier onlyFactory() {
        if (msg.sender != _FACTORY) revert Unauthorized();
        _;
    }

    function initialize(string memory name_, string memory symbol_, uint8 decimals_, address initialAdmin)
        external
        onlyFactory
    {
        if (_initialized) revert Unauthorized();
        _initialized = true;
        _bootstrapActive = true;
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        if (initialAdmin != address(0)) {
            _roles[B20Constants.DEFAULT_ADMIN_ROLE][initialAdmin] = true;
            _adminCount = 1;
            emit RoleGranted(B20Constants.DEFAULT_ADMIN_ROLE, initialAdmin, msg.sender);
        }
    }

    function finishBootstrap() external onlyFactory {
        _bootstrapActive = false;
    }

    function DEFAULT_ADMIN_ROLE() external pure returns (bytes32) {
        return B20Constants.DEFAULT_ADMIN_ROLE;
    }

    function MINT_ROLE() external pure returns (bytes32) {
        return B20Constants.MINT_ROLE;
    }

    function BURN_ROLE() external pure returns (bytes32) {
        return B20Constants.BURN_ROLE;
    }

    function BURN_BLOCKED_ROLE() external pure returns (bytes32) {
        return B20Constants.BURN_BLOCKED_ROLE;
    }

    function PAUSE_ROLE() external pure returns (bytes32) {
        return B20Constants.PAUSE_ROLE;
    }

    function UNPAUSE_ROLE() external pure returns (bytes32) {
        return B20Constants.UNPAUSE_ROLE;
    }

    function METADATA_ROLE() external pure returns (bytes32) {
        return B20Constants.METADATA_ROLE;
    }

    function TRANSFER_SENDER_POLICY() external pure returns (bytes32) {
        return B20Constants.TRANSFER_SENDER_POLICY;
    }

    function TRANSFER_RECEIVER_POLICY() external pure returns (bytes32) {
        return B20Constants.TRANSFER_RECEIVER_POLICY;
    }

    function TRANSFER_EXECUTOR_POLICY() external pure returns (bytes32) {
        return B20Constants.TRANSFER_EXECUTOR_POLICY;
    }

    function MINT_RECEIVER_POLICY() external pure returns (bytes32) {
        return B20Constants.MINT_RECEIVER_POLICY;
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance(msg.sender, currentAllowance, amount);
            unchecked {
                _allowances[from][msg.sender] = currentAllowance - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert InvalidSpender(spender);
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function updateName(string calldata) external pure {
        revert Unauthorized();
    }

    function updateSymbol(string calldata) external pure {
        revert Unauthorized();
    }

    function transferWithMemo(address to, uint256 amount, bytes32 memo) external returns (bool) {
        _transfer(msg.sender, to, amount);
        emit Memo(msg.sender, memo);
        return true;
    }

    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo) external returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert InsufficientAllowance(msg.sender, currentAllowance, amount);
            unchecked {
                _allowances[from][msg.sender] = currentAllowance - amount;
            }
        }
        _transfer(from, to, amount);
        emit Memo(msg.sender, memo);
        return true;
    }

    function mint(address to, uint256 amount) external {
        _requireRole(B20Constants.MINT_ROLE);
        _mint(to, amount);
    }

    function mintWithMemo(address to, uint256 amount, bytes32 memo) external {
        _requireRole(B20Constants.MINT_ROLE);
        _mint(to, amount);
        emit Memo(msg.sender, memo);
    }

    function burn(uint256 amount) external {
        _requireRole(B20Constants.BURN_ROLE);
        _burn(msg.sender, amount);
    }

    function burnWithMemo(uint256 amount, bytes32 memo) external {
        _requireRole(B20Constants.BURN_ROLE);
        _burn(msg.sender, amount);
        emit Memo(msg.sender, memo);
    }

    function burnBlocked(address, uint256) external pure {
        revert Unauthorized();
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    function getRoleAdmin(bytes32) external pure returns (bytes32) {
        return B20Constants.DEFAULT_ADMIN_ROLE;
    }

    function grantRole(bytes32 role, address account) external {
        _requireRoleAdmin();
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            if (role == B20Constants.DEFAULT_ADMIN_ROLE) _adminCount += 1;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function revokeRole(bytes32 role, address account) external {
        _requireRoleAdmin();
        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address callerConfirmation) external {
        if (callerConfirmation != msg.sender) revert AccessControlBadConfirmation();
        if (role == B20Constants.DEFAULT_ADMIN_ROLE && _roles[role][msg.sender] && _adminCount == 1) {
            revert LastAdminCannotRenounce();
        }
        _revokeRole(role, msg.sender);
    }

    function renounceLastAdmin() external {
        if (!_roles[B20Constants.DEFAULT_ADMIN_ROLE][msg.sender]) {
            revert AccessControlUnauthorizedAccount(msg.sender, B20Constants.DEFAULT_ADMIN_ROLE);
        }
        if (_adminCount != 1) revert NotSoleAdmin();
        _roles[B20Constants.DEFAULT_ADMIN_ROLE][msg.sender] = false;
        _adminCount = 0;
        emit RoleRevoked(B20Constants.DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
        emit LastAdminRenounced(msg.sender);
    }

    function setRoleAdmin(bytes32, bytes32) external pure {
        revert Unauthorized();
    }

    function pausedFeatures() external pure returns (PausableFeature[] memory features) {
        return features;
    }

    function isPaused(PausableFeature) external pure returns (bool) {
        return false;
    }

    function pause(PausableFeature[] calldata) external pure {
        revert Unauthorized();
    }

    function unpause(PausableFeature[] calldata) external pure {
        revert Unauthorized();
    }

    function updatePolicy(bytes32, uint64) external pure {
        revert Unauthorized();
    }

    function policyId(bytes32) external pure returns (uint64) {
        return 0;
    }

    function updateSupplyCap(uint256) external pure {
        revert Unauthorized();
    }

    function supplyCap() external pure returns (uint256) {
        return type(uint128).max;
    }

    function updateContractURI(string calldata) external pure {
        revert Unauthorized();
    }

    function contractURI() external pure returns (string memory) {
        return "";
    }

    function permit(address, address, uint256, uint256, uint8, bytes32, bytes32) external pure {
        revert Unauthorized();
    }

    function nonces(address) external pure returns (uint256) {
        return 0;
    }

    function DOMAIN_SEPARATOR() external pure returns (bytes32) {
        return bytes32(0);
    }

    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name_,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (hex"0f", _name, "1", block.chainid, address(this), bytes32(0), extensions);
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (from == address(0)) revert InvalidSender(from);
        if (to == address(0)) revert InvalidReceiver(to);
        uint256 balance = _balances[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);
        unchecked {
            _balances[from] = balance - amount;
        }
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) private {
        if (to == address(0)) revert InvalidReceiver(to);
        _balances[to] += amount;
        _totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) private {
        uint256 balance = _balances[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);
        unchecked {
            _balances[from] = balance - amount;
            _totalSupply -= amount;
        }
        emit Transfer(from, address(0), amount);
    }

    function _requireRole(bytes32 role) private view {
        if (!_roles[role][msg.sender]) revert AccessControlUnauthorizedAccount(msg.sender, role);
    }

    function _requireRoleAdmin() private view {
        if (_bootstrapActive && msg.sender == _FACTORY) return;
        if (_adminCount == 0 || !_roles[B20Constants.DEFAULT_ADMIN_ROLE][msg.sender]) {
            revert AccessControlUnauthorizedAccount(msg.sender, B20Constants.DEFAULT_ADMIN_ROLE);
        }
    }

    function _revokeRole(bytes32 role, address account) private {
        if (_roles[role][account]) {
            _roles[role][account] = false;
            if (role == B20Constants.DEFAULT_ADMIN_ROLE) _adminCount -= 1;
            emit RoleRevoked(role, account, msg.sender);
        }
    }
}

contract MockB20Factory is IB20Factory {
    Vm private constant _VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    mapping(address token => bool initialized) private _initialized;

    function createB20(B20Variant variant, bytes32 salt, bytes calldata params, bytes[] calldata initCalls)
        external
        payable
        returns (address token)
    {
        if (msg.value != 0) revert NonPayable();
        if (variant != B20Variant.ASSET) revert InvalidVariant();

        B20AssetCreateParams memory assetParams = abi.decode(params, (B20AssetCreateParams));
        token = _computeAddress(variant, msg.sender, salt);
        if (_initialized[token]) revert TokenAlreadyExists(token);

        _VM.etch(token, type(MockB20).runtimeCode);
        MockB20(token).initialize(assetParams.name, assetParams.symbol, assetParams.decimals, assetParams.initialAdmin);
        emit B20Created(token, variant, assetParams.name, assetParams.symbol, assetParams.decimals, "");

        for (uint256 i = 0; i < initCalls.length; i++) {
            (bool ok, bytes memory reason) = token.call(initCalls[i]);
            if (!ok) {
                if (reason.length > 0) {
                    assembly {
                        revert(add(reason, 32), mload(reason))
                    }
                }
                revert InitCallFailed(i);
            }
        }

        MockB20(token).finishBootstrap();
        _initialized[token] = true;
    }

    function getB20Address(B20Variant variant, address sender, bytes32 salt) external pure returns (address) {
        return _computeAddress(variant, sender, salt);
    }

    function isB20(address token) external pure returns (bool) {
        return (uint160(token) >> 80) == (uint160(0xB2) << 72);
    }

    function isB20Initialized(address token) external view returns (bool) {
        return _initialized[token];
    }

    function _computeAddress(B20Variant variant, address sender, bytes32 salt) private pure returns (address) {
        bytes9 tail = bytes9(keccak256(abi.encode(sender, salt)));
        uint160 addr = (uint160(0xB2) << 152) | (uint160(uint8(variant)) << 72) | uint160(uint72(tail));
        return address(addr);
    }
}

contract RpcMockB20Factory is IB20Factory {
    mapping(address token => bool initialized) private _initialized;

    function createB20(B20Variant variant, bytes32, bytes calldata params, bytes[] calldata initCalls)
        external
        payable
        returns (address token)
    {
        if (msg.value != 0) revert NonPayable();
        if (variant != B20Variant.ASSET) revert InvalidVariant();

        B20AssetCreateParams memory assetParams = abi.decode(params, (B20AssetCreateParams));
        MockB20 b20 = new MockB20();
        token = address(b20);
        b20.initialize(assetParams.name, assetParams.symbol, assetParams.decimals, assetParams.initialAdmin);
        emit B20Created(token, variant, assetParams.name, assetParams.symbol, assetParams.decimals, "");

        for (uint256 i = 0; i < initCalls.length; i++) {
            (bool ok, bytes memory reason) = token.call(initCalls[i]);
            if (!ok) {
                if (reason.length > 0) {
                    assembly {
                        revert(add(reason, 32), mload(reason))
                    }
                }
                revert InitCallFailed(i);
            }
        }

        b20.finishBootstrap();
        _initialized[token] = true;
    }

    function getB20Address(B20Variant, address, bytes32) external pure returns (address) {
        return address(0);
    }

    function isB20(address token) external view returns (bool) {
        return _initialized[token];
    }

    function isB20Initialized(address token) external view returns (bool) {
        return _initialized[token];
    }
}

contract MockFCF is Context {
    string private _name;
    string private _symbol;
    uint8 private _decimals;
    bool private _initialized;
    bool private _missingReturns;
    bool private _returnsFalse;
    uint16 private _feeBps;
    address private _reenterTarget;
    bytes private _reenterCall;

    mapping(address account => uint256 balance) private _balances;
    mapping(address owner => mapping(address spender => uint256 allowance)) private _allowances;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);

    function initialize(string memory name_, string memory symbol_, uint8 decimals_) external {
        if (_initialized) revert();
        _initialized = true;
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setFeeBps(uint16 feeBps_) external {
        _feeBps = feeBps_;
    }

    function setMissingReturns(bool missingReturns_) external {
        _missingReturns = missingReturns_;
    }

    function setReturnsFalse(bool returnsFalse_) external {
        _returnsFalse = returnsFalse_;
    }

    function setReenter(address target, bytes calldata data) external {
        _reenterTarget = target;
        _reenterCall = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        address owner = _msgSender();
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
        return _returnValue();
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(_msgSender(), to, amount);
        return _returnValue();
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        address spender = _msgSender();
        uint256 currentAllowance = _allowances[from][spender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) revert();
            unchecked {
                _allowances[from][spender] = currentAllowance - amount;
            }
        }
        _transfer(from, to, amount);
        _callReenterTarget();
        return _returnValue();
    }

    function _transfer(address from, address to, uint256 amount) private {
        uint256 fromBalance = _balances[from];
        if (fromBalance < amount) revert();
        unchecked {
            _balances[from] = fromBalance - amount;
        }

        uint256 fee = (amount * _feeBps) / 10_000;
        uint256 received = amount - fee;
        _balances[to] += received;
        emit Transfer(from, to, received);
        if (fee != 0) emit Transfer(from, address(0), fee);
    }

    function _callReenterTarget() private {
        address target = _reenterTarget;
        if (target == address(0)) return;
        bytes memory data = _reenterCall;
        _reenterTarget = address(0);
        _reenterCall = "";
        (bool ok, bytes memory reason) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(reason, 32), mload(reason))
            }
        }
    }

    function _returnValue() private view returns (bool) {
        if (_returnsFalse) return false;
        if (_missingReturns) {
            assembly {
                return(0, 0)
            }
        }
        return true;
    }
}

contract FCFWrapperHandler is Test {
    FCFWrapper private immutable _wrapper;
    MockFCF private immutable _fcf;
    IB20 private immutable _wrappedB20;
    address private immutable _treasury;
    address[] private _actors;

    constructor(FCFWrapper wrapper_, MockFCF fcf_, address treasury_, address[] memory actors_) {
        _wrapper = wrapper_;
        _fcf = fcf_;
        _wrappedB20 = wrapper_.wrappedB20();
        _treasury = treasury_;
        _actors = actors_;

        for (uint256 i = 0; i < actors_.length; i++) {
            fcf_.mint(actors_[i], 1_000_000 ether);
            vm.startPrank(actors_[i]);
            IERC20(address(fcf_)).approve(address(wrapper_), type(uint256).max);
            IERC20(address(_wrappedB20)).approve(address(wrapper_), type(uint256).max);
            vm.stopPrank();
        }

        vm.prank(treasury_);
        IERC20(address(_wrappedB20)).approve(address(wrapper_), type(uint256).max);
    }

    function deposit(uint8 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        uint256 balance = _fcf.balanceOf(actor);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);

        vm.prank(actor);
        _wrapper.deposit(amount);
    }

    function withdraw(uint8 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        uint256 balance = _wrappedB20.balanceOf(actor);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);

        vm.prank(actor);
        _wrapper.withdraw(amount);
    }

    function transferWrapped(uint8 fromSeed, uint8 toSeed, uint256 amount) external {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 balance = _wrappedB20.balanceOf(from);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);

        vm.prank(from);
        assertTrue(_wrappedB20.transfer(to, amount));
    }

    function donateUnderlying(uint8 actorSeed, uint256 amount) external {
        address actor = _actor(actorSeed);
        uint256 balance = _fcf.balanceOf(actor);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);

        vm.prank(actor);
        assertTrue(_fcf.transfer(address(_wrapper), amount));
    }

    function recover() external {
        vm.prank(_treasury);
        _wrapper.recover(_treasury);
    }

    function sumBalances() external view returns (uint256 sum) {
        for (uint256 i = 0; i < _actors.length; i++) {
            sum += _wrappedB20.balanceOf(_actors[i]);
        }
        sum += _wrappedB20.balanceOf(_treasury);
    }

    function _actor(uint8 seed) private view returns (address) {
        return _actors[uint256(seed) % _actors.length];
    }
}

contract FCFWrapper_T is Test {
    address private constant _FCF_TOKEN = 0x67A7CA081Dc79B45fD1FA059Cd3b8dCcA779Aba3;
    bytes32 private constant _SALT = keccak256("fcf-wrapper-test");

    address private _treasury;
    address private _alice;
    address private _bob;
    address private _attacker;
    MockFCF private _fcf;
    FCFWrapper private _wrapper;
    IB20 private _wrappedB20;
    FCFWrapperHandler private _handler;

    function setUp() public {
        _treasury = makeAddr("treasury");
        _alice = makeAddr("alice");
        _bob = makeAddr("bob");
        _attacker = makeAddr("attacker");

        vm.etch(StdPrecompiles.B20_FACTORY_ADDRESS, type(MockB20Factory).runtimeCode);
        vm.etch(_FCF_TOKEN, type(MockFCF).runtimeCode);
        _fcf = MockFCF(_FCF_TOKEN);
        _fcf.initialize("fcf", "fcf", 18);

        _wrapper = new FCFWrapper(_treasury, _SALT);
        _wrappedB20 = _wrapper.wrappedB20();
        _setUpInvariantHandler();
    }

    function test_ConstructorDeploysAdminlessB20WithWrapperMintAndBurnRoles() public view {
        assertEq(address(_wrapper.underlying()), _FCF_TOKEN);
        assertEq(
            address(_wrappedB20),
            StdPrecompiles.B20_FACTORY.getB20Address(IB20Factory.B20Variant.ASSET, address(_wrapper), _SALT)
        );
        assertTrue(_wrappedB20.hasRole(B20Constants.MINT_ROLE, address(_wrapper)));
        assertTrue(_wrappedB20.hasRole(B20Constants.BURN_ROLE, address(_wrapper)));
        assertFalse(_wrappedB20.hasRole(B20Constants.DEFAULT_ADMIN_ROLE, address(_wrapper)));
        assertFalse(_wrappedB20.hasRole(B20Constants.DEFAULT_ADMIN_ROLE, StdPrecompiles.B20_FACTORY_ADDRESS));
        assertFalse(_wrappedB20.hasRole(B20Constants.BURN_BLOCKED_ROLE, address(_wrapper)));
        assertFalse(_wrappedB20.hasRole(B20Constants.PAUSE_ROLE, address(_wrapper)));
        assertFalse(_wrappedB20.hasRole(B20Constants.UNPAUSE_ROLE, address(_wrapper)));
        assertFalse(_wrappedB20.hasRole(B20Constants.METADATA_ROLE, address(_wrapper)));
    }

    function test_DepositForMintsReceivedBalanceDelta() public {
        uint256 amount = 10_000 ether;
        _fcf.mint(_alice, amount);
        _fcf.setFeeBps(100);

        vm.startPrank(_alice);
        IERC20(address(_fcf)).approve(address(_wrapper), amount);
        uint256 minted = _wrapper.depositFor(_bob, amount);
        vm.stopPrank();

        assertEq(minted, 9_900 ether);
        assertEq(_wrappedB20.balanceOf(_bob), minted);
        assertEq(_wrappedB20.totalSupply(), minted);
        assertEq(_fcf.balanceOf(address(_wrapper)), minted);
    }

    function test_DepositAcceptsMissingReturnToken() public {
        uint256 amount = 1 ether;
        _fcf.mint(_alice, amount);

        vm.startPrank(_alice);
        IERC20(address(_fcf)).approve(address(_wrapper), amount);
        vm.stopPrank();

        _fcf.setMissingReturns(true);

        vm.startPrank(_alice);
        uint256 minted = _wrapper.deposit(amount);
        vm.stopPrank();

        assertEq(minted, amount);
        assertEq(_wrappedB20.balanceOf(_alice), amount);
    }

    function test_DepositRejectsFalseReturnToken() public {
        uint256 amount = 1 ether;
        _fcf.mint(_alice, amount);
        _fcf.setReturnsFalse(true);

        vm.startPrank(_alice);
        IERC20(address(_fcf)).approve(address(_wrapper), amount);
        vm.expectRevert();
        _wrapper.deposit(amount);
        vm.stopPrank();
    }

    function test_DepositRejectsZeroAmount() public {
        vm.expectRevert(FCFWrapper.FCFWrapperZeroAmount.selector);
        _wrapper.deposit(0);
    }

    function test_DepositRejectsInvalidReceiver() public {
        vm.expectRevert(abi.encodeWithSelector(FCFWrapper.FCFWrapperInvalidReceiver.selector, address(0)));
        _wrapper.depositFor(address(0), 1);

        vm.expectRevert(abi.encodeWithSelector(FCFWrapper.FCFWrapperInvalidReceiver.selector, address(_wrapper)));
        _wrapper.depositFor(address(_wrapper), 1);
    }

    function test_WithdrawBurnsB20AndReturnsUnderlying() public {
        uint256 amount = 5 ether;
        uint256 bobBalanceBefore = _fcf.balanceOf(_bob);
        _fcf.mint(_alice, amount);

        vm.startPrank(_alice);
        IERC20(address(_fcf)).approve(address(_wrapper), amount);
        _wrapper.deposit(amount);
        IERC20(address(_wrappedB20)).approve(address(_wrapper), amount);
        _wrapper.withdrawTo(_bob, amount);
        vm.stopPrank();

        assertEq(_wrappedB20.balanceOf(_alice), 0);
        assertEq(_wrappedB20.totalSupply(), 0);
        assertEq(_fcf.balanceOf(address(_wrapper)), 0);
        assertEq(_fcf.balanceOf(_bob), bobBalanceBefore + amount);
    }

    function test_RecoverOnlyMintsExcessToTreasury() public {
        uint256 amount = 7 ether;
        _fcf.mint(address(_wrapper), amount);

        vm.prank(_treasury);
        uint256 recovered = _wrapper.recover(_treasury);

        assertEq(recovered, amount);
        assertEq(_wrappedB20.balanceOf(_treasury), amount);
        assertEq(_wrappedB20.totalSupply(), amount);
        assertEq(_fcf.balanceOf(address(_wrapper)), amount);
    }

    function test_RecoverRejectsNonTreasuryCaller() public {
        vm.expectRevert(abi.encodeWithSelector(FCFWrapper.FCFWrapperUnauthorizedRecover.selector, _alice, _treasury));
        vm.prank(_alice);
        _wrapper.recover(_treasury);
    }

    function test_RecoverRejectsArbitraryRecipient() public {
        vm.expectRevert(
            abi.encodeWithSelector(FCFWrapper.FCFWrapperInvalidRecoverRecipient.selector, _alice, _treasury)
        );
        vm.prank(_treasury);
        _wrapper.recover(_alice);
    }

    function test_ReentrantUnderlyingTransferCannotReenterDeposit() public {
        uint256 amount = 2 ether;
        _fcf.mint(_alice, amount);
        _fcf.setReenter(address(_wrapper), abi.encodeCall(FCFWrapper.deposit, (1)));

        vm.startPrank(_alice);
        IERC20(address(_fcf)).approve(address(_wrapper), amount);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _wrapper.deposit(amount);
        vm.stopPrank();
    }

    function testFuzz_RoundTripConservesBalancesForNonFeeUnderlying(uint128 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000 ether);
        _fcf.mint(_alice, amount);
        uint256 aliceUnderlyingBefore = _fcf.balanceOf(_alice);

        vm.startPrank(_alice);
        IERC20(address(_fcf)).approve(address(_wrapper), amount);
        uint256 minted = _wrapper.deposit(amount);
        IERC20(address(_wrappedB20)).approve(address(_wrapper), minted);
        uint256 withdrawn = _wrapper.withdraw(minted);
        vm.stopPrank();

        assertEq(minted, amount);
        assertEq(withdrawn, amount);
        assertEq(_fcf.balanceOf(_alice), aliceUnderlyingBefore);
        assertEq(_wrappedB20.balanceOf(_alice), 0);
        assertEq(_wrappedB20.totalSupply(), 0);
        assertEq(_fcf.balanceOf(address(_wrapper)), 0);
    }

    function invariant_WrappedB20SupplyIsCollateralized() public view {
        assertLe(_wrappedB20.totalSupply(), _fcf.balanceOf(address(_wrapper)));
    }

    function invariant_SumOfTrackedUserBalancesEqualsTotalSupply() public view {
        assertEq(_handler.sumBalances(), _wrappedB20.totalSupply());
    }

    function invariant_WrapperHoldsNoB20BetweenCalls() public view {
        assertEq(_wrappedB20.balanceOf(address(_wrapper)), 0);
    }

    function _setUpInvariantHandler() private {
        address[] memory actors = new address[](3);
        actors[0] = _alice;
        actors[1] = _bob;
        actors[2] = _attacker;
        _handler = new FCFWrapperHandler(_wrapper, _fcf, _treasury, actors);
        targetContract(address(_handler));
    }

    function afterInvariant() public view {
        assertLe(_wrappedB20.totalSupply(), _fcf.balanceOf(address(_wrapper)));
    }
}
