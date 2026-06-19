// test/RIKRoyaltySplitter.t.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Test} from "forge-std/Test.sol";
import {IAirlockClaims, IMulticurvePool, RIKRoyaltySplitter} from "../src/RIKRoyaltySplitter.sol";

contract SplitterMockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract SplitterMockAirlockClaims is IAirlockClaims {
    mapping(address => mapping(address => uint256)) public fees;

    function setFees(address integrator, address token, uint256 amount) external {
        fees[integrator][token] = amount;
    }

    function getIntegratorFees(address integrator, address token) external view returns (uint256) {
        return fees[integrator][token];
    }

    function collectIntegratorFees(address to, address token, uint256 amount) external {
        uint256 owed = fees[msg.sender][token];
        require(owed >= amount, "fees");
        fees[msg.sender][token] = owed - amount;
        require(IERC20(token).transfer(to, amount), "transfer");
    }
}

contract SplitterMockRegistry {
    mapping(uint256 => address) public ownerOf;

    function setOwner(uint256 repoId, address owner) external {
        ownerOf[repoId] = owner;
    }
}

contract SplitterMockPool is IMulticurvePool {
    address public token0;
    address public token1;
    uint256 public fees0;
    uint256 public fees1;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function setFees(uint256 _fees0, uint256 _fees1) external {
        fees0 = _fees0;
        fees1 = _fees1;
    }

    function collectFees() external {
        uint256 amount0 = fees0;
        uint256 amount1 = fees1;
        fees0 = 0;
        fees1 = 0;

        if (amount0 != 0) require(IERC20(token0).transfer(msg.sender, amount0), "transfer0");
        if (amount1 != 0) require(IERC20(token1).transfer(msg.sender, amount1), "transfer1");
    }
}

