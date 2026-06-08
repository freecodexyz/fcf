import { getOctokit } from "@/github/auth.js";
import { getLocalGithubRepo } from "@/github/repo.js";
import { setRepoSecret } from "@/github/secrets.js";
import { getLocalWallet, type StoredWallet } from "./store.js";

export const DEFAULT_PRIVATE_KEY_SECRET_NAME = "FCF_PRIVATE_KEY";

export type LinkWalletOptions = {
    secretName: string;
}

export async function linkWallet(options: LinkWalletOptions): Promise<StoredWallet> {
    const wallet = getLocalWallet();
    const octokit = await getOctokit();
    const repo = await getLocalGithubRepo(octokit);

    await setRepoSecret(octokit, repo.repoName, repo.repoOwnerName, options.secretName, wallet.privateKey);
    return wallet;
}
