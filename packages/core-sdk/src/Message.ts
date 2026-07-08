import type { UUID } from "node:crypto";

export class EncodedContent {
    readonly #bytes: Uint8Array;

    private constructor(bytes: Uint8Array) {
        this.#bytes = bytes;
    }

    static fromString(text: string): EncodedContent {
        return new EncodedContent(new TextEncoder().encode(text));
    }

    get size(): number {
        return this.#bytes.length;
    }

    get bytes(): Uint8Array {
        return this.#bytes;
    }

    decode(): string {
        return new TextDecoder("utf-8").decode(this.#bytes);
    }
}

type ToolCallId = string & { readonly __brand: "ToolCallId" };
export const toolCallId = (s: string): ToolCallId => s as ToolCallId;

export type ToolCall = {
    readonly toolCallId: ToolCallId,
    readonly name: string,
    readonly arguments: { [key: string]: unknown }
}

export interface MessageBase {
    readonly uuid: UUID;
    readonly timestamp: Date;
    readonly encodedContent: EncodedContent;
}

export type Message = 
    | (MessageBase & {readonly role: "user"})
    | (MessageBase & {readonly role: "assistant", readonly toolCalls?: ToolCall[]})
    | (MessageBase & {readonly role: "system"})
    | (MessageBase & {readonly role: "tool", readonly toolCallId: ToolCallId})
