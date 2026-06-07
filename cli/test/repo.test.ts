import { test, expect } from "vitest";

import { parseGithubRemote } from "@/github/repo.js";

test("parses https github origin", () => {
    expect(parseGithubRemote("https://github.com/freecodexyz/fcf.git")).toEqual({
        repoName: "fcf",
        repoOwnerName: "freecodexyz",
    });
});

test("parses ssh github origin", () => {
    expect(parseGithubRemote("git@github.com:freecodexyz/fcf.git")).toEqual({
        repoName: "fcf",
        repoOwnerName: "freecodexyz",
    });
});

test("parses ssh url github origin", () => {
    expect(parseGithubRemote("ssh://git@github.com/freecodexyz/fcf.git")).toEqual({
        repoName: "fcf",
        repoOwnerName: "freecodexyz",
    });
});

test("rejects non github origin", () => {
    expect(() => parseGithubRemote("https://gitlab.com/freecodexyz/fcf.git")).toThrow("origin remote is not a github repository");
});

test("rejects malformed github origin", () => {
    expect(() => parseGithubRemote("https://github.com/freecodexyz")).toThrow("origin remote is not a github repository");
});
