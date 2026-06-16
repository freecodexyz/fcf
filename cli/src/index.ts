#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { exit } from "node:process";

import { Command } from "commander";
import type { Abi } from "viem";
import { createPublicClient, createWalletClient, http, parseAbiItem, parseEther, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, baseSepolia } from "viem/chains";
import { DopplerSDK } from "@whetstone-research/doppler-sdk/evm";

import { importAbi } from "@/utils/importAbi.js";
import packageJson from "../package.json" with { type: "json" };
import { b64urlToHex, jwtKid, parseJwt, requestGithubOidcToken } from "@/github/oidc.js";
import { getOctokit } from "./github/auth.js";
import { getLocalGithubRepo } from "./github/repo.js";
import { getRepoSecretMetadata, setRepoSecret } from "./github/secrets.js";
import { getRepoVariableMetadata, setRepoVariable } from "./github/vars.js";
import { createWallet } from "./wallet/create.js";
import { DEFAULT_PRIVATE_KEY_SECRET_NAME, linkWallet } from "./wallet/link.js";
import { getLocalWallet, walletFilePath } from "./wallet/store.js";
import { wallet } from "viem/tempo/actions";

const COMMAND_NAME                      = "fcf";
const COMMAND_DESCRIPTION               = "FCF CLI tool.";
const VERSION                           = packageJson?.version || "v0.0.1";

const DEFAULT_LIST_BLOCK_RANGE          = 2000n;
const GITHUB_ISSUER                     = "https://token.actions.githubusercontent.com";

const REGISTER_WORKFLOW_PATH            = ".github/workflows/fcf-register.yml";
const REGISTER_WORKFLOW_TEMPLATE_PATH   = new URL("../templates/fcf-register.yml", import.meta.url);

const WETH_BASE_SEPOLIA                 = "0x4200000000000000000000000000000000000006" as `0x${string}`;
const DAY                               = 24 * 60 * 60;

const VERBOSE_ERRORS                    = process.env.VERBOSE_ERRORS ? true : false;
const ENABLE_MARKET_COMMAND             = process.env.ENABLE_MARKET_COMMAND ? true : false;

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
    addWalletCommand(program);
    const githubCommand = program.command("github");
    addGithubWhoamiCommand(githubCommand);
    addGithubSecretsCommand(githubCommand);
    addGithubVarsCommand(githubCommand);

    // experimental
    if (ENABLE_MARKET_COMMAND) addMarketCommand(program);

    return program;
}

function addMarketCommand(program: Command): void {
    const marketCommand = program.command("market");

    marketCommand
        .command("new")
        .action(async (_) => {

            const { account, publicClient, walletClient } = clients();
            let doppler: DopplerSDK | null = null;
            try { doppler = new DopplerSDK({ publicClient, walletClient, chainId: baseSepolia.id }); } catch (err) { die(err); }
            if (!doppler) die("Failed to initialize doppler sdk");

            // NOTE: share token config is hardcoded right now
            const name              = "RIK Demo Share";
            const symbol            = "RIKSH";
            const tokenURI          = "ipfs://demo";
            const tokencfg          = {name, symbol, tokenURI};

            const initialSupply     = parseEther("1000000");
            const numTokensToSell   = parseEther("500000");
            const numeraire         = WETH_BASE_SEPOLIA;
            const salecfg           = {initialSupply, numTokensToSell, numeraire};

            const marketCap         = {start: 100_000, min: 10_000};
            const numerairePrice    = 3000;
            const minProceeds       = parseEther("0.5");
            const maxProceeds       = parseEther("5");
            const duration          = 1 * DAY; // <-- auction duration
            const marketCapRangecfg = {marketCap, numerairePrice, minProceeds, maxProceeds, duration};

            const migrationType     = "uniswapV4Split" as "uniswapV4Split";
            const fee               = 3000;
            const tickSpacing       = 60;
            const streamableFees    = {lockDuration: 365 * DAY, beneficiaries: [
                await doppler.getAirlockBeneficiary(),
                {beneficiary: account.address, shares: parseEther("0.95")}, // <-- only %5 to protocol
            ]};
            const migrationcfg      = {type: migrationType, migrationType, fee, tickSpacing, streamableFees};
            
            const params = doppler.buildDynamicAuction()
                .tokenConfig(tokencfg)
                .saleConfig(salecfg)
                .withMarketCapRange(marketCapRangecfg)
                .withMigration(migrationcfg)
                .withGovernance({type: "noOp"})
                .withUserAddress(account.address)
                .build();

            try { 
                const { hookAddress, tokenAddress, poolId } = await doppler.factory.createDynamicAuction(params);
                console.log(`New marketplace created!\npair=$${symbol}/$WETH hookAddress=${hookAddress} tokenAddress=${tokenAddress} poolId=${poolId}`);
            } catch (err) { die(err); }
        });
}

