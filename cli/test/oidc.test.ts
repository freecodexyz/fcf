import { test, expect } from "vitest";
import { b64urlToHex, jwtKid, parseJwt } from "@/oidc.js";

test("parses GitHub OIDC payload", () => {
    // real (but expired) token
    const jwt = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6ImtpZC0wMDEifQ" +
                ".eyJyZXBvc2l0b3J5X2lkIjoiMTIzNDUiLCJyZXBvc2l0b3J5X293bmV" +
                "yX2lkIjoiOTk5IiwiYXVkIjoiMHhmMzlmIn0.AAEC";

    const jwt_ = parseJwt(jwt);
    const p = jwt_.payload;
    expect(jwt_.header.kid).toBe("kid-001");
    expect(p.repository_id).toBe("12345");
    expect(p.repository_owner_id).toBe("999");
    expect(b64urlToHex(jwt_.signatureB64)).toBe("0x000102");
    expect(jwtKid(jwt_.header.kid)).toMatch(/^0x[0-9a-f]{64}$/);
});
