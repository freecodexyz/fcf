import type { Octokit } from "@octokit/core";

// standard github REST API headers
const HEADERS = {
    accept: "application/vnd.github+json",
    "X-Github-Api-Version": "2026-03-10",
}

// metadata looks like: { name, value, created_at, updated_at ... }
export async function getRepoVariableMetadata(client: Octokit, repoName: string, repoOwnerName: string, variableName: string): Promise<any> {
    const res = await client.request(
        "GET /repos/{owner}/{repo}/actions/variables/{name}",
        { owner: repoOwnerName, repo: repoName, name: variableName, headers: HEADERS},
    );
    return res.data;
}

export async function setRepoVariable(client: Octokit, repoName: string, repoOwnerName: string, variableName: string, value: string): Promise<void> {
    try {
        await client.request(
            "PATCH /repos/{owner}/{repo}/actions/variables/{name}",
            { owner: repoOwnerName, repo: repoName, name: variableName, value, headers: HEADERS},
        );
    } catch (err) {
        if (!isNotFoundError(err)) throw err;

        await client.request(
            "POST /repos/{owner}/{repo}/actions/variables",
            { owner: repoOwnerName, repo: repoName, name: variableName, value, headers: HEADERS},
        );
    }
}

function isNotFoundError(err: unknown): boolean {
    return typeof err === "object" && err !== null && "status" in err && err.status === 404;
}
