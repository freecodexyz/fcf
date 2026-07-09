import { expect, test } from "vitest";
import type { Abi, Account, Address, Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { unwrapB20, wrapB20, type PublicClientLike, type WalletClientLike } from "@/b20/b20-ops.js";

const account = privateKeyToAccount("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const wrapperAddress = "0x1000000000000000000000000000000000000000" as Address;
const fcfToken = "0x2000000000000000000000000000000000000000" as Address;
const wrappedB20 = "0x3000000000000000000000000000000000000000" as Address;

type ReadCall = {
    readonly address: Address;
    readonly abi: Abi;
    readonly functionName: string;
    readonly args?: readonly unknown[];
};

type WriteCall = ReadCall & {
    readonly account: Account;
};

function makeClients(allowance: bigint): {
    readonly publicClient: PublicClientLike;
    readonly walletClient: WalletClientLike;
    readonly reads: ReadCall[];
    readonly writes: WriteCall[];
} {
    const reads: ReadCall[] = [];
    const writes: WriteCall[] = [];

    return {
        reads,
        writes,
        publicClient: {
            async readContract(args) {
                reads.push(args);
                if (args.functionName === "fcfToken") return fcfToken;
                if (args.functionName === "wrappedB20") return wrappedB20;
                if (args.functionName === "allowance") return allowance;
                throw new Error(`unexpected read: ${args.functionName}`);
            },
            async waitForTransactionReceipt() {
                return { status: "success" };
            },
        },
        walletClient: {
            async writeContract(args) {
                writes.push(args);
                return `0x${String(writes.length).padStart(64, "0")}` as Hash;
            },
        },
    };
}

test("wrap approves fcf then deposits parsed amount", async () => {
    const { publicClient, walletClient, writes } = makeClients(0n);

    const result = await wrapB20({
        amount: "1.5",
        wrapperAddress,
        account,
        publicClient,
        walletClient,
    });

    expect(result.amount).toBe(1500000000000000000n);
    expect(result.fcfToken).toBe(fcfToken);
    expect(result.wrappedB20).toBe(wrappedB20);
    expect(result.approval.approved).toBe(true);
    expect(writes.map((write) => write.functionName)).toEqual(["approve", "deposit"]);
    expect(writes[0]?.address).toBe(fcfToken);
    expect(writes[0]?.args).toEqual([wrapperAddress, 1500000000000000000n]);
    expect(writes[1]?.address).toBe(wrapperAddress);
    expect(writes[1]?.args).toEqual([1500000000000000000n]);
});

test("unwrap skips approval when wrapped allowance is sufficient", async () => {
    const { publicClient, walletClient, writes } = makeClients(2_000_000000000000000n);

    const result = await unwrapB20({
        amount: "2",
        wrapperAddress,
        account,
        publicClient,
        walletClient,
    });

    expect(result.amount).toBe(2000000000000000000n);
    expect(result.wrappedB20).toBe(wrappedB20);
    expect(result.approval.approved).toBe(false);
    expect(writes.map((write) => write.functionName)).toEqual(["withdraw"]);
    expect(writes[0]?.address).toBe(wrapperAddress);
    expect(writes[0]?.args).toEqual([2000000000000000000n]);
});

test("rejects zero amounts", async () => {
    const { publicClient, walletClient } = makeClients(0n);

    await expect(wrapB20({
        amount: "0",
        wrapperAddress,
        account,
        publicClient,
        walletClient,
    })).rejects.toThrow("amount must be greater than zero");
});
