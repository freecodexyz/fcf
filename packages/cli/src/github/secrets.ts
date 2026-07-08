import { Octokit } from "@octokit/core";
import sodium from "libsodium-wrappers";

// standard github REST API headers
const HEADERS = {
    accept: "application/vnd.github+json",
    "X-Github-Api-Version": "2026-03-10",
}

async function encryptSecret(publicKeyBase64: string, value: string): Promise<string> {
    await sodium.ready;

    const keyBytes = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
    const valueBytes = sodium.from_string(value);
    const encryptedBytes = sodium.crypto_box_seal(valueBytes, keyBytes);

    return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}
// metadata looks like: { name, created_at, updated_at ... }
export async function getRepoSecretMetadata(client: Octokit, repoName: string, repoOwnerName: string, secretName: string): Promise<any> {
    const res = await client.request(
        "GET /repos/{owner}/{repo}/actions/secrets/{secret_name}",
        { owner: repoOwnerName, repo: repoName, secret_name: secretName, headers: HEADERS},
    );
    return res.data;
}

export async function setRepoSecret(client: Octokit, repoName: string, repoOwnerName: string, secretName: string, plainValue: string): Promise<void> {
    const { data: publicKey } = await client.request(
        "GET /repos/{owner}/{repo}/actions/secrets/public-key",
        {owner: repoOwnerName, repo: repoName, headers: HEADERS},
    );
    
    const encryptedSecret = await encryptSecret(publicKey.key, plainValue);

    await client.request(
        "PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}",
        { owner: repoOwnerName, repo: repoName, secret_name: secretName, encrypted_value: encryptedSecret, key_id: publicKey.key_id, headers: HEADERS},
    );

    return;
}