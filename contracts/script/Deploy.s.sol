// script/Deploy.s.sol
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {RIK} from "../src/RIK.sol";

contract Deploy is Script {
    function run() external returns (RIK rik) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        address proxy = Upgrades.deployTransparentProxy("RIK.sol", owner, abi.encodeCall(RIK.initialize, (owner)));
        rik = RIK(proxy);
        vm.stopBroadcast();
    }
}
