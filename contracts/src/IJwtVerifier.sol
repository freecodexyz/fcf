// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IJwtVerifier
 * @notice Minimal verifier boundary for GitHub Actions OIDC JWTs.
 */
interface IJwtVerifier {
    /**
     * @notice Verifies a GitHub OIDC JWT and returns the decoded payload.
     *
     * @dev Implementations are expected to revert when `kid` is inactive, the RSA signature is invalid,
     *      the issuer is wrong, or the JWT is outside its active time window.
     *
     * Requirements:
     *
     * - `kid` must identify an active GitHub Actions signing key.
     * - `signature` must be valid for `headerB64.payloadB64`.
     * - The decoded payload must be a currently valid GitHub Actions OIDC payload.
     */
    function verifyGithubOidc(
        bytes32 kid,
        bytes calldata headerB64,
        bytes calldata payloadB64,
        bytes calldata signature
    ) external view returns (bytes memory payload);
}