contract RIKRoyaltySplitter_T is Test {
    SplitterMockRegistry registry;
    SplitterMockAirlockClaims airlock;
    SplitterMockERC20 token;
    RIKRoyaltySplitter splitter;

    uint256 repoId = 11112;
    address launcher = address(0x1A4C);
    address owner = address(0xA11CE);

    function setUp() public {
        registry = new SplitterMockRegistry();
        airlock = new SplitterMockAirlockClaims();
        token = new SplitterMockERC20();
        splitter = new RIKRoyaltySplitter(IERC721(address(registry)), airlock, launcher);

        registry.setOwner(repoId, owner);
    }

    function test_strangerCannotRegister() public {
        address asset = address(0xA55E7);

        vm.expectRevert(RIKRoyaltySplitter.OnlyLauncher.selector);
        splitter.registerMarket(asset, 42);
    }

    function test_RegisterMarketOnlyLauncher() public {
        address asset = address(0xA55E7);

        vm.expectRevert(RIKRoyaltySplitter.OnlyLauncher.selector);
        splitter.registerMarket(asset, repoId);

        vm.prank(launcher);
        splitter.registerMarket(asset, repoId);

        assertEq(splitter.repoOf(asset), repoId);
    }

    function test_PullAccruesFeesFromAirlock() public {
        uint256 amount = 10 ether;
        _fundFees(amount);

        vm.expectEmit(true, true, false, true);
        emit RIKRoyaltySplitter.Accrued(repoId, address(token), amount);

        splitter.pull(repoId, address(token));

        assertEq(splitter.claimable(repoId, address(token)), amount);
        assertEq(token.balanceOf(address(splitter)), amount);
        assertEq(airlock.fees(address(splitter), address(token)), 0);
    }

    function test_PullRejectsNothingToClaim() public {
        vm.expectRevert(RIKRoyaltySplitter.NothingToClaim.selector);

        splitter.pull(repoId, address(token));
    }

    function test_ClaimRequiresRikOwner() public {
        uint256 amount = 10 ether;
        address bob = address(0xB0B);
        _accrue(amount);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RIKRoyaltySplitter.NotRikOwner.selector, repoId, bob));

        splitter.claim(repoId, address(token), bob);
    }

    function test_ClaimTransfersAndClearsBucket() public {
        uint256 amount = 10 ether;
        address recipient = address(0xCAFE);
        _accrue(amount);

        vm.expectEmit(true, true, true, true);
        emit RIKRoyaltySplitter.Claimed(repoId, address(token), recipient, amount);

        vm.prank(owner);
        uint256 claimed = splitter.claim(repoId, address(token), recipient);

        assertEq(claimed, amount);
        assertEq(splitter.claimable(repoId, address(token)), 0);
        assertEq(token.balanceOf(recipient), amount);

        vm.prank(owner);
        vm.expectRevert(RIKRoyaltySplitter.NothingToClaim.selector);
        splitter.claim(repoId, address(token), recipient);
    }

    function test_PullLpAcceptsRegisteredAssetOnEitherSide() public {
        SplitterMockERC20 asset = new SplitterMockERC20();
        SplitterMockERC20 numeraire = new SplitterMockERC20();

        vm.prank(launcher);
        splitter.registerMarket(address(asset), repoId);

        splitter.pullLp(new SplitterMockPool(address(asset), address(numeraire)));
        splitter.pullLp(new SplitterMockPool(address(numeraire), address(asset)));
    }

    function test_pullLpForUnknownPoolReverts() public {
        SplitterMockPool pool = new SplitterMockPool(address(0x1111), address(0x2222));

        vm.expectRevert(RIKRoyaltySplitter.UnknownPool.selector);

        splitter.pullLp(pool);
    }

    function test_PullLpRejectsUnknownPool() public {
        SplitterMockPool pool = new SplitterMockPool(address(0x1111), address(0x2222));

        vm.expectRevert(RIKRoyaltySplitter.UnknownPool.selector);

        splitter.pullLp(pool);
    }

    function test_pullLpDerivesRepoFromPool() public {
        uint256 otherRepoId = 22223;
        SplitterMockERC20 numeraire = new SplitterMockERC20();
        SplitterMockPool pool = new SplitterMockPool(address(token), address(numeraire));
        uint256 amount = 3 ether;

        vm.prank(launcher);
        splitter.registerMarket(address(token), repoId);

        numeraire.mint(address(pool), amount);
        pool.setFees(0, amount);

        splitter.pullLp(pool);

        assertEq(splitter.claimable(repoId, address(numeraire)), amount);
        assertEq(splitter.claimable(otherRepoId, address(numeraire)), 0);
    }

    function test_twoReposIndependent() public {
        uint256 repoA = 11112;
        uint256 repoB = 22223;
        SplitterMockERC20 assetA = new SplitterMockERC20();
        SplitterMockERC20 assetB = new SplitterMockERC20();
        SplitterMockERC20 weth = new SplitterMockERC20();
        SplitterMockPool poolA = new SplitterMockPool(address(assetA), address(weth));
        SplitterMockPool poolB = new SplitterMockPool(address(assetB), address(weth));

        vm.startPrank(launcher);
        splitter.registerMarket(address(assetA), repoA);
        splitter.registerMarket(address(assetB), repoB);
        vm.stopPrank();

        weth.mint(address(poolA), 3 ether);
        weth.mint(address(poolB), 7 ether);
        poolA.setFees(0, 3 ether);
        poolB.setFees(0, 7 ether);

        splitter.pullLp(poolA);
        splitter.pullLp(poolB);

        uint256 claimableA = splitter.claimable(repoA, address(weth));
        uint256 claimableB = splitter.claimable(repoB, address(weth));
        assertGt(claimableA, 0);
        assertGt(claimableB, 0);
        assertNotEq(claimableA, claimableB);
    }

    function _fundFees(uint256 amount) internal {
        token.mint(address(airlock), amount);
        airlock.setFees(address(splitter), address(token), amount);
    }

    function _accrue(uint256 amount) internal {
        _fundFees(amount);
        splitter.pull(repoId, address(token));
    }
}
