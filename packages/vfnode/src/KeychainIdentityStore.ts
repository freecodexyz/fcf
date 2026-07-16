import { AsyncEntry } from "@napi-rs/keyring";
import { isHex, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { Identity, createNodeId, type NodeId } from "./Identity.js";
import { getOs, isOsSupported } from "./os.js";
import { err, ok, type Result } from "./result.js";

export type IdentityRecordVersion = 1;

export type StoredIdentity = {
    readonly version: IdentityRecordVersion;
    readonly nodeId: NodeId;
    readonly privateKey: Hex;
};

export type IdentityStoreError =
    | "unsupported_os"
    | "keychain_unavailable"
    | "identity_not_found"
    | "invalid_identity_record"
    | "failed_to_save_identity"
    | "failed_to_delete_identity"
    | "failed_to_create_identity";

export interface IdentityStore {
    load(): Promise<Result<Identity, IdentityStoreError>>;
    create(): Promise<Result<Identity, IdentityStoreError>>;
    delete(): Promise<Result<boolean, IdentityStoreError>>;
}

export const identityKeychainService = "fcf.vfnode.identity";
export const identityKeychainAccount = "default";

export class KeychainIdentityStore implements IdentityStore {
    readonly #entry: AsyncEntry;

    private constructor(entry: AsyncEntry) {
        this.#entry = entry;
    }

    static open(): Result<KeychainIdentityStore, "unsupported_os" | "keychain_unavailable"> {
        const supported = isOsSupported(getOs());
        if (!supported.ok) return err(supported.error);

        try {
            return ok(new KeychainIdentityStore(new AsyncEntry(identityKeychainService, identityKeychainAccount)));
        } catch {
            return err("keychain_unavailable");
        }
    }

    async load(): Promise<Result<Identity, IdentityStoreError>> {
        let stored: string | undefined;
        try {
            stored = await this.#entry.getPassword();
        } catch {
            return err("keychain_unavailable");
        }

        if (stored === undefined) return err("identity_not_found");

        const record = parseStoredIdentity(stored);
        if (!record.ok) return record;

        return Identity.fromPrivateKey(record.value.nodeId, record.value.privateKey);
    }

    async create(): Promise<Result<Identity, IdentityStoreError>> {
        let privateKey: Hex;
        let nodeId: NodeId;
        try {
            privateKey = generatePrivateKey();
            nodeId = createNodeId();
        } catch {
            return err("failed_to_create_identity");
        }

        const identity = Identity.fromPrivateKey(nodeId, privateKey);
        if (!identity.ok) return identity;

        const record = JSON.stringify({
            version: 1,
            nodeId,
            privateKey,
        } satisfies StoredIdentity);

        try {
            await this.#entry.setPassword(record);
        } catch {
            return err("failed_to_save_identity");
        }

        return identity;
    }

    async delete(): Promise<Result<boolean, IdentityStoreError>> {
        try {
            return ok(await this.#entry.deleteCredential());
        } catch {
            return err("failed_to_delete_identity");
        }
    }
}

function parseStoredIdentity(value: string): Result<StoredIdentity, "invalid_identity_record"> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return err("invalid_identity_record");
    }

    if (
        typeof parsed === "object"
        && parsed !== null
        && "version" in parsed
        && "nodeId" in parsed
        && "privateKey" in parsed
        && parsed.version === 1
        && typeof parsed.nodeId === "string"
        && parsed.nodeId.length > 0
        && typeof parsed.privateKey === "string"
        && isHex(parsed.privateKey)
        && parsed.privateKey.length === 66
    ) {
        return ok({
            version: parsed.version,
            nodeId: parsed.nodeId as NodeId,
            privateKey: parsed.privateKey,
        });
    }

    return err("invalid_identity_record");
}
