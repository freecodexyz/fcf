import { readFileSync } from "node:fs";
import { test, expect } from "vitest";

test("registration workflow template matches checked-in workflow", () => {
    const template = readFileSync(new URL("../templates/fcf-register.yml", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("../../../.github/workflows/fcf-register.yml", import.meta.url), "utf8");

    expect(template).toBe(workflow);
});
