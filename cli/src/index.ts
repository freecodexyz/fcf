import { Command } from "commander";
import { createWalletClient, createPublicClient, http, parseAbiItem } from "viem";
import type { Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, foundry } from "viem/chains";
import { importAbi } from "@/importAbi.js";
import packageJson from "../package.json" with { type: "json" };
import { exit } from "node:process";
import { parseJwt } from "./oidc.js";

const COMMAND_NAME = "fcf";
const COMMAND_DESCRIPTION = "FCF CLI tool."
const VERSION = packageJson?.version || "v0.0.1";

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

program
    .command("register")
    .requiredOption("--oidcToken <token>", "GitHub's OIDC repository token")
    // needs to be removed in prod or be a default
    .requiredOption("--contract <addr>", "deployed RIK address")
    .action(async (opts) => {
        const { wallet, publicC, account } = clients();

        const jwt = (() => {
            try {
                return parseJwt(opts.oidcToken);
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

        const hash = await wallet.writeContract({
            address: opts.contract as `0x${string}`,
            abi,
            functionName: "register",
            args: [repoId, ownerId],
            account,
        });
        const r = await publicC.waitForTransactionReceipt({ hash });
        console.log(`registered: ${hash} status=${r.status}`);
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