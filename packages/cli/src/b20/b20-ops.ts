import type { Abi, Account, Address, Hash } from "viem";
import { isAddress, parseAbi, parseEther } from "viem";

import FCFWrapperAbi from "../abi/FCFWrapper.json" with { type: "json" };

const fcfWrapperAbi = FCFWrapperAbi as Abi;
const erc20Abi = parseAbi([
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
]);

export type TransactionReceipt = {
    readonly status: "success" | "reverted";
};

export type PublicClientLike = {
    readContract(args: {
        readonly address: Address;
        readonly abi: Abi;
        readonly functionName: string;
        readonly args?: readonly unknown[];
    }): Promise<unknown>;
    waitForTransactionReceipt(args: { readonly hash: Hash }): Promise<TransactionReceipt>;
};

export type WalletClientLike = {
    writeContract(args: {
        readonly address: Address;
        readonly abi: Abi;
        readonly functionName: string;
        readonly args: readonly unknown[];
        readonly account: Account;
    }): Promise<Hash>;
};

export type B20OperationParams = {
    readonly amount: string;
    readonly wrapperAddress: Address;
    readonly account: Account;
    readonly publicClient: PublicClientLike;
    readonly walletClient: WalletClientLike;
};

export type ApprovalResult =
    | { readonly approved: false }
    | { readonly approved: true; readonly hash: Hash; readonly receipt: TransactionReceipt };

export type B20WrapResult = {
    readonly amount: bigint;
    readonly fcfToken: Address;
    readonly wrappedB20: Address;
    readonly approval: ApprovalResult;
    readonly hash: Hash;
    readonly receipt: TransactionReceipt;
};

export type B20UnwrapResult = {
    readonly amount: bigint;
    readonly wrappedB20: Address;
    readonly approval: ApprovalResult;
    readonly hash: Hash;
    readonly receipt: TransactionReceipt;
};

export async function wrapB20(params: B20OperationParams): Promise<B20WrapResult> {
    const amount = parsePositiveAmount(params.amount);
    const fcfToken = await readWrapperAddress(params.publicClient, params.wrapperAddress, "fcfToken");
    const wrappedB20 = await readWrapperAddress(params.publicClient, params.wrapperAddress, "wrappedB20");
    const approval = await approveIfNeeded({
        ...params,
        token: fcfToken,
        spender: params.wrapperAddress,
        amount,
    });
    const hash = await params.walletClient.writeContract({
        address: params.wrapperAddress,
        abi: fcfWrapperAbi,
        functionName: "deposit",
        args: [amount],
        account: params.account,
    });
    const receipt = await params.publicClient.waitForTransactionReceipt({ hash });

    return { amount, fcfToken, wrappedB20, approval, hash, receipt };
}

export async function unwrapB20(params: B20OperationParams): Promise<B20UnwrapResult> {
    const amount = parsePositiveAmount(params.amount);
    const wrappedB20 = await readWrapperAddress(params.publicClient, params.wrapperAddress, "wrappedB20");
    const approval = await approveIfNeeded({
        ...params,
        token: wrappedB20,
        spender: params.wrapperAddress,
        amount,
    });
    const hash = await params.walletClient.writeContract({
        address: params.wrapperAddress,
        abi: fcfWrapperAbi,
        functionName: "withdraw",
        args: [amount],
        account: params.account,
    });
    const receipt = await params.publicClient.waitForTransactionReceipt({ hash });

    return { amount, wrappedB20, approval, hash, receipt };
}

function parsePositiveAmount(amount: string): bigint {
    let parsed: bigint;
    try {
        parsed = parseEther(amount);
    } catch {
        throw new Error(`invalid amount: ${amount}`);
    }
    if (parsed <= 0n) throw new Error("amount must be greater than zero");
    return parsed;
}

async function readWrapperAddress(
    publicClient: PublicClientLike,
    wrapperAddress: Address,
    functionName: "fcfToken" | "wrappedB20",
): Promise<Address> {
    const value = await publicClient.readContract({
        address: wrapperAddress,
        abi: fcfWrapperAbi,
        functionName,
    });
    if (typeof value !== "string" || !isAddress(value)) throw new Error(`invalid ${functionName} address`);
    return value;
}

async function approveIfNeeded(params: Omit<B20OperationParams, "amount"> & {
    readonly token: Address;
    readonly spender: Address;
    readonly amount: bigint;
}): Promise<ApprovalResult> {
    const allowance = await params.publicClient.readContract({
        address: params.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [params.account.address, params.spender],
    });
    if (typeof allowance !== "bigint") throw new Error("invalid ERC-20 allowance result");
    if (allowance >= params.amount) return { approved: false };

    const hash = await params.walletClient.writeContract({
        address: params.token,
        abi: erc20Abi,
        functionName: "approve",
        args: [params.spender, params.amount],
        account: params.account,
    });
    const receipt = await params.publicClient.waitForTransactionReceipt({ hash });
    return { approved: true, hash, receipt };
}
