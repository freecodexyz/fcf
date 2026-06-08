import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, expect } from "vitest";

import { createWallet } from "@/wallet/create.js";
import { readLocalWallet, walletFilePath } from "@/wallet/store.js";

test("creates and stores a local wallet", () => {
    const previousConfigHome = process.env.FCF_CONFIG_HOME;
    const configHome = mkdtempSync(join(tmpdir(), "fcf-wallet-"));
    process.env.FCF_CONFIG_HOME = configHome;

    try {
        const wallet = createWallet({ force: false });
        const filePath = walletFilePath();

        expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(wallet.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(readLocalWallet()).toEqual(wallet);
        expect(JSON.parse(readFileSync(filePath, "utf8")).local.privateKey).toBe(wallet.privateKey);
        expect(statSync(filePath).mode & 0o777).toBe(0o600);
        expect(() => createWallet({ force: false })).toThrow("wallet already exists");
    } finally {
        if (previousConfigHome === undefined) delete process.env.FCF_CONFIG_HOME;
        else process.env.FCF_CONFIG_HOME = previousConfigHome;
        rmSync(configHome, { recursive: true, force: true });
    }
});
