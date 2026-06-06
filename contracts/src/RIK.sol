// src/RIK.sol
// SDPX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RSA} from "@openzeppelin/contracts/utils/cryptography/RSA.sol";

contract RIK is ERC721, Ownable {
    using RSA for bytes32;

    address public attester;

    struct RSAKey {
        bytes modulus;
        bytes exponent;
        bool active;
    }

    event KeyAdded(bytes32 indexed kid);
    event KeyRevoked(bytes32 indexed kid);

    // store valid signing keys from GitHub -> they periodically rotate
    mapping(bytes32 => RSAKey) private _keys;

    struct Repo {
        uint64 githubRepoId; // == tokenId -> kept for clarity
        uint64 githubOwnerId;
        uint64 registeredAt; // block.timestamp -> truncated at uint64
        address registrant; // who called register()
    }

    // EVM log event used for off-chain indexing
    event RepoRegistered(uint256 indexed repoId, address indexed registrant, uint64 githubOwnerId, uint64 registeredAt);

    mapping(uint256 => Repo) private _repos;

    // errors
    error AlreadyRegistered(uint256 repoId);
    error UnknownKid(bytes32 kid);
    error BadJwt();

    constructor(address initialOwner, address initialAttester)
        ERC721("Repository Identity Key", "RIK")
        Ownable(initialOwner)
    {
        attester = initialAttester;
    }

    function setAttester(address a) external onlyOwner {
        attester = a;
    }

    function register(
        bytes32 kid,
        bytes calldata headerB64,
        bytes calldata payloadB64,
        bytes calldata signature,
        uint256 repoId,
        uint64 githubOwnerId
    ) external {
        _verifyJwt(kid, headerB64, payloadB64, signature);

        // prevent double registration
        if (_ownerOf(repoId) != address(0)) revert AlreadyRegistered(repoId);

        Repo memory r = Repo({
            // safe to truncate -> collision is irrelevant
            // forge-lint: disable-next-line(unsafe-typecast)
            githubRepoId: uint64(repoId),
            githubOwnerId: githubOwnerId,
            registeredAt: uint64(block.timestamp),
            registrant: msg.sender
        });
        _repos[repoId] = r;

        emit RepoRegistered(repoId, msg.sender, githubOwnerId, r.registeredAt);

        _mint(msg.sender, repoId);
    }

    function tokenIdOf(uint64 githubRepoId) external pure returns (uint256) {
        return uint256(githubRepoId);
    }

    function repoOf(uint256 tokenId) external view returns (Repo memory) {
        require(_ownerOf(tokenId) != address(0), "not registered");
        return _repos[tokenId];
    }

    function addKey(bytes32 kid, bytes calldata n, bytes calldata e) external onlyOwner {
        _keys[kid] = RSAKey({modulus: n, exponent: e, active: true});
        emit KeyAdded(kid);
    }

    function revokeKey(bytes32 kid) external onlyOwner {
        _keys[kid].active = false;
        emit KeyRevoked(kid);
    }

    function _verifyJwt(bytes32 kid, bytes calldata headerB64, bytes calldata payloadB64, bytes calldata signature)
        internal
        view
    {
        // verify a jwt with a specific kid is active
        RSAKey memory k = _keys[kid];
        if (!k.active) revert UnknownKid(kid);

        // verify it's a valid jwt
        bytes memory signingInput = bytes.concat(headerB64, ".", payloadB64);
        bytes32 digest = sha256(signingInput);
        if (!RSA.pkcs1Sha256(digest, signature, k.exponent, k.modulus)) revert BadJwt();
    }
}
