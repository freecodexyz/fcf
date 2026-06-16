// src/RIKLauncher.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IAirlock {
    struct CreateParams {
        uint256 initialSupply;
        uint256 numTokensToSell;
        address numeraire;
        address tokenFactory;
        bytes tokenFactoryData;
        address governanceFactory;
        bytes governanceFactoryData;
        address poolInitializer;
        bytes poolInitializerData;
        address liquidityMigrator;
        bytes liquidityMigratorData;
        address integrator;
        bytes32 salt;
    }

    function create(CreateParams calldata p)
        external
        returns (address asset, address pool, address governance, address timelock, address migrationPool);
}

interface IRIKRoyaltySplitter {
    function registerMarket(address asset, uint256 repoId) external;
}

contract RIKLauncher {
    IAirlock public immutable airlock;
    IERC721 public immutable registry;
    IRIKRoyaltySplitter public immutable splitter;

    mapping(uint256 => address) public marketOf; // repoId -> asset
    mapping(address => uint256) public repoOf; // asset -> repoId

    // events
    event MarketLaunched(uint256 indexed repoId, address indexed asset, address indexed launcher);

    // errors
    error NotRikOwner(uint256 repoId, address caller);
    error AlreadyLaunched(uint256 repoId, address existing);

    constructor(IAirlock _airlock, IERC721 _registry, IRIKRoyaltySplitter _splitter) {
        airlock = _airlock;
        registry = _registry;
        splitter = _splitter;
    }

    function launch(uint256 repoId, IAirlock.CreateParams calldata p) external returns (address asset) {
        // caller must be RIK.ownerOf() -> reverts otherwise
        if (registry.ownerOf(repoId) != msg.sender) revert NotRikOwner(repoId, msg.sender);

        // only one market per repo can exist
        if (marketOf[repoId] != address(0)) revert AlreadyLaunched(repoId, marketOf[repoId]);

        // send to doppler
        (asset,,,,) = airlock.create(p);
        marketOf[repoId] = asset;
        splitter.registerMarket(asset, repoId);
        repoOf[asset] = repoId;

        emit MarketLaunched(repoId, asset, msg.sender);
    }
}
