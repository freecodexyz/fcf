// test/RIK_1.t.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RIK} from "../src/RIK.sol";

contract RIK_T is Test {
    RIK rik;
    address deployer = address(this);

    function setUp() public {
        rik = new RIK();
    }

    function test_NameAndSymbol() public view {
        assertEq(rik.name(), "Repository Identity Key");
        assertEq(rik.symbol(), "RIK");
    }

    function test_RegisterArbitraryId() public {
        uint256 repo_id = 11112;
        uint64 owner_github_id = 11111;

        rik.register(repo_id, owner_github_id);
        assertEq(rik.ownerOf(repo_id), address(this));
    }

    function test_TwoUsersTwoRepos() public {
        uint256 repo_id_one = 11112;
        uint256 repo_id_two = 11113;

        address alice = address(0xA11CE);
        address bob = address(0xB0B);

        uint64 alice_github_id = 998;
        uint64 bob_github_id = 999;

        vm.prank(alice);
        rik.register(repo_id_one, alice_github_id);
        vm.prank(bob);
        rik.register(repo_id_two, bob_github_id);

        assertEq(rik.ownerOf(repo_id_one), alice);
        assertEq(rik.ownerOf(repo_id_two), bob);
    }

    function test_RejectsDuplicate() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;

        rik.register(repo_id, github_owner_id);
        vm.expectRevert(abi.encodeWithSelector(RIK.AlreadyRegistered.selector, repo_id));
        rik.register(repo_id, github_owner_id);
    }

    function test_EmitsRepoRegistered() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;

        vm.warp(1_700_000_000);
        vm.expectEmit(true, true, false, true);

        emit RIK.RepoRegistered(repo_id, address(this), github_owner_id, 1_700_000_000);
        rik.register(repo_id, github_owner_id);
    }

    function test_TokenIdOfIsIdentity() public view {
        uint256 repo_id = 11112;

        // pass-through
        // forge-lint: disable-next-line(unsafe-typecast)
        assertEq(rik.tokenIdOf(uint64(repo_id)), repo_id);
    }

    function test_RepoRevertsForUnregistered() public {
        uint256 repo_id = 11112;

        vm.expectRevert(bytes("not registered"));

        rik.repoOf(repo_id);
    }

    function test_RepoOfReturnsStruct() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;

        // register -> get repo struct -> check registrant
        rik.register(repo_id, github_owner_id);
        RIK.Repo memory r = rik.repoOf(repo_id);
        assertEq(r.registrant, address(this));
    }
}
