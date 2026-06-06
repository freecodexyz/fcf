// src/JsonClaim.sol
// SDPX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library JsonClaim {
    error ClaimMissing(string claim);
    error ClaimMismatch(string claim);

    // find first occurrence of "needle" in "hay"; returns -1 if not found
    function indexOf(bytes memory hay, bytes memory needle) internal pure returns (int256) {
        if (needle.length == 0 || hay.length < needle.length) return -1;

        // this is O(n*m) decent enough
        for (uint256 i = 0; i <= hay.length - needle.length; i++) {
            bool match_ = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    match_ = false;
                    break;
                }
            }
            // safe to cast uint256 -> int256
            // forge-lint: disable-next-line(unsafe-typecast)
            if (match_) return int256(i);
        }
        return -1;
    }

    // assert the bytes for `"<key>":"<expectedValue>"` are present in payload
    function requireStringClaim(bytes memory payload, string memory key, string memory expectedValue) internal pure {
        bytes memory needle = abi.encodePacked('"', bytes(key), '":"', bytes(expectedValue), '"');
        if (indexOf(payload, needle) >= 0) return;

        bytes memory claim = abi.encodePacked('"', bytes(key), '":');
        if (indexOf(payload, claim) < 0) revert ClaimMissing(key);

        revert ClaimMismatch(key);
    }
}
