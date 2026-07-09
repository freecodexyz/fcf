// script/DeployFCFWrapper.s.sol
// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {FCFWrapper} from "../src/b20/FCFWrapper.sol";

contract DeployFCFWrapper is Script {
    function run() external returns (FCFWrapper wrapper) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        bytes32 salt = vm.envOr("FCF_WRAPPER_SALT", bytes32(0));

        vm.startBroadcast(deployerPrivateKey);
        wrapper = new FCFWrapper(treasury, salt);
        vm.stopBroadcast();
    }
}
