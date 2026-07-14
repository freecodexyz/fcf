// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IJwtVerifier} from "./IJwtVerifier.sol";
import {JsonClaim} from "./JsonClaim.sol";

/**
 * @title TaskVault
 * @notice ERC-20 task escrow keyed by a RIK repository id and GitHub issue number.
 */
contract TaskVault is Context, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant _CANCEL_TIMEOUT = 7 days;

    enum TaskState {
        None,
        Open,
        Approved,
        Cancelled
    }

    struct Task {
        IERC20 token;
        uint128 amount;
        address creator;
        uint64 createdAt;
        TaskState state;
    }

    struct Submission {
        uint256 taskRikId;
        uint16 taskIssue;
        uint32 prNumber;
        address wallet;
        uint64 timestamp;
    }

    IERC721 private immutable _rik;
    IJwtVerifier private immutable _jwt;
    uint256 private _nextSubmissionId;

    mapping(bytes32 taskId => Task task) private _tasks;
    mapping(uint256 submissionId => Submission submission) private _submissionOf;
    mapping(bytes32 taskId => uint256[] submissionIds) private _submissionsOfTask;
    mapping(bytes32 prId => uint256[] submissionIds) private _submissionsOfPr;

    error TaskVaultInvalidToken(address token);
    error TaskVaultInvalidRik(address rik);
    error TaskVaultInvalidJwtVerifier(address jwt);
    error TaskVaultZeroAmount();
    error TaskAlreadyExists(bytes32 taskId);
    error NotOpen(TaskState state);
    error NotRikOwner(uint256 rikId, address caller);
    error NoSuchSubmission(uint256 submissionId);
    error NoSubmissionForPr(bytes32 prId);
    error TooEarlyToCancel(uint256 unlockAt);

    event TaskOpened(
        uint256 indexed rikId,
        uint16 indexed issue,
        address indexed creator,
        IERC20 token,
        uint128 amount,
        uint64 createdAt
    );
    event Submitted(
        uint256 indexed submissionId,
        uint256 indexed rikId,
        uint16 indexed issue,
        uint32 prNumber,
        address wallet,
        uint64 timestamp
    );
    event Approved(
        uint256 indexed submissionId,
        uint256 indexed rikId,
        uint16 indexed issue,
        IERC20 token,
        uint128 amount,
        address recipient
    );
    event TaskCancelled(
        uint256 indexed rikId, uint16 indexed issue, address indexed creator, IERC20 token, uint128 amount
    );

    /**
     * @dev Sets the RIK registry and GitHub OIDC verifier.
     *
     * Requirements:
     *
     * - `rik_` and `jwt_` must not be the zero address.
     */
    constructor(IERC721 rik_, IJwtVerifier jwt_) {
        if (address(rik_) == address(0)) revert TaskVaultInvalidRik(address(rik_));
        if (address(jwt_) == address(0)) revert TaskVaultInvalidJwtVerifier(address(jwt_));

        _rik = rik_;
        _jwt = jwt_;
        _nextSubmissionId = 1;
    }

    /**
     * @notice Returns the RIK registry used to authorize repository owners.
     */
    function rik() public view virtual returns (IERC721) {
        return _rik;
    }

    /**
     * @notice Returns the GitHub OIDC verifier used for submissions.
     */
    function jwt() public view virtual returns (IJwtVerifier) {
        return _jwt;
    }

    /**
     * @notice Returns the cancellation timeout for open tasks.
     */
    function cancelTimeout() public pure virtual returns (uint256) {
        return _CANCEL_TIMEOUT;
    }

    /**
     * @notice Returns the next globally assigned submission id.
     */
    function nextSubmissionId() public view virtual returns (uint256) {
        return _nextSubmissionId;
    }

    /**
     * @notice Returns the canonical task id for `rikId` and `issue`.
     */
    function taskId(uint256 rikId, uint16 issue) public pure virtual returns (bytes32) {
        return keccak256(abi.encode(rikId, issue));
    }

    /**
     * @notice Returns the canonical PR id for `rikId`, `issue`, and `prNumber`.
     */
    function prId(uint256 rikId, uint16 issue, uint32 prNumber) public pure virtual returns (bytes32) {
        return keccak256(abi.encode(rikId, issue, prNumber));
    }

    /**
     * @notice Returns the task stored under `id`.
     */
    function tasks(bytes32 id) public view virtual returns (Task memory) {
        return _tasks[id];
    }

    /**
     * @notice Returns the submission stored under `submissionId`.
     */
    function submissionOf(uint256 submissionId) public view virtual returns (Submission memory) {
        return _submissionOf[submissionId];
    }

    /**
     * @notice Returns all submission ids recorded for a task.
     */
    function submissionsOfTask(uint256 rikId, uint16 issue) public view virtual returns (uint256[] memory) {
        return _submissionsOfTask[taskId(rikId, issue)];
    }

    /**
     * @notice Returns all submission ids recorded for a task PR.
     */
    function submissionsOfPr(uint256 rikId, uint16 issue, uint32 prNumber)
        public
        view
        virtual
        returns (uint256[] memory)
    {
        return _submissionsOfPr[prId(rikId, issue, prNumber)];
    }

    /**
     * @notice Returns the newest submission id recorded for a task PR.
     *
     * Requirements:
     *
     * - At least one submission must exist for `rikId`, `issue`, and `prNumber`.
     */
    function latestSubmissionFor(uint256 rikId, uint16 issue, uint32 prNumber) public view virtual returns (uint256) {
        bytes32 id = prId(rikId, issue, prNumber);
        uint256[] storage submissionIds = _submissionsOfPr[id];
        if (submissionIds.length == 0) revert NoSubmissionForPr(id);
        return submissionIds[submissionIds.length - 1];
    }

    /**
     * @notice Opens an ERC-20-funded task for `issue` in repository `rikId`.
     *
     * Requirements:
     *
     * - The caller must currently own RIK `rikId`.
     * - No task may already exist for `rikId` and `issue`.
     * - `token` must not be the zero address.
     * - `amount` must be non-zero.
     * - The caller must have approved this vault to transfer at least `amount` of `token`.
     *
     * Emits a {TaskOpened} event.
     */
    function openTask(uint256 rikId, uint16 issue, IERC20 token, uint128 amount)
        external
        nonReentrant
        returns (bytes32 id)
    {
        address caller = _msgSender();
        _requireRikOwner(rikId, caller);
        return _openTask(caller, rikId, issue, token, amount);
    }

    /**
     * @notice Records a pull-request submission authenticated by a GitHub OIDC JWT.
     *
     * Requirements:
     *
     * - The task must be open.
     * - The JWT verifier must accept the JWT.
     * - The decoded JWT payload must bind `aud` to the caller, `repository_id` to `rikId`, and `ref` to
     *   `refs/pull/<prNumber>/merge`.
     *
     * Emits a {Submitted} event.
     */
    function submit(
        uint256 rikId,
        uint16 issue,
        uint32 prNumber,
        bytes32 kid,
        bytes calldata headerB64,
        bytes calldata payloadB64,
        bytes calldata signature
    ) external nonReentrant returns (uint256 id) {
        return _submit(_msgSender(), rikId, issue, prNumber, kid, headerB64, payloadB64, signature);
    }

    /**
     * @notice Approves `submissionId` and releases the task escrow to its authenticated wallet.
     *
     * Requirements:
     *
     * - The caller must currently own RIK `rikId`.
     * - The task must be open.
     * - `submissionId` must belong to `rikId` and `issue`.
     *
     * Emits an {Approved} event.
     */
    function approve(uint256 rikId, uint16 issue, uint256 submissionId) external nonReentrant {
        address caller = _msgSender();
        _requireRikOwner(rikId, caller);
        _approve(rikId, issue, submissionId);
    }

    /**
     * @notice Cancels an expired open task and refunds its creator.
     *
     * Requirements:
     *
     * - The caller must currently own RIK `rikId`.
     * - The task must be open.
     * - At least seven days must have passed since task creation.
     *
     * Emits a {TaskCancelled} event.
     */
    function cancel(uint256 rikId, uint16 issue) external nonReentrant {
        address caller = _msgSender();
        _requireRikOwner(rikId, caller);
        _cancel(rikId, issue);
    }

    /**
     * @dev Opens a task and pulls escrow from `creator`.
     *
     * Emits a {TaskOpened} event.
     */
    function _openTask(address creator, uint256 rikId, uint16 issue, IERC20 token, uint128 amount)
        internal
        virtual
        returns (bytes32 id)
    {
        if (address(token) == address(0)) revert TaskVaultInvalidToken(address(token));
        if (amount == 0) revert TaskVaultZeroAmount();

        id = taskId(rikId, issue);
        Task storage task = _tasks[id];
        if (task.state != TaskState.None) revert TaskAlreadyExists(id);

        // A uint64 Unix timestamp remains valid far beyond any practical lifetime of this contract.
        uint64 createdAt = uint64(block.timestamp);
        _tasks[id] = Task({token: token, amount: amount, creator: creator, createdAt: createdAt, state: TaskState.Open});

        emit TaskOpened(rikId, issue, creator, token, amount, createdAt);
        token.safeTransferFrom(creator, address(this), amount);
    }

    /**
     * @dev Verifies JWT claims and records a globally indexed submission.
     *
     * Emits a {Submitted} event.
     */
    function _submit(
        address wallet,
        uint256 rikId,
        uint16 issue,
        uint32 prNumber,
        bytes32 kid,
        bytes calldata headerB64,
        bytes calldata payloadB64,
        bytes calldata signature
    ) internal virtual returns (uint256 id) {
        bytes memory payload = _jwt.verifyGithubOidc(kid, headerB64, payloadB64, signature);
        _verifySubmissionClaims(payload, wallet, rikId, prNumber);

        id = _recordSubmission(wallet, rikId, issue, prNumber);
    }

    /**
     * @dev Records a submission after its GitHub OIDC claims have been verified.
     *
     * Emits a {Submitted} event.
     */
    function _recordSubmission(address wallet, uint256 rikId, uint16 issue, uint32 prNumber)
        internal
        virtual
        returns (uint256 id)
    {
        bytes32 id_ = taskId(rikId, issue);
        Task storage task = _tasks[id_];
        if (task.state != TaskState.Open) revert NotOpen(task.state);

        id = _nextSubmissionId;
        _nextSubmissionId = id + 1;

        // A uint64 Unix timestamp remains valid far beyond any practical lifetime of this contract.
        uint64 timestamp = uint64(block.timestamp);
        _submissionOf[id] =
            Submission({taskRikId: rikId, taskIssue: issue, prNumber: prNumber, wallet: wallet, timestamp: timestamp});
        _submissionsOfTask[id_].push(id);
        _submissionsOfPr[prId(rikId, issue, prNumber)].push(id);

        emit Submitted(id, rikId, issue, prNumber, wallet, timestamp);
    }

    /**
     * @dev Approves a submission and transfers escrow to its wallet.
     *
     * Emits an {Approved} event.
     */
    function _approve(uint256 rikId, uint16 issue, uint256 submissionId) internal virtual {
        bytes32 id = taskId(rikId, issue);
        Task storage task = _tasks[id];
        if (task.state != TaskState.Open) revert NotOpen(task.state);

        Submission memory submission = _submissionOf[submissionId];
        if (submission.taskRikId != rikId || submission.taskIssue != issue) revert NoSuchSubmission(submissionId);

        IERC20 token = task.token;
        uint128 amount = task.amount;
        task.amount = 0;
        task.state = TaskState.Approved;

        emit Approved(submissionId, rikId, issue, token, amount, submission.wallet);
        token.safeTransfer(submission.wallet, amount);
    }

    /**
     * @dev Cancels an expired task and refunds its creator.
     *
     * Emits a {TaskCancelled} event.
     */
    function _cancel(uint256 rikId, uint16 issue) internal virtual {
        bytes32 id = taskId(rikId, issue);
        Task storage task = _tasks[id];
        if (task.state != TaskState.Open) revert NotOpen(task.state);

        uint256 unlockAt = uint256(task.createdAt) + _CANCEL_TIMEOUT;
        // Task expiry is intentionally based on chain time; small validator drift is acceptable for a 7-day window.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < unlockAt) revert TooEarlyToCancel(unlockAt);

        IERC20 token = task.token;
        uint128 amount = task.amount;
        address creator = task.creator;
        task.amount = 0;
        task.state = TaskState.Cancelled;

        emit TaskCancelled(rikId, issue, creator, token, amount);
        token.safeTransfer(creator, amount);
    }

    function _requireRikOwner(uint256 rikId, address caller) internal view {
        if (_rik.ownerOf(rikId) != caller) revert NotRikOwner(rikId, caller);
    }

    function _verifySubmissionClaims(bytes memory payload, address wallet, uint256 rikId, uint32 prNumber)
        internal
        pure
    {
        JsonClaim.requireStringClaim(payload, "aud", Strings.toHexString(uint160(wallet), 20));
        JsonClaim.requireStringClaim(payload, "repository_id", Strings.toString(rikId));
        JsonClaim.requireStringClaim(
            payload, "ref", string.concat("refs/pull/", Strings.toString(uint256(prNumber)), "/merge")
        );
    }
}