function addWalletCommand(program: Command): void {
    const walletCommand = program.command("wallet");

    walletCommand
        .command("create")
        .option("--force", "overwrite existing local wallet")
        .action((opts) => {
            try {
                const wallet = createWallet({ force: Boolean(opts.force) });
                console.log(`wallet created: ${wallet.address}`);
                console.log(`saved: ${walletFilePath()}`);
            } catch (err) { die(err); }
        });

    // set FCF_PRIVATE_KEY in the active github repo -> used after `wallet create`
    walletCommand
        .command("link")
        .option("--secret-name <name>", "GitHub Actions private key secret name", DEFAULT_PRIVATE_KEY_SECRET_NAME)
        .action(async (opts) => {
            try {
                const wallet = await linkWallet({ secretName: opts.secretName });
                console.log(`wallet linked: ${wallet.address}`);
                console.log(`secret set: ${opts.secretName}`);
            } catch (err) { die(err); }
        });
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

function addGithubWhoamiCommand(program: Command): void {
    program
        .command("whoami")
        .action(async (_) => {
            let octokit;
            let data;
            try { octokit = await getOctokit(); data = (await octokit.request("GET /user")).data; } catch (err) { die(err); }
            if (!data.login) die("No GitHub login data found"); else console.log(`user=${data.login}   profile=${data.html_url}`);
        })
}

function addGithubSecretsCommand(program: Command): void {
    const secretsCommand = program.command("secrets");

    secretsCommand
        .command("get")
        .argument("<secret_name>", "repository secret name")
        .action(async (secretName: string) => {
            let octokit;
            let data;
            try {
                octokit = await getOctokit();
                const repo = await getLocalGithubRepo(octokit);
                data = await getRepoSecretMetadata(octokit, repo.repoName, repo.repoOwnerName, secretName);
                console.log(JSON.stringify(data, null, 2));
            } catch (err) { die(err); }
        });

    secretsCommand
        .command("set")
        .argument("<secret_name>", "repository secret name")
        .argument("<value>", "secret value")
        .action(async (secretName: string, value: string) => {
            let octokit;
            try {
                octokit = await getOctokit();
                const repo = await getLocalGithubRepo(octokit);
                await setRepoSecret(octokit, repo.repoName, repo.repoOwnerName, secretName, value);
                console.log(`secret set: ${secretName}`);
            } catch (err) { die(err); }
        });
}

function addGithubVarsCommand(program: Command): void {
    const varsCommand = program.command("vars");

    varsCommand
        .command("get")
        .argument("<var_name>", "repository variable name")
        .action(async (varName: string) => {
            let octokit;
            let data;
            try {
                octokit = await getOctokit();
                const repo = await getLocalGithubRepo(octokit);
                data = await getRepoVariableMetadata(octokit, repo.repoName, repo.repoOwnerName, varName);
                console.log(JSON.stringify(data, null, 2));
            } catch (err) { die(err); }
        });

    varsCommand
        .command("set")
        .argument("<var_name>", "repository variable name")
        .argument("<value>", "variable value")
        .action(async (varName: string, value: string) => {
            let octokit;
            try {
                octokit = await getOctokit();
                const repo = await getLocalGithubRepo(octokit);
                await setRepoVariable(octokit, repo.repoName, repo.repoOwnerName, varName, value);
                console.log(`variable set: ${varName}`);
            } catch (err) { die(err); }
        });
}

function clients() {
    const privateKey = (() => {
        let key;
        if (process.env.PRIVATE_KEY) key = process.env.PRIVATE_KEY as `0x${string}`;
        else try { const wallet = getLocalWallet(); key = wallet.privateKey; } catch (err) { die(err) };
        return key;
    })();
    const rpcUrl = process.env.RPC_URL ?? "https://sepolia.base.org";
    const chain = rpcUrl.includes("sepolia") ? baseSepolia : foundry;
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
    if (VERBOSE_ERRORS) console.error(err);
    exit(1);
}

const program = buildProgram();
program.parseAsync(process.argv);
