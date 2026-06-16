// test/RIK_1.t.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RIK} from "../src/RIK.sol";
import {JsonClaim} from "../src/JsonClaim.sol";

contract RIK_T is Test {
    RIK rik;
    address deployer = address(this);

    struct Fixture {
        bytes32 kid;
        bytes headerB64;
        bytes payloadB64;
        bytes signature;
        bytes modulus;
        bytes exponent;
        uint256 repoId;
        uint64 ownerId;
        address recipient;
        uint256 exp;
        uint256 nbf;
    }

    function setUp() public {
        rik = new RIK(deployer);
    }

    function _loadFixture(string memory name) internal returns (Fixture memory f) {
        string[] memory inputs = new string[](3);
        inputs[0] = "node";
        inputs[1] = "test/fixtures/load-fixture.mjs";
        inputs[2] = string.concat("test/fixtures/", name);

        f = _loadFixture(inputs);
    }

    function _loadFixture(string memory name, uint256 repo_id, uint64 owner_id, address recipient)
        internal
        returns (Fixture memory f)
    {
        string[] memory inputs = new string[](6);
        inputs[0] = "node";
        inputs[1] = "test/fixtures/load-fixture.mjs";
        inputs[2] = string.concat("test/fixtures/", name);
        inputs[3] = vm.toString(repo_id);
        inputs[4] = vm.toString(uint256(owner_id));
        inputs[5] = vm.toString(recipient);

        f = _loadFixture(inputs);
    }

    function _loadFixture(string[] memory inputs) internal returns (Fixture memory f) {
        string memory json = string(vm.ffi(inputs));
        f.kid = vm.parseJsonBytes32(json, ".kid");
        f.headerB64 = bytes(vm.parseJsonString(json, ".headerB64"));
        f.payloadB64 = bytes(vm.parseJsonString(json, ".payloadB64"));
        f.signature = vm.parseJsonBytes(json, ".signature");
        f.modulus = vm.parseJsonBytes(json, ".modulus");
        f.exponent = vm.parseJsonBytes(json, ".exponent");
        f.repoId = vm.parseJsonUint(json, ".repoId");
        // forge-lint: disable-next-line(unsafe-typecast)
        f.ownerId = uint64(vm.parseJsonUint(json, ".ownerId"));
        f.recipient = vm.parseJsonAddress(json, ".recipient");
        f.exp = vm.parseJsonUint(json, ".exp");
        f.nbf = vm.parseJsonUint(json, ".nbf");
    }

    function _addKey(Fixture memory f) internal {
        rik.addKey(f.kid, f.modulus, f.exponent);
    }

    function _register(Fixture memory f, uint256 repo_id, uint64 github_owner_id) internal {
        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, repo_id, github_owner_id);
    }

    function test_NameAndSymbol() public view {
        assertEq(rik.name(), "Repository Identity Key");
        assertEq(rik.symbol(), "RIK");
    }

    function test_RegisterArbitraryId() public {
        uint256 repo_id = 11112;
        uint64 owner_github_id = 11111;
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, owner_github_id, address(this));

        _addKey(f);
        _register(f, repo_id, owner_github_id);
        assertEq(rik.ownerOf(repo_id), address(this));
    }

    function test_TwoUsersTwoRepos() public {
        uint256 repo_id_one = 11112;
        uint256 repo_id_two = 11113;

        address alice = address(0xA11CE);
        address bob = address(0xB0B);

        uint64 alice_github_id = 998;
        uint64 bob_github_id = 999;
        Fixture memory alice_f = _loadFixture("sample-jwt.json", repo_id_one, alice_github_id, alice);
        Fixture memory bob_f = _loadFixture("sample-jwt.json", repo_id_two, bob_github_id, bob);

        _addKey(alice_f);

        vm.prank(alice);
        _register(alice_f, repo_id_one, alice_github_id);
        vm.prank(bob);
        _register(bob_f, repo_id_two, bob_github_id);

        assertEq(rik.ownerOf(repo_id_one), alice);
        assertEq(rik.ownerOf(repo_id_two), bob);
    }

    function test_RejectsDuplicate() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, github_owner_id, address(this));

        _addKey(f);
        _register(f, repo_id, github_owner_id);
        vm.expectRevert(abi.encodeWithSelector(RIK.AlreadyRegistered.selector, repo_id));
        _register(f, repo_id, github_owner_id);
    }

    function test_EmitsRepoRegistered() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, github_owner_id, address(this));

        _addKey(f);
        vm.warp(1_700_000_000);
        vm.expectEmit(true, true, false, true);

        emit RIK.RepoRegistered(repo_id, address(this), github_owner_id, 1_700_000_000);
        _register(f, repo_id, github_owner_id);
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
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, github_owner_id, address(this));

        _addKey(f);
        vm.warp(1_700_000_000);
        _register(f, repo_id, github_owner_id);

        RIK.Repo memory r = rik.repoOf(repo_id);
        assertEq(r.githubRepoId, repo_id);
        assertEq(r.githubOwnerId, github_owner_id);
        assertEq(r.registeredAt, 1_700_000_000);
        assertEq(r.registrant, address(this));
    }

    function test_VerifyWithAddedKey() public {
        Fixture memory f = _loadFixture("sample-jwt.json");
        _addKey(f);

        vm.prank(f.recipient);

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId);

        assertEq(rik.ownerOf(f.repoId), f.recipient);
    }

    function test_RejectsUnknownKid() public {
        Fixture memory f = _loadFixture("sample-jwt.json");
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 wrongKid = bytes32("kid-zzz");

        vm.prank(f.recipient);

        vm.expectRevert(abi.encodeWithSelector(RIK.UnknownKid.selector, wrongKid));

        rik.register(wrongKid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId);
    }

    function test_RejectsRevokedKid() public {
        Fixture memory f = _loadFixture("sample-jwt.json");

        _addKey(f);
        rik.revokeKey(f.kid);

        vm.prank(f.recipient);

        vm.expectRevert(abi.encodeWithSelector(RIK.UnknownKid.selector, f.kid));

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId);
    }

    function test_RejectsAudMismatch() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, github_owner_id, address(this));

        _addKey(f);

        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(JsonClaim.ClaimMismatch.selector, "aud"));

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId);
    }

    function test_RejectsWrongRepoId() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, github_owner_id, address(this));

        _addKey(f);

        vm.prank(f.recipient);
        vm.expectRevert(abi.encodeWithSelector(JsonClaim.ClaimMismatch.selector, "repository_id"));

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId + 1, f.ownerId);
    }

    function test_RejectsWrongOwnerId() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, github_owner_id, address(this));

        _addKey(f);

        vm.prank(f.recipient);
        vm.expectRevert(abi.encodeWithSelector(JsonClaim.ClaimMismatch.selector, "repository_owner_id"));

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId + 1);
    }

    function test_RejectsWrongIssuer() public {
        Fixture memory f = _loadFixture("wrong-issuer-jwt.json");

        _addKey(f);

        vm.prank(f.recipient);
        vm.expectRevert(abi.encodeWithSelector(JsonClaim.ClaimMismatch.selector, "iss"));

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId);
    }

    function test_RejectsBadSignature() public {
        Fixture memory f = _loadFixture("sample-jwt.json");
        bytes memory badSignature = f.signature;
        badSignature[0] = bytes1(uint8(badSignature[0]) ^ 1);

        _addKey(f);

        vm.prank(f.recipient);
        vm.expectRevert(RIK.BadJwt.selector);

        rik.register(f.kid, f.headerB64, f.payloadB64, badSignature, f.repoId, f.ownerId);
    }

    function test_RejectsExpired() public {
        uint256 repo_id = 11112;
        uint64 github_owner_id = 999;
        Fixture memory f = _loadFixture("sample-jwt.json", repo_id, github_owner_id, address(this));

        _addKey(f);

        vm.warp(f.exp + 1);
        vm.prank(f.recipient);
        vm.expectRevert(bytes("token expired"));

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId);
    }

    function test_RejectsNotYetValid() public {
        Fixture memory f = _loadFixture("future-nbf-jwt.json");

        _addKey(f);

        vm.warp(f.nbf - 1);
        vm.prank(f.recipient);
        vm.expectRevert(bytes("token not yet valid"));

        rik.register(f.kid, f.headerB64, f.payloadB64, f.signature, f.repoId, f.ownerId);
    }
}
