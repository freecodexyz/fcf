import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { err, ok, type Result } from "./result.js";

export type NodeId = string & { readonly __brand: "nodeId" };

export class Identity {
    readonly #nodeId: NodeId;
    readonly #publicAddress: Address;
    readonly #privateKey: Hex;

    private constructor(nodeId: NodeId, publicAddress: Address, privateKey: Hex) {
        this.#nodeId = nodeId;
        this.#publicAddress = publicAddress;
        this.#privateKey = privateKey;
    }

    static create(nodeId: NodeId): Result<Identity, "failed_to_create_identity"> {
        try {
            const privateKey = generatePrivateKey();

            return Identity.fromPrivateKey(nodeId, privateKey);
        } catch {
            return err("failed_to_create_identity");
        }
    }

    static fromPrivateKey(nodeId: NodeId, privateKey: Hex): Result<Identity, "failed_to_create_identity"> {
        try {
            const account = privateKeyToAccount(privateKey);

            return ok(new Identity(nodeId, account.address, privateKey));
        } catch {
            return err("failed_to_create_identity");
        }
    }

    get nodeId(): NodeId {
        return this.#nodeId;
    }

    get publicAddress(): Address {
        return this.#publicAddress;
    }

    async signMessage(message: string): Promise<Hex> {
        const account = privateKeyToAccount(this.#privateKey);

        return account.signMessage({ message });
    }
}

export function createNodeId(): NodeId {
    return randomUUID() as NodeId;
}
