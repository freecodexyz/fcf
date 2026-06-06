// script/Deploy.s.sol
// SDPX-License-Identifier: Apache-2.0

pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {RIK} from "../src/RIK.sol";

contract Deploy is Script {
    function run() external returns (RIK rik) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        rik = new RIK(owner);
        vm.stopBroadcast();
    }
}
