import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export type NodeId = string & { readonly __brand: "nodeId" };

export type Identity = {
    readonly nodeId: NodeId;
    readonly publicAddress: Address;
    readonly privateKey: Hex;
};

export function createNodeId(): NodeId {
    return randomUUID() as NodeId;
}

export function createIdentity(): Identity {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    return {
        nodeId: createNodeId(),
        publicAddress: account.address,
        privateKey,
    };
}
