import type { Octokit } from "@octokit/core";

import { getCommandOutput } from "@/utils/getCommandOutput.js";

// standard github REST API headers
const HEADERS = {
    accept: "application/vnd.github+json",
    "X-Github-Api-Version": "2026-03-10",
}

export type GithubRepo = {
    repoName: string;
    repoOwnerName: string;
}

export async function getLocalGithubRepo(client: Octokit): Promise<GithubRepo> {
    let isInsideGitRepo;
    try { isInsideGitRepo = await getCommandOutput("git", ["rev-parse", "--is-inside-work-tree"]); } catch (_) { throw new Error("not inside a git repository"); }
    if (isInsideGitRepo !== "true") throw new Error("not inside a git repository");

    let originUrl;
    try { originUrl = await getCommandOutput("git", ["remote", "get-url", "origin"]); } catch (_) { throw new Error("git remote origin not found"); }

    const repo = parseGithubRemote(originUrl);
    const { data } = await client.request(
        "GET /repos/{owner}/{repo}",
        { owner: repo.repoOwnerName, repo: repo.repoName, headers: HEADERS},
    );

    return { repoName: data.name, repoOwnerName: data.owner.login };
}

export function parseGithubRemote(originUrl: string): GithubRepo {
    const sshRemote = originUrl.match(/^git@github\.com:([^/]+)\/(.+)$/);
    if (sshRemote) return parseGithubPath(`${sshRemote[1]}/${sshRemote[2]}`);

    try {
        const url = new URL(originUrl);
        if (url.hostname !== "github.com") throw new Error("origin remote is not a github repository");
        return parseGithubPath(url.pathname);
    } catch (_) {
        throw new Error("origin remote is not a github repository");
    }
}

function parseGithubPath(pathname: string): GithubRepo {
    const parts = pathname.replace(/^\/+|\/+$/g, "").split("/");
    const repoOwnerName = parts[0];
    const repoName = parts[1]?.replace(/\.git$/, "");

    if (!repoOwnerName || !repoName || parts.length !== 2) {
        throw new Error("origin remote is not a github repository");
    }

    return { repoName, repoOwnerName };
}
