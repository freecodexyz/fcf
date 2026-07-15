import { TextDecoder, TextEncoder } from "node:util";
import { isAddressEqual, recoverMessageAddress, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Bay, BayEndpoint, BayErrorListener, BayPacketListener } from "./Bay.js";
import type { Identity, NodeId } from "./Identity.js";

export const signedBayPacketVersion = 1 as const;
export const signedBayPacketDomain = "fcf-bay-signed-datagram-v1";

export type SignedBayUnsignedPacket = {
    readonly version: typeof signedBayPacketVersion;
    readonly nodeId: NodeId;
    readonly address: Address;
    readonly sequence: number;
    readonly timestamp: number;
    readonly payload: Hex;
};

export type SignedBayPacket = SignedBayUnsignedPacket & {
    readonly signature: Hex;
};

export type SignedBayOptions = {
    readonly bay: Bay;
    readonly identity: Identity;
    readonly now?: () => number;
};

export class SignedBay {
    readonly #bay: Bay;
    readonly #identity: Identity;
    readonly #now: () => number;
    #sequence = 0;

    constructor(options: SignedBayOptions) {
        const account = privateKeyToAccount(options.identity.privateKey);
        if (!isAddressEqual(account.address, options.identity.publicAddress)) {
            throw new Error("Identity publicAddress does not match privateKey");
        }

        this.#bay = options.bay;
        this.#identity = options.identity;
        this.#now = options.now ?? Date.now;
    }

    get remote(): BayEndpoint {
        return this.#bay.remote;
    }

    get local(): BayEndpoint {
        return this.#bay.local;
    }

    onError(listener: BayErrorListener): () => void {
        return this.#bay.onError(listener);
    }

    onPacket(listener: BayPacketListener): () => void {
        return this.#bay.onPacket(listener);
    }

    async send(data: Uint8Array, remote?: BayEndpoint): Promise<SignedBayPacket> {
        const packet = await this.sign(data);
        await this.#bay.send(encodeSignedBayPacket(packet), remote);

        return packet;
    }

    async sign(data: Uint8Array): Promise<SignedBayPacket> {
        const packet: SignedBayUnsignedPacket = {
            version: signedBayPacketVersion,
            nodeId: this.#identity.nodeId,
            address: this.#identity.publicAddress,
            sequence: this.#sequence,
            timestamp: this.#now(),
            payload: toHex(data),
        };
        const account = privateKeyToAccount(this.#identity.privateKey);
        const signature = await account.signMessage({ message: signedBayMessage(packet) });

        this.#sequence += 1;

        return {
            ...packet,
            signature,
        };
    }

    async close(): Promise<void> {
        await this.#bay.close();
    }
}

export function encodeSignedBayPacket(packet: SignedBayPacket): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(packet));
}

// Router-side helpers: these are exported so a router outside @freecodexyz/vfnode
// can decode a received UDP datagram and verify the claimed wallet signer.
export function decodeSignedBayPacket(data: Uint8Array): SignedBayPacket {
    const value: unknown = JSON.parse(new TextDecoder().decode(data));

    if (!isSignedBayPacket(value)) throw new Error("invalid signed Bay packet");

    return value;
}

export async function verifySignedBayPacket(packet: SignedBayPacket): Promise<boolean> {
    const recoveredAddress = await recoverMessageAddress({
        message: signedBayMessage(packet),
        signature: packet.signature,
    });

    return isAddressEqual(recoveredAddress, packet.address);
}

function signedBayMessage(packet: SignedBayUnsignedPacket): string {
    return [
        signedBayPacketDomain,
        `version:${packet.version}`,
        `nodeId:${packet.nodeId}`,
        `address:${packet.address}`,
        `sequence:${packet.sequence}`,
        `timestamp:${packet.timestamp}`,
        `payload:${packet.payload}`,
    ].join("\n");
}

function isSignedBayPacket(value: unknown): value is SignedBayPacket {
    if (typeof value !== "object" || value === null) return false;

    const packet = value as Record<string, unknown>;

    return packet.version === signedBayPacketVersion
        && typeof packet.nodeId === "string"
        && isAddress(packet.address)
        && typeof packet.sequence === "number"
        && Number.isSafeInteger(packet.sequence)
        && packet.sequence >= 0
        && typeof packet.timestamp === "number"
        && Number.isSafeInteger(packet.timestamp)
        && packet.timestamp >= 0
        && isHex(packet.payload)
        && isHex(packet.signature);
}

function isAddress(value: unknown): value is Address {
    return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isHex(value: unknown): value is Hex {
    return typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value);
}
