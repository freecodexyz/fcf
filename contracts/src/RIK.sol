// src/RIK.sol
// SDPX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract RIK is ERC721 {
    struct Repo {
        uint64 githubRepoId;    // == tokenId -> kept for clarity
        uint64 githubOwnerId;
        uint64 registeredAt;    // block.timestamp -> truncated at uint64
        address registrant;     // who called register()
    }

    // EVM log event used for off-chain indexing
    event RepoRegistered(
        uint256 indexed repoId,
        address indexed registrant,
        uint64 githubOwnerId,
        uint64 registeredAt
    );

    mapping(uint256 => Repo) private _repos;

    error AlreadyRegistered(uint256 repoId);

    constructor() ERC721("Repository Identity Key", "RIK") {}

    function register(uint256 repoId, uint64 githubOwnerId) external {
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
}