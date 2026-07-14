// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Test} from "forge-std/Test.sol";
import {IJwtVerifier} from "../src/IJwtVerifier.sol";
import {JsonClaim} from "../src/JsonClaim.sol";
import {TaskVault} from "../src/TaskVault.sol";

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}

contract MockRIK is ERC721 {
    constructor() ERC721("Repository Identity Key", "RIK") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract MockJwtVerifier is IJwtVerifier {
    bytes private _payload;
    bool private _reject;

    function setPayload(bytes calldata payload_) external {
        _payload = payload_;
        _reject = false;
    }

    function setReject(bool reject_) external {
        _reject = reject_;
    }

    function verifyGithubOidc(bytes32, bytes calldata, bytes calldata, bytes calldata)
        external
        view
        returns (bytes memory payload)
    {
        if (_reject) revert("bad jwt");
        return _payload;
    }
}

contract TaskVaultTest is Test {
    using Strings for uint256;

    bytes32 private constant _KID = keccak256("github-kid");

    MockToken private _token;
    MockToken private _otherToken;
    MockRIK private _rik;
    MockJwtVerifier private _jwt;
    TaskVault private _vault;

    address private _alice = address(0xA11CE);
    address private _bob = address(0xB0B);
    address private _carol = address(0xC401);

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

    function setUp() public {
        _token = new MockToken("Mock Token", "MOCK");
        _otherToken = new MockToken("Other Token", "OTHER");
        _rik = new MockRIK();
        _jwt = new MockJwtVerifier();
        _vault = new TaskVault(_rik, _jwt);

        _rik.mint(_alice, 42);
        _rik.mint(_alice, 43);
    }

    function test_OpenTaskPullsChosenTokenAndStoresTask() public {
        _token.mint(_alice, 100e6);
        vm.startPrank(_alice);
        _token.approve(address(_vault), 100e6);
        vm.expectEmit(true, true, true, true);
        emit TaskOpened(42, 20, _alice, _token, 100e6, uint64(block.timestamp));
        bytes32 id = _vault.openTask(42, 20, _token, 100e6);
        vm.stopPrank();

        TaskVault.Task memory task = _vault.tasks(id);
        assertEq(address(task.token), address(_token));
        assertEq(uint256(task.amount), 100e6);
        assertEq(task.creator, _alice);
        assertEq(uint256(task.createdAt), block.timestamp);
        assertEq(uint256(task.state), uint256(TaskVault.TaskState.Open));
        assertEq(_token.balanceOf(address(_vault)), 100e6);
    }

    function test_OpenTaskRequiresRikOwnership() public {
        _token.mint(_bob, 100e6);

        vm.startPrank(_bob);
        _token.approve(address(_vault), 100e6);
        vm.expectRevert(abi.encodeWithSelector(TaskVault.NotRikOwner.selector, uint256(42), _bob));
        _vault.openTask(42, 20, _token, 100e6);
        vm.stopPrank();
    }

    function test_CannotDoubleOpenTask() public {
        _openTask(_alice, 42, 20, 100e6);
        _token.mint(_alice, 100e6);

        vm.startPrank(_alice);
        _token.approve(address(_vault), 100e6);
        vm.expectRevert(abi.encodeWithSelector(TaskVault.TaskAlreadyExists.selector, _vault.taskId(42, 20)));
        _vault.openTask(42, 20, _token, 100e6);
        vm.stopPrank();
    }

    function test_OpenTaskRejectsZeroToken() public {
        vm.prank(_alice);
        vm.expectRevert(abi.encodeWithSelector(TaskVault.TaskVaultInvalidToken.selector, address(0)));
        _vault.openTask(42, 20, IERC20(address(0)), 100e6);
    }

    function test_SubmitVerifiesClaimsAndIndexesSubmission() public {
        _openTask(_alice, 42, 20, 100e6);
        _jwt.setPayload(_payload(_bob, 42, 47));

        vm.expectEmit(true, true, true, true);
        emit Submitted(1, 42, 20, 47, _bob, uint64(block.timestamp));
        vm.prank(_bob);
        uint256 submissionId = _vault.submit(42, 20, 47, _KID, "header", "payload", "signature");

        assertEq(submissionId, 1);
        assertEq(_vault.nextSubmissionId(), 2);

        TaskVault.Submission memory submission = _vault.submissionOf(submissionId);
        assertEq(submission.taskRikId, 42);
        assertEq(submission.taskIssue, 20);
        assertEq(submission.prNumber, 47);
        assertEq(submission.wallet, _bob);
        assertEq(uint256(submission.timestamp), block.timestamp);

        uint256[] memory taskSubmissions = _vault.submissionsOfTask(42, 20);
        uint256[] memory prSubmissions = _vault.submissionsOfPr(42, 20, 47);
        assertEq(taskSubmissions.length, 1);
        assertEq(taskSubmissions[0], submissionId);
        assertEq(prSubmissions.length, 1);
        assertEq(prSubmissions[0], submissionId);
        assertEq(_vault.latestSubmissionFor(42, 20, 47), submissionId);
    }

    function test_WrongAudienceRejected() public {
        _openTask(_alice, 42, 20, 100e6);
        _jwt.setPayload(_payload(_bob, 42, 47));

        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(JsonClaim.ClaimMismatch.selector, "aud"));
        _vault.submit(42, 20, 47, _KID, "header", "payload", "signature");
    }

    function test_WrongRepoIdRejected() public {
        _openTask(_alice, 43, 20, 100e6);
        _jwt.setPayload(_payload(_bob, 42, 47));

        vm.prank(_bob);
        vm.expectRevert(abi.encodeWithSelector(JsonClaim.ClaimMismatch.selector, "repository_id"));
        _vault.submit(43, 20, 47, _KID, "header", "payload", "signature");
    }

    function test_WrongPrRejected() public {
        _openTask(_alice, 42, 20, 100e6);
        _jwt.setPayload(_payload(_bob, 42, 47));

        vm.prank(_bob);
        vm.expectRevert(abi.encodeWithSelector(JsonClaim.ClaimMismatch.selector, "ref"));
        _vault.submit(42, 20, 48, _KID, "header", "payload", "signature");
    }

    function test_LatestSubmissionTracksNewestSubmissionForPr() public {
        _openTask(_alice, 42, 20, 100e6);

        _jwt.setPayload(_payload(_bob, 42, 47));
        vm.prank(_bob);
        uint256 first = _vault.submit(42, 20, 47, _KID, "header", "payload", "signature");

        vm.warp(block.timestamp + 1);
        vm.prank(_bob);
        uint256 second = _vault.submit(42, 20, 47, _KID, "header", "payload", "signature");

        assertEq(first, 1);
        assertEq(second, 2);
        assertEq(_vault.latestSubmissionFor(42, 20, 47), second);
    }

    function test_ApproveLatestSubmissionReleasesChosenTokenEscrow() public {
        _openTask(_alice, 42, 20, 100e6);
        _submit(_bob, 42, 20, 47);
        uint256 latest = _vault.latestSubmissionFor(42, 20, 47);

        vm.expectEmit(true, true, true, true);
        emit Approved(latest, 42, 20, _token, 100e6, _bob);
        vm.prank(_alice);
        _vault.approve(42, 20, latest);

        TaskVault.Task memory task = _vault.tasks(_vault.taskId(42, 20));
        assertEq(uint256(task.amount), 0);
        assertEq(uint256(task.state), uint256(TaskVault.TaskState.Approved));
        assertEq(_token.balanceOf(_bob), 100e6);
        assertEq(_token.balanceOf(address(_vault)), 0);
    }

    function test_TasksCanUseDifferentEscrowTokens() public {
        _openTask(_alice, 42, 20, _token, 100e6);
        _openTask(_alice, 42, 21, _otherToken, 50e6);
        _submit(_bob, 42, 20, 47);
        _submit(_bob, 42, 21, 48);

        vm.prank(_alice);
        _vault.approve(42, 20, 1);

        vm.prank(_alice);
        _vault.approve(42, 21, 2);

        assertEq(_token.balanceOf(_bob), 100e6);
        assertEq(_otherToken.balanceOf(_bob), 50e6);
        assertEq(_token.balanceOf(address(_vault)), 0);
        assertEq(_otherToken.balanceOf(address(_vault)), 0);
    }

    function test_ApproveFollowsRikTransfer() public {
        _openTask(_alice, 42, 20, 100e6);
        _submit(_bob, 42, 20, 47);

        vm.prank(_alice);
        _rik.transferFrom(_alice, _carol, 42);

        vm.prank(_alice);
        vm.expectRevert(abi.encodeWithSelector(TaskVault.NotRikOwner.selector, uint256(42), _alice));
        _vault.approve(42, 20, 1);

        vm.prank(_carol);
        _vault.approve(42, 20, 1);
        assertEq(_token.balanceOf(_bob), 100e6);
    }

    function test_CancelBeforeTimeoutReverts() public {
        _openTask(_alice, 42, 20, 100e6);
        vm.warp(block.timestamp + 6 days);

        uint256 unlockAt = 1 + 7 days;
        vm.prank(_alice);
        vm.expectRevert(abi.encodeWithSelector(TaskVault.TooEarlyToCancel.selector, unlockAt));
        _vault.cancel(42, 20);
    }

    function test_CancelAfterTimeoutRefundsCreator() public {
        _token.mint(_alice, 100e6);
        uint256 balanceBefore = _token.balanceOf(_alice);
        vm.startPrank(_alice);
        _token.approve(address(_vault), 100e6);
        _vault.openTask(42, 20, _token, 100e6);
        _rik.transferFrom(_alice, _carol, 42);
        vm.stopPrank();

        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, true, true, true);
        emit TaskCancelled(42, 20, _alice, _token, 100e6);
        vm.prank(_carol);
        _vault.cancel(42, 20);

        TaskVault.Task memory task = _vault.tasks(_vault.taskId(42, 20));
        assertEq(uint256(task.amount), 0);
        assertEq(uint256(task.state), uint256(TaskVault.TaskState.Cancelled));
        assertEq(_token.balanceOf(_alice), balanceBefore);
    }

    function test_CancelAfterApproveReverts() public {
        _openTask(_alice, 42, 20, 100e6);
        _submit(_bob, 42, 20, 47);
        vm.prank(_alice);
        _vault.approve(42, 20, 1);

        vm.warp(block.timestamp + 30 days);
        vm.prank(_alice);
        vm.expectRevert(abi.encodeWithSelector(TaskVault.NotOpen.selector, TaskVault.TaskState.Approved));
        _vault.cancel(42, 20);
    }

    function test_LatestSubmissionForMissingPrReverts() public {
        bytes32 id = _vault.prId(42, 20, 47);
        vm.expectRevert(abi.encodeWithSelector(TaskVault.NoSubmissionForPr.selector, id));
        _vault.latestSubmissionFor(42, 20, 47);
    }

    function _openTask(address creator, uint256 rikId, uint16 issue, uint128 amount) private {
        _openTask(creator, rikId, issue, _token, amount);
    }

    function _openTask(address creator, uint256 rikId, uint16 issue, MockToken token, uint128 amount) private {
        token.mint(creator, amount);
        vm.startPrank(creator);
        token.approve(address(_vault), amount);
        _vault.openTask(rikId, issue, token, amount);
        vm.stopPrank();
    }

    function _submit(address wallet, uint256 rikId, uint16 issue, uint32 prNumber) private returns (uint256) {
        _jwt.setPayload(_payload(wallet, rikId, prNumber));
        vm.prank(wallet);
        return _vault.submit(rikId, issue, prNumber, _KID, "header", "payload", "signature");
    }

    function _payload(address wallet, uint256 rikId, uint32 prNumber) private pure returns (bytes memory) {
        return abi.encodePacked(
            '{"aud":"',
            Strings.toHexString(uint160(wallet), 20),
            '","repository_id":"',
            rikId.toString(),
            '","ref":"refs/pull/',
            uint256(prNumber).toString(),
            '/merge"}'
        );
    }
}
