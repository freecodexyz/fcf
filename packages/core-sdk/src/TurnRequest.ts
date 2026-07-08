import type { UUID } from "node:crypto";
import type { Message } from "@/Message.js";

export type TurnRequester = {
    readonly uuid: UUID;
};

export interface TurnRequestReceiver {
    handleTurnRequest(turnRequest: TurnRequest): TurnRequest;
}

export class TurnRequest {
    static readonly #receivers = new Set<TurnRequestReceiver>();

    constructor(
        readonly message: Message,
        readonly from: TurnRequester,
    ) {}

    static subscribe(receiver: TurnRequestReceiver): TurnRequestReceiver {
        this.#receivers.add(receiver);
        return receiver;
    }

    static unsubscribe(receiver: TurnRequestReceiver): void {
        this.#receivers.delete(receiver);
    }

    static get receivers(): readonly TurnRequestReceiver[] {
        return [...this.#receivers];
    }

    publish(): TurnRequest {
        for (const receiver of TurnRequest.#receivers) {
            receiver.handleTurnRequest(this);
        }

        return this;
    }
}
