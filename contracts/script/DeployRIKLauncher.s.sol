// script/DeployRIKLauncher.s.sol
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Script} from "forge-std/Script.sol";
import {IAirlock, IRIKRoyaltySplitter, RIKLauncher} from "../src/RIKLauncher.sol";

contract DeployRIKLauncher is Script {
    function run() external returns (RIKLauncher launcher) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address airlock = vm.envAddress("AIRLOCK_ADDRESS");
        address registry = vm.envAddress("RIK_ADDRESS");
        address splitter = vm.envAddress("SPLITTER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        launcher = new RIKLauncher(IAirlock(airlock), IERC721(registry), IRIKRoyaltySplitter(splitter));
        vm.stopBroadcast();
    }
}
