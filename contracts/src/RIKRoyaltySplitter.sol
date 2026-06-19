// src/RIKRoyaltySplitter.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAirlockClaims {
    function collectIntegratorFees(address to, address token, uint256 amount) external;
    function getIntegratorFees(address integrator, address token) external view returns (uint256);
}

interface IMulticurvePool {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IMulticurveFeeCollector {
    function collectFees() external;
}

contract RIKRoyaltySplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC721 public immutable registry;
    IAirlockClaims public immutable airlock;
    address public immutable launcher; // <-- RIKLauncher Address

    // repoId => token => claimable for the current RIK holder
    mapping(uint256 => mapping(address => uint256)) public claimable;
    // asset => repoId
    mapping(address => uint256) public repoOf;

    // events
    event Accrued(uint256 indexed repoId, address indexed token, uint256 amount);
    event Claimed(uint256 indexed repoId, address indexed token, address indexed to, uint256 amount);

    // errors
    error NotRikOwner(uint256 repoId, address caller);
    error NothingToClaim();
    error OnlyLauncher();
    error UnknownPool();

    modifier onlyLauncher() {
        if (msg.sender != launcher) revert OnlyLauncher();
        _;
    }

    constructor(IERC721 _registry, IAirlockClaims _airlock, address _launcher) {
        registry = _registry;
        airlock = _airlock;
        launcher = _launcher;
    }

    /// @notice Called by RIKLauncher.launch() once per new market.
    function registerMarket(address asset, uint256 repoId) external onlyLauncher {
        repoOf[asset] = repoId;
    }

    function _repoOfPool(IMulticurvePool pool) internal view returns (uint256) {
        // Doppler's DERC20 is the registered side; the numeraire side is zero.
        uint256 r0 = repoOf[pool.token0()];
        uint256 r1 = repoOf[pool.token1()];
        if (r0 == 0 && r1 == 0) revert UnknownPool();
        return r0 == 0 ? r1 : r0;
    }

    function pullLp(IMulticurvePool pool) external nonReentrant {
        uint256 repoId = _repoOfPool(pool);
        address token0 = pool.token0();
        address token1 = pool.token1();
        uint256 before0 = IERC20(token0).balanceOf(address(this));
        uint256 before1 = IERC20(token1).balanceOf(address(this));

        IMulticurveFeeCollector(address(pool)).collectFees();

        uint256 delta0 = IERC20(token0).balanceOf(address(this)) - before0;
        if (delta0 != 0) {
            claimable[repoId][token0] += delta0;
            emit Accrued(repoId, token0, delta0);
        }

        uint256 delta1 = IERC20(token1).balanceOf(address(this)) - before1;
        if (delta1 != 0) {
            claimable[repoId][token1] += delta1;
            emit Accrued(repoId, token1, delta1);
        }
    }

    /// @notice Pull all integrator fees the Airlock owes us in 'token', route them to repoId's bucket.
    /// Permissionless --- anyone can rebalance
    function pull(uint256 repoId, address token) external nonReentrant {
        uint256 owed = airlock.getIntegratorFees(address(this), token);
        if (owed == 0) revert NothingToClaim();
        airlock.collectIntegratorFees(address(this), token, owed);
        claimable[repoId][token] += owed;
        emit Accrued(repoId, token, owed);
    }

    /// @notice Withdraw the bucket. Caller must currently own the RIK.
    function claim(uint256 repoId, address token, address to) external nonReentrant returns (uint256 amount) {
        if (registry.ownerOf(repoId) != msg.sender) {
            revert NotRikOwner(repoId, msg.sender);
        }

        amount = claimable[repoId][token];
        if (amount == 0) revert NothingToClaim();
        claimable[repoId][token] = 0;

        emit Claimed(repoId, token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }
}
