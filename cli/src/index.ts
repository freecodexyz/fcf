import { Command } from "commander";
import { createWalletClient, createPublicClient, http } from "viem";
import type { Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, foundry } from "viem/chains";
import { importAbi } from "@/importAbi.js";
import packageJson from "../package.json" with { type: "json" };
import { exit } from "node:process";

const COMMAND_NAME = "fcf";
const COMMAND_DESCRIPTION = "FCF CLI tool."
const VERSION = packageJson?.version || "v0.0.1";

// import abi -> created by forge build
let abi: Abi | null = null;
try {
    abi = importAbi();
} catch (err) {
    let error = "unknown error";
    if (err instanceof Error) error = err.message;
    console.error(`${COMMAND_NAME}: ${error}; exiting.`)
    exit(1);
}

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
    .requiredOption("--repo-id <n>", "GitHub repository_id")
    .requiredOption("--owner-id <n>", "GitHub owner numeric id")
    // needs to be removed in prod or be a default
    .requiredOption("--contract <addr>", "deployed RIK address")
    .action(async (opts) => {
        const { wallet, publicC, account } = clients();
        const hash = await wallet.writeContract({
            address: opts.contract as `0x${string}`,
            abi,
            functionName: "register",
            args: [BigInt(opts.repoId), BigInt(opts.ownerId)],
            account,
        });
        const r = await publicC.waitForTransactionReceipt({ hash });
        console.log(`registered: ${hash} status=${r.status}`);
    })

program.parseAsync(process.argv);