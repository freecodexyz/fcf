#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exit } from "node:process";

import { Command } from "commander";
import type { Abi } from "viem";
import { createPublicClient, createWalletClient, http, parseAbiItem, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, sepolia } from "viem/chains";

import { importAbi } from "@/utils/importAbi.js";
import packageJson from "../package.json" with { type: "json" };
import { b64urlToHex, jwtKid, parseJwt, requestGithubOidcToken } from "@/github/oidc.js";
import { getOctokit } from "./github/auth.js";

const COMMAND_NAME = "fcf";
const COMMAND_DESCRIPTION = "FCF CLI tool.";
const VERSION = packageJson?.version || "v0.0.1";

const DEFAULT_LIST_BLOCK_RANGE = 50_000n;
const GITHUB_ISSUER = "https://token.actions.githubusercontent.com";

const REGISTER_WORKFLOW_PATH = ".github/workflows/fcf-register.yml";
const REGISTER_WORKFLOW_TEMPLATE_PATH = new URL("../templates/fcf-register.yml", import.meta.url);

const abi = loadAbi();
const RepoRegisteredEvent = parseAbiItem(
    "event RepoRegistered(uint256 indexed repoId, address indexed registrant, uint64 githubOwnerId, uint64 registeredAt)"
);

function buildProgram(): Command {
    const program = new Command()
        .name(COMMAND_NAME)
        .description(COMMAND_DESCRIPTION)
        .version(VERSION);

    addInitCommand(program);
    addRegisterCommand(program);
    addKeysSyncCommand(program);
    addListCommand(program);
    addGithubCommand(program);

    return program;
}

// spawns the github action workflow file that runs the `register` command
function addInitCommand(program: Command): void {
    program
        .command("init")
        .option("--force", "overwrite existing workflow")
        .action((opts) => {
            if (existsSync(REGISTER_WORKFLOW_PATH) && !opts.force) {
                die(new Error(`${REGISTER_WORKFLOW_PATH} already exists`));
            }

            mkdirSync(dirname(REGISTER_WORKFLOW_PATH), { recursive: true });
            writeFileSync(REGISTER_WORKFLOW_PATH, readRegisterWorkflowTemplate());
            console.log(`created: ${REGISTER_WORKFLOW_PATH}`);
        });
}

// registers the RIK of a repository on-chain -> meant to be run in a github action in the target repo
function addRegisterCommand(program: Command): void {
    program
        .command("register")
        .option("--oidc-token <token>", "GitHub's OIDC repository token")
        // needs to be removed in prod or be a default
        .requiredOption("--contract <addr>", "deployed RIK address")
        .action(async (opts) => {
            const { account, publicClient, walletClient } = clients();
            const oidcToken = opts.oidcToken ?? 
                              await (async () => {
                                try { return await requestGithubOidcToken(account.address.toLowerCase()) } catch (err) { die(err); }
                              })();
            const jwt = parseRequiredJwt(oidcToken);

            const expectedAud = account.address.toLowerCase();
            if (jwt.payload.aud?.toLowerCase() !== expectedAud) {
                die(new Error(`aud mismatch: want ${expectedAud}, got ${jwt.payload.aud}`));
            }

            const repoId = BigInt(jwt.payload.repository_id);
            const ownerId = BigInt(jwt.payload.repository_owner_id);
            if (!jwt.header.kid) die(new Error("jwt kid missing"));

            const hash = await walletClient.writeContract({
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
            const r = await publicClient.waitForTransactionReceipt({ hash });
            console.log(`registered: ${hash} status=${r.status}`);
        });
}

// only the contract deployer can run this -> periodically adds valid Github public signing keys
function addKeysSyncCommand(program: Command): void {
    program
        .command("keys")
        .command("sync")
        // needs to be removed in prod or be a default
        .requiredOption("--contract <addr>", "deployed RIK address")
        .action(async (opts) => {
            const { account, publicClient, walletClient } = clients();
            const config = await fetchJson(`${GITHUB_ISSUER}/.well-known/openid-configuration`);
            const jwks = await fetchJson(config.jwks_uri);

            for (const key of jwks.keys ?? []) {
                if (key.kty !== "RSA" || !key.kid || !key.n || !key.e) continue;

                const kid = jwtKid(key.kid);
                const hash = await walletClient.writeContract({
                    address: opts.contract as `0x${string}`,
                    abi,
                    functionName: "addKey",
                    args: [kid, b64urlToHex(key.n), b64urlToHex(key.e)],
                    account,
                });
                const r = await publicClient.waitForTransactionReceipt({ hash });
                console.log(`key synced: ${key.kid} kid=${kid} status=${r.status}`);
            }
        });
}

function addListCommand(program: Command): void {
    program
        .command("list")
        // needs to be removed in prod or be a default
        .requiredOption("--contract <addr>", "deployed RIK address")
        .option("--from-block <n>", "starting block")
        .action(async (opts) => {
            const { publicClient } = clients();
            const fromBlock = opts.fromBlock
                ? BigInt(opts.fromBlock)
                : await publicClient.getBlockNumber() - DEFAULT_LIST_BLOCK_RANGE;

            const logs = await publicClient.getLogs({
                address: opts.contract as `0x${string}`,
                event: RepoRegisteredEvent,
                fromBlock,
                toBlock: "latest",
            });

            for (const l of logs) {
                const { repoId, registrant, githubOwnerId, registeredAt } = l.args;
                console.log(
                    `repo=${repoId} ownerId=${githubOwnerId} registrant=${registrant} at=${registeredAt}`
                );
            }
        });
}

function addGithubCommand(program: Command): void {
    program
        .command("github")
        .command("whoami")
        .action(async (_) => {
            let octokit;
            let data;
            try { octokit = await getOctokit(); data = (await octokit.request("GET /user")).data; } catch (err) { die(err); }
            if (!data.login) die("No GitHub login data found"); else console.log(`user=${data.login}   profile=${data.html_url}`);
        });
}

function clients() {
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const chain = rpcUrl.includes("sepolia") ? sepolia : foundry;
    const account = privateKeyToAccount(privateKey);

    return {
        account,
        publicClient: createPublicClient({ chain, transport: http(rpcUrl) }),
        walletClient: createWalletClient({ account, chain, transport: http(rpcUrl) }),
    };
}

async function fetchJson(url: string): Promise<any> {
    const res = await fetch(url);
    if (!res.ok) die(new Error(`request failed: ${url} (${res.status})`));
    return res.json();
}

async function requestRequiredGithubOidcToken(audience: string): Promise<string> {
    try {
        return await requestGithubOidcToken(audience);
    } catch (err) {
        die(err);
    }
}

function parseRequiredJwt(token: string): ReturnType<typeof parseJwt> {
    try {
        return parseJwt(token);
    } catch (err) {
        die(err);
    }
}

function readRegisterWorkflowTemplate(): string {
    try {
        return readFileSync(REGISTER_WORKFLOW_TEMPLATE_PATH, "utf8");
    } catch (err) {
        die(err);
    }
}

function loadAbi(): Abi {
    try {
        return importAbi();
    } catch (err) {
        die(err);
    }
}

function die(err: any): never {
    let error = "unknown error";
    if (err instanceof Error) error = err.message;
    console.error(`${COMMAND_NAME}: ${error}; exiting.`);
    exit(1);
}

const program = buildProgram();
program.parseAsync(process.argv);
