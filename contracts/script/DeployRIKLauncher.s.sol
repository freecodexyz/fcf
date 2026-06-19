// script/DeployRIKLauncher.s.sol
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Script} from "forge-std/Script.sol";
import {IAirlock, IRIKRoyaltySplitter, RIKLauncher} from "../src/RIKLauncher.sol";
import {IAirlockClaims, RIKRoyaltySplitter} from "../src/RIKRoyaltySplitter.sol";

contract DeployRIKLauncher is Script {
    function run() external returns (RIKLauncher launcher, RIKRoyaltySplitter splitter) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address airlock = vm.envAddress("AIRLOCK_ADDRESS");
        address registry = vm.envAddress("RIK_ADDRESS");

        uint64 nonce = vm.getNonce(deployer);
        address launcherAddress = vm.computeCreateAddress(deployer, nonce);
        address splitterAddress = vm.computeCreateAddress(deployer, nonce + 1);

        vm.startBroadcast(deployerPrivateKey);
        launcher = new RIKLauncher(IAirlock(airlock), IERC721(registry), IRIKRoyaltySplitter(splitterAddress));
        splitter = new RIKRoyaltySplitter(IERC721(registry), IAirlockClaims(airlock), launcherAddress);
        vm.stopBroadcast();

        require(address(launcher) == launcherAddress, "launcher address mismatch");
        require(address(splitter) == splitterAddress, "splitter address mismatch");
    }
}
