// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IJwtVerifier} from "../src/IJwtVerifier.sol";
import {TaskVault} from "../src/TaskVault.sol";

contract DeployTaskVault is Script {
    /**
     * @notice Deploys TaskVault with configured RIK/JWT verifier addresses.
     *
     * Requirements:
     *
     * - `PRIVATE_KEY`, `RIK_ADDRESS`, and `JWT_VERIFIER_ADDRESS` must be set.
     */
    function run() external returns (TaskVault vault) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address rikAddress = vm.envAddress("RIK_ADDRESS");
        address jwtVerifierAddress = vm.envAddress("JWT_VERIFIER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);
        vault = new TaskVault(IERC721(rikAddress), IJwtVerifier(jwtVerifierAddress));
        vm.stopBroadcast();
    }
}
