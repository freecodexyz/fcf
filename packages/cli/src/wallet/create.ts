import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

import { readLocalWallet, saveLocalWallet, type StoredWallet, walletFilePath } from "./store.js";

export type CreateWalletOptions = {
    force: boolean;
}

export function createWallet(options: CreateWalletOptions): StoredWallet {
    if (readLocalWallet() && !options.force) {
        throw new Error(`wallet already exists at ${walletFilePath()}; use --force to overwrite`);
    }

    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const wallet = { address: account.address, privateKey, createdAt: new Date().toISOString() };
    saveLocalWallet(wallet);
    return wallet;
}
