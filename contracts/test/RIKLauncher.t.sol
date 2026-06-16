// test/RIKLauncher.t.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Test} from "forge-std/Test.sol";
import {IAirlock, IRIKRoyaltySplitter, RIKLauncher} from "../src/RIKLauncher.sol";

contract MockAirlock is IAirlock {
    address public asset = address(0xA55E7);
    address public lastCaller;
    uint256 public lastInitialSupply;
    uint256 public lastNumTokensToSell;
    address public lastNumeraire;
    address public lastTokenFactory;
    bytes public lastTokenFactoryData;

    function create(CreateParams calldata p)
        external
        returns (address asset_, address pool, address governance, address timelock, address migrationPool)
    {
        lastCaller = msg.sender;
        lastInitialSupply = p.initialSupply;
        lastNumTokensToSell = p.numTokensToSell;
        lastNumeraire = p.numeraire;
        lastTokenFactory = p.tokenFactory;
        lastTokenFactoryData = p.tokenFactoryData;

        return (asset, address(0xB001), address(0xC0DE), address(0xD00D), address(0xE5C0));
    }
}

contract MockRegistry {
    mapping(uint256 => address) public ownerOf;

    function setOwner(uint256 repoId, address owner) external {
        ownerOf[repoId] = owner;
    }
}

contract MockRoyaltySplitter is IRIKRoyaltySplitter {
    mapping(address => uint256) public repoOf;
    address public lastCaller;

    function registerMarket(address asset, uint256 repoId) external {
        lastCaller = msg.sender;
        repoOf[asset] = repoId;
    }
}

contract RIKLauncher_T is Test {
    MockAirlock airlock;
    MockRegistry registry;
    MockRoyaltySplitter splitter;
    RIKLauncher launcher;

    uint256 repoId = 11112;
    address owner = address(0xA11CE);

    function setUp() public {
        airlock = new MockAirlock();
        registry = new MockRegistry();
        splitter = new MockRoyaltySplitter();
        launcher = new RIKLauncher(airlock, IERC721(address(registry)), splitter);

        registry.setOwner(repoId, owner);
    }

    function test_LaunchRoutesThroughAirlockAndStoresMarket() public {
        IAirlock.CreateParams memory p = _params();

        vm.expectEmit(true, true, true, true);
        emit RIKLauncher.MarketLaunched(repoId, airlock.asset(), owner);

        vm.prank(owner);
        address asset = launcher.launch(repoId, p);

        assertEq(asset, airlock.asset());
        assertEq(launcher.marketOf(repoId), asset);
        assertEq(launcher.repoOf(asset), repoId);
        assertEq(splitter.lastCaller(), address(launcher));
        assertEq(splitter.repoOf(asset), repoId);
        assertEq(airlock.lastCaller(), address(launcher));
        assertEq(airlock.lastInitialSupply(), p.initialSupply);
        assertEq(airlock.lastNumTokensToSell(), p.numTokensToSell);
        assertEq(airlock.lastNumeraire(), p.numeraire);
        assertEq(airlock.lastTokenFactory(), p.tokenFactory);
        assertEq(airlock.lastTokenFactoryData(), p.tokenFactoryData);
    }

    function test_RejectsNonRikOwner() public {
        address bob = address(0xB0B);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RIKLauncher.NotRikOwner.selector, repoId, bob));

        launcher.launch(repoId, _params());
    }

    function test_RejectsDuplicateLaunch() public {
        vm.prank(owner);
        address asset = launcher.launch(repoId, _params());

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RIKLauncher.AlreadyLaunched.selector, repoId, asset));

        launcher.launch(repoId, _params());
    }

    function _params() internal pure returns (IAirlock.CreateParams memory p) {
        p.initialSupply = 1_000_000 ether;
        p.numTokensToSell = 500_000 ether;
        p.numeraire = address(0x4200000000000000000000000000000000000006);
        p.tokenFactory = address(0x70E3);
        p.tokenFactoryData = hex"1234";
        p.governanceFactory = address(0x90C0);
        p.governanceFactoryData = hex"5678";
        p.poolInitializer = address(0xB001);
        p.poolInitializerData = hex"abcd";
        p.liquidityMigrator = address(0x1111);
        p.liquidityMigratorData = hex"dcba";
        p.integrator = address(0x2222);
        p.salt = bytes32(uint256(1));
    }
}
