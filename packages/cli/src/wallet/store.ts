import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { getAddress, isAddress } from "viem";

export type StoredWallet = {
    address: `0x${string}`;
    privateKey: `0x${string}`;
    createdAt: string;
}

type WalletState = {
    local?: StoredWallet;
}

export function walletFilePath(): string {
    if (process.env.FCF_CONFIG_HOME) return join(resolve(process.env.FCF_CONFIG_HOME), "wallet.json");
    if (process.env.XDG_CONFIG_HOME) return join(resolve(process.env.XDG_CONFIG_HOME), "fcf", "wallet.json");
    return join(homedir(), ".config", "fcf", "wallet.json");
}

export function readLocalWallet(): StoredWallet | undefined {
    return readWalletState().local;
}

export function getLocalWallet(): StoredWallet {
    const wallet = readLocalWallet();
    if (!wallet) throw new Error(`wallet not found at ${walletFilePath()}; run fcf wallet create`);
    return wallet;
}

export function saveLocalWallet(wallet: StoredWallet): void {
    const state = readWalletState();
    state.local = wallet;
    writeWalletState(state);
}

function readWalletState(): WalletState {
    try {
        return parseWalletState(JSON.parse(readFileSync(walletFilePath(), "utf8")));
    } catch (err: any) {
        if (err?.code === "ENOENT") return {};
        throw err;
    }
}

function writeWalletState(state: WalletState): void {
    const filePath = walletFilePath();
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

    const tmpPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmpPath, filePath);
    chmodSync(filePath, 0o600);
}

function parseWalletState(value: any): WalletState {
    const state: WalletState = {};
    if (value?.local !== undefined) state.local = parseStoredWallet(value.local);
    return state;
}

function parseStoredWallet(value: any): StoredWallet {
    if (!isAddress(value?.address)) throw new Error(`invalid wallet file: local.address`);
    if (!isPrivateKey(value?.privateKey)) throw new Error(`invalid wallet file: local.privateKey`);
    if (typeof value?.createdAt !== "string") throw new Error(`invalid wallet file: local.createdAt`);

    return {
        address: getAddress(value.address),
        privateKey: value.privateKey,
        createdAt: value.createdAt,
    };
}

function isPrivateKey(value: unknown): value is `0x${string}` {
    return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}
