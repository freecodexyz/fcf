import { randomUUID, type UUID } from "node:crypto";
import type { Message } from "@/message.js"

function dumpConversationToBytes(c: Conversation): Uint8Array {
    const payload = {
        uuid: c.uuid,
        messages: c.messages.map((message) => {
            const base = {
                uuid: message.uuid,
                timestamp: message.timestamp.toISOString(),
                role: message.role,
                encodedContent: Array.from(message.encodedContent.bytes),
            };

            if (message.role === "assistant" && message.toolCalls) {
                return { ...base, toolCalls: message.toolCalls };
            }

            if (message.role === "tool") {
                return { ...base, toolCallId: message.toolCallId };
            }

            return base;
        }),
    };

    return new TextEncoder().encode(JSON.stringify(payload));
}

export type SearchMessageResult<Message, E = Error> =
    | { ok: true, value: Message }
    | { ok: false, error: E };

export class Conversation {
    readonly #uuid: UUID;
    #messages: Message[];

    private constructor(messages: Message[]) {
        this.#uuid = randomUUID();
        this.#messages = messages;
    }

    static fromMessages(messages?: Message[]) {
        const m = (messages && messages?.length != 0) ? messages : [] as Message[];
        return new Conversation(m);
    }

    get uuid(): UUID {
        return this.#uuid;
    }

    get messages(): Message[] {
        return this.#messages;
    }

    searchMessage(uuid: UUID): SearchMessageResult<Message, "message_not_found"> {
        if (this.#messages.length <= 0) {
            return { ok: false, error: "message_not_found" };
        }

        for (let i = 0; i < this.#messages.length; i++) {
            const message = this.#messages[i];
            if (message?.uuid === uuid) return { ok: true, value: message };
        }

        return { ok: false, error: "message_not_found" };
    }

    addMessage(message: Message): void {
        this.#messages = [...this.#messages, message] as Message[];
    }

    dumpToBytes(): Uint8Array { return dumpConversationToBytes(this); }

}
