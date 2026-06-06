import { Command } from "commander";
import { createWalletClient, createPublicClient, http, parseAbiItem, toHex } from "viem";
import type { Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, foundry } from "viem/chains";
import { importAbi } from "@/importAbi.js";
import packageJson from "../package.json" with { type: "json" };
import { exit } from "node:process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { b64urlToHex, jwtKid, parseJwt } from "./oidc.js";

const COMMAND_NAME = "fcf";
const COMMAND_DESCRIPTION = "FCF CLI tool."
const VERSION = packageJson?.version || "v0.0.1";
const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";
const REGISTER_WORKFLOW_PATH = ".github/workflows/fcf-register.yml";
const REGISTER_WORKFLOW = `name: Register Repository

on:
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  register:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Register repository
        env:
          PRIVATE_KEY: \${{ secrets.FCF_PRIVATE_KEY }}
          RPC_URL: \${{ vars.FCF_RPC_URL }}
          FCF_CONTRACT: \${{ vars.FCF_CONTRACT }}
        run: |
          npx --yes @freecodexyz/cli register \\
            --contract "$FCF_CONTRACT"
`;

function die(err: any): never {
    let error = "unknown error";
    if (err instanceof Error) error = err.message;
    console.error(`${COMMAND_NAME}: ${error}; exiting.`)
    exit(1);
}

// import abi -> created by forge build
let abi: Abi | null = null;
try {
    abi = importAbi();
} catch (err) {
    die(err);
}

const RepoRegisteredEvent = parseAbiItem(
    "event RepoRegistered(uint256 indexed repoId, address indexed registrant, uint64 githubOwnerId, uint64 registeredAt)"
);

const program = new Command();

program.name(COMMAND_NAME)
       .description(COMMAND_DESCRIPTION)
       .version(VERSION);

function clients() {
    const pk = process.env.PRIVATE_KEY as `0x${string}`;
    const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const chain = rpc.includes("sepolia") ? sepolia : foundry;
    const account = privateKeyToAccount(pk);

    return {
        wallet: createWalletClient({ account, chain, transport: http(rpc) }),
        publicC: createPublicClient({ chain, transport: http(rpc) }),
        account,
    };

}

async function requestGithubOidcToken(audience: string): Promise<string> {
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!requestUrl || !requestToken) die(new Error("GitHub OIDC env vars not found"));

    const separator = requestUrl.includes("?") ? "&" : "?";
    // include aud in payload -> aud == eth address of signer
    const res = await fetch(`${requestUrl}${separator}audience=${encodeURIComponent(audience)}`, {
        headers: { authorization: `bearer ${requestToken}` },
    });
    if (!res.ok) die(new Error(`failed to fetch GitHub OIDC token: ${res.status}`));

    const body = await res.json() as { value?: string };
    if (!body.value) die(new Error("GitHub OIDC response did not contain token"));
    return body.value;
}

async function fetchJson(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) die(new Error(`request failed: ${url} (${res.status})`));
    return res.json();
}

program
    .command("init")
    .option("--force", "overwrite existing workflow")
    .action((opts) => {
        if (existsSync(REGISTER_WORKFLOW_PATH) && !opts.force) {
            die(new Error(`${REGISTER_WORKFLOW_PATH} already exists`));
        }

        mkdirSync(dirname(REGISTER_WORKFLOW_PATH), { recursive: true });
        writeFileSync(REGISTER_WORKFLOW_PATH, REGISTER_WORKFLOW);
        console.log(`created: ${REGISTER_WORKFLOW_PATH}`);
    });

program
    .command("register")
    .option("--oidc-token <token>", "GitHub's OIDC repository token")
    // needs to be removed in prod or be a default
    .requiredOption("--contract <addr>", "deployed RIK address")
    .action(async (opts) => {
        const { wallet, publicC, account } = clients();
        const oidcToken = opts.oidcToken ?? await requestGithubOidcToken(account.address.toLowerCase());

        const jwt = (() => {
            try {
                return parseJwt(oidcToken);
            } catch(err) {
                die(err);
            }
        })();

        const expectedAud = account.address.toLowerCase();
        if (jwt.payload.aud?.toLowerCase() !== expectedAud) {
            die(new Error(`aud mismatch: want ${expectedAud}, got ${jwt.payload.aud}`));
        }
        const repoId = BigInt(jwt.payload.repository_id);
        const ownerId = BigInt(jwt.payload.repository_owner_id);
        if (!jwt.header.kid) die(new Error("jwt kid missing"));

        const hash = await wallet.writeContract({
            address: opts.contract as `0x${string}`,
            abi,
            functionName: "register",
            args: [
                jwtKid(jwt.header.kid),
                toHex(jwt.headerB64),
                toHex(jwt.payloadB64),
                b64urlToHex(jwt.signatureB64),
                repoId,
                ownerId,
            ],
            account,
        });
        const r = await publicC.waitForTransactionReceipt({ hash });
        console.log(`registered: ${hash} status=${r.status}`);
    });

program
    .command("keys")
    .command("sync")
    // needs to be removed in prod or be a default
    .requiredOption("--contract <addr>", "deployed RIK address")
    .action(async (opts) => {
        const { wallet, publicC, account } = clients();
        const config = await fetchJson(`${GITHUB_ISSUER}/.well-known/openid-configuration`);
        const jwks = await fetchJson(config.jwks_uri);

        for (const key of jwks.keys ?? []) {
            if (key.kty !== "RSA" || !key.kid || !key.n || !key.e) continue;

            const kid = jwtKid(key.kid);
            const hash = await wallet.writeContract({
                address: opts.contract as `0x${string}`,
                abi,
                functionName: "addKey",
                args: [kid, b64urlToHex(key.n), b64urlToHex(key.e)],
                account,
            });
            const r = await publicC.waitForTransactionReceipt({ hash });
            console.log(`key synced: ${key.kid} kid=${kid} status=${r.status}`);
        }
    });

program
    .command("list")
    // needs to be removed in prod or be a default
    .requiredOption("--contract <addr>", "deployed RIK address")
    .option("--from-block <n>", "starting block", "0")
    .action(async (opts) => {
        const { publicC } = clients();
        const logs = await publicC.getLogs({
            address: opts.contract as `0x${string}`,
            event: RepoRegisteredEvent,
            fromBlock: BigInt(opts.fromBlock),
            toBlock: "latest",
        });
        
        for (const l of logs) {
            const { repoId, registrant, githubOwnerId, registeredAt} = l.args;
            console.log(
                `repo=${repoId} ownerId=${githubOwnerId} registrant=${registrant} at=${registeredAt}`
            );
        }
    });

program.parseAsync(process.argv);
