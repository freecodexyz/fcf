import {
    createSocket,
    type BindOptions,
    type RemoteInfo,
    type Socket,
} from "node:dgram";
import type { AddressInfo } from "node:net";

export type BaySocketType = "udp4" | "udp6";

export type BayEndpoint = {
    readonly address: string;
    readonly port: number;
};

export type BayRemote = BayEndpoint & {
    readonly family: string;
    readonly size: number;
};

export type BayPacket = {
    readonly data: Uint8Array;
    readonly remote: BayRemote;
};

export type BayOptions = {
    readonly remote: BayEndpoint;
    readonly local?: {
        readonly address?: string;
        readonly port?: number;
    };
    readonly socketType?: BaySocketType;
};

export type BayPacketListener = (packet: BayPacket) => void;
export type BayErrorListener = (error: Error) => void;

export class Bay {
    readonly #packetListeners = new Set<BayPacketListener>();
    readonly #errorListeners = new Set<BayErrorListener>();
    readonly #remote: BayEndpoint;
    readonly #socket: Socket;
    #closed = false;

    private constructor(socket: Socket, remote: BayEndpoint) {
        this.#socket = socket;
        this.#remote = remote;

        this.#socket.on("message", (message: Buffer, remote: RemoteInfo) => {
            const packet = {
                data: new Uint8Array(message),
                remote: {
                    address: remote.address,
                    family: remote.family,
                    port: remote.port,
                    size: remote.size,
                },
            };

            for (const listener of this.#packetListeners) listener(packet);
        });

        this.#socket.on("error", (error: Error) => {
            for (const listener of this.#errorListeners) listener(error);
        });
    }

    static async open(options: BayOptions): Promise<Bay> {
        const socket = createSocket(options.socketType ?? "udp4");
        const bay = new Bay(socket, options.remote);

        await new Promise<void>((resolve, reject) => {
            const onListening = () => {
                socket.off("error", onError);
                resolve();
            };
            const onError = (error: Error) => {
                socket.off("listening", onListening);
                reject(error);
            };

            socket.once("listening", onListening);
            socket.once("error", onError);

            const bindOptions: BindOptions = {};
            if (options.local?.port !== undefined) bindOptions.port = options.local.port;
            if (options.local?.address !== undefined) bindOptions.address = options.local.address;

            socket.bind(bindOptions);
        });

        return bay;
    }

    get remote(): BayEndpoint {
        return this.#remote;
    }

    get local(): BayEndpoint {
        const address = this.#socket.address() as AddressInfo;

        return {
            address: address.address,
            port: address.port,
        };
    }

    onPacket(listener: BayPacketListener): () => void {
        this.#packetListeners.add(listener);

        return () => this.#packetListeners.delete(listener);
    }

    onError(listener: BayErrorListener): () => void {
        this.#errorListeners.add(listener);

        return () => this.#errorListeners.delete(listener);
    }

    async send(data: Uint8Array, remote: BayEndpoint = this.#remote): Promise<void> {
        if (this.#closed) throw new Error("Bay is closed");

        await new Promise<void>((resolve, reject) => {
            this.#socket.send(data, remote.port, remote.address, (error) => {
                if (error !== null) reject(error);
                else resolve();
            });
        });
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;

        await new Promise<void>((resolve) => {
            this.#socket.close(() => resolve());
        });
    }
}
