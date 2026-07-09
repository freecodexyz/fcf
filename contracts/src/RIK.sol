// src/RIK.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RSA} from "@openzeppelin/contracts/utils/cryptography/RSA.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {JsonClaim} from "./JsonClaim.sol";

contract RIK is ERC721, Ownable {
    using RSA for bytes32;

    string private constant _EXPECTED_ISS = "https://token.actions.githubusercontent.com";

    struct RSAKey {
        bytes modulus;
        bytes exponent;
        bool active;
    }

    struct Repo {
        uint64 githubRepoId; // == tokenId -> kept for clarity
        uint64 githubOwnerId;
        uint64 registeredAt; // block.timestamp -> truncated at uint64
        address registrant; // who called register()
    }

    event KeyAdded(bytes32 indexed kid);
    event KeyRevoked(bytes32 indexed kid);
    event RepoRegistered(uint256 indexed repoId, address indexed registrant, uint64 githubOwnerId, uint64 registeredAt);

    error AlreadyRegistered(uint256 repoId);
    error UnknownKid(bytes32 kid);
    error BadJwt();
    error TokenExpired();
    error TokenNotYetValid();
    error NotRegistered(uint256 tokenId);
    error RepoIdTooLarge(uint256 repoId);

    // store valid signing keys from GitHub; they periodically rotate
    mapping(bytes32 => RSAKey) private _keys;
    mapping(uint256 => Repo) private _repos;

    /**
     * @dev Sets the initial registry owner.
     */
    constructor(address initialOwner) ERC721("Repository Identity Key", "RIK") Ownable(initialOwner) {}

    /**
     * @dev Registers a GitHub repository identity and mints its RIK to the caller.
     *
     * Requirements:
     *
     * - `kid` must identify an active GitHub Actions signing key.
     * - `signature` must be valid for `headerB64.payloadB64`.
     * - The JWT payload must match the caller, repository id, owner id, issuer, and active time window.
     * - `repoId` must not already be registered and must fit in the stored repository metadata.
     *
     * Emits a {RepoRegistered} event.
     */
    function register(
        bytes32 kid,
        bytes calldata headerB64,
        bytes calldata payloadB64,
        bytes calldata signature,
        uint256 repoId,
        uint64 githubOwnerId
    ) external {
        address registrant = _msgSender();
        _verifyJwt(kid, headerB64, payloadB64, signature);

        bytes memory payload = bytes(Base64.decode(string(payloadB64)));
        _verifyClaims(payload, registrant, repoId, githubOwnerId);
        _verifyActiveWindow(payload);

        _register(registrant, repoId, githubOwnerId);
    }

    /**
     * @dev Returns the trusted GitHub Actions OIDC issuer.
     */
    function expectedIssuer() public pure virtual returns (string memory) {
        return _EXPECTED_ISS;
    }

    /**
     * @dev Returns the RIK token id for a GitHub repository id.
     */
    function tokenIdOf(uint64 githubRepoId) public pure virtual returns (uint256) {
        return uint256(githubRepoId);
    }

    /**
     * @dev Returns repository metadata for `tokenId`.
     *
     * Requirements:
     *
     * - `tokenId` must be registered.
     */
    function repoOf(uint256 tokenId) public view virtual returns (Repo memory) {
        if (_ownerOf(tokenId) == address(0)) revert NotRegistered(tokenId);
        return _repos[tokenId];
    }

    /**
     * @dev Adds or replaces an active GitHub Actions RSA signing key.
     *
     * Requirements:
     *
     * - The caller must be the contract owner.
     *
     * Emits a {KeyAdded} event.
     */
    function addKey(bytes32 kid, bytes calldata n, bytes calldata e) external onlyOwner {
        _addKey(kid, n, e);
    }

    /**
     * @dev Revokes a GitHub Actions RSA signing key.
     *
     * Requirements:
     *
     * - The caller must be the contract owner.
     *
     * Emits a {KeyRevoked} event.
     */
    function revokeKey(bytes32 kid) external onlyOwner {
        _revokeKey(kid);
    }

    /**
     * @dev Registers `repoId` to `registrant`.
     *
     * Requirements:
     *
     * - `repoId` must not already be registered.
     * - `repoId` must fit in the stored repository metadata.
     *
     * Emits a {RepoRegistered} event.
     */
    function _register(address registrant, uint256 repoId, uint64 githubOwnerId) internal virtual {
        if (_ownerOf(repoId) != address(0)) revert AlreadyRegistered(repoId);
        if (repoId > type(uint64).max) revert RepoIdTooLarge(repoId);

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 registeredAt = uint64(block.timestamp);
        _repos[repoId] = Repo({
            // casting is safe because repoId is bounded above.
            // forge-lint: disable-next-line(unsafe-typecast)
            githubRepoId: uint64(repoId),
            githubOwnerId: githubOwnerId,
            registeredAt: registeredAt,
            registrant: registrant
        });

        emit RepoRegistered(repoId, registrant, githubOwnerId, registeredAt);

        _mint(registrant, repoId);
    }

    /**
     * @dev Adds or replaces an active GitHub Actions RSA signing key.
     *
     * Emits a {KeyAdded} event.
     */
    function _addKey(bytes32 kid, bytes calldata n, bytes calldata e) internal virtual {
        _keys[kid] = RSAKey({modulus: n, exponent: e, active: true});
        emit KeyAdded(kid);
    }

    /**
     * @dev Revokes a GitHub Actions RSA signing key.
     *
     * Emits a {KeyRevoked} event.
     */
    function _revokeKey(bytes32 kid) internal virtual {
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

    function _verifyClaims(bytes memory payload, address registrant, uint256 repoId, uint64 githubOwnerId)
        internal
        pure
    {
        JsonClaim.requireStringClaim(payload, "aud", Strings.toHexString(uint160(registrant), 20));
        JsonClaim.requireStringClaim(payload, "repository_id", Strings.toString(repoId));
        JsonClaim.requireStringClaim(payload, "repository_owner_id", Strings.toString(uint256(githubOwnerId)));
        JsonClaim.requireStringClaim(payload, "iss", _EXPECTED_ISS);
    }

    function _verifyActiveWindow(bytes memory payload) internal view {
        uint256 exp_ = _requireUintClaim(payload, "exp");
        uint256 nbf_ = _requireUintClaim(payload, "nbf");

        // JWT validity must be checked against chain time; small validator timestamp drift is acceptable here.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > exp_) revert TokenExpired();

        // JWT validity must be checked against chain time; small validator timestamp drift is acceptable here.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < nbf_) revert TokenNotYetValid();
    }

    function _requireUintClaim(bytes memory payload, string memory key) internal pure returns (uint256 value) {
        bool found;
        (value, found) = _readUintClaim(payload, key);
        if (!found) revert JsonClaim.ClaimMissing(key);
    }

    function _readUintClaim(bytes memory payload, string memory key) internal pure returns (uint256 value, bool found) {
        bytes memory marker = abi.encodePacked('"', bytes(key), '":');
        int256 pos = JsonClaim.indexOf(payload, marker);

        if (pos < 0) return (0, false);

        // casting to uint256 is safe because negative positions returned above.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 i = uint256(pos) + marker.length;
        uint256 valueStart = i;
        if (i == payload.length) return (0, false);

        while (i < payload.length) {
            uint8 c = uint8(payload[i]);
            if (c < 0x30 || c > 0x39) break; // -> not a digit
            value = value * 10 + (c - 0x30);
            ++i;
        }
        found = i > valueStart;
    }
}
