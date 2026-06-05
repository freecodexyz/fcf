import { test, expect } from "vitest";
import { parseJwt } from "@/oidc.js";

test("parses GitHub OIDC payload", () => {
    // real (but expired) token
    const jwt = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6IjB0WVZjTSJ9" +
                ".eyJyZXBvc2l0b3J5X2lkIjoiMTIzNDUiLCJyZXBvc2l0b3J5X293bmV" +
                "yX2lkIjoiOTk5IiwiYXVkIjoiMHhmMzlmIn0.AAAA";

    const p = parseJwt(jwt).payload;
    expect(p.repository_id).toBe("12345");
    expect(p.repository_owner_id).toBe("999");
});