import { getCommandOutput } from "@/utils/getCommandOutput.js";
import { Octokit } from "@octokit/core";

let octokit: Octokit | null = null;

async function getLocalGitToken(): Promise<string> {
    const out = await getCommandOutput("git", ["credential", "fill"], `protocol=https\nhost=github.com\n\n`);
    let token = "";
    if (out.length <= 0 || out.split("password=").length < 2) throw Error("Unable to find stored git credentials");

    token = out.split("password=")[1]!;
    return token;
}

// singleton Octokit
export async function getOctokit(): Promise<Octokit> {
    if (octokit) return octokit;
    octokit = new Octokit({ auth: await getLocalGitToken()});

    return octokit;
}