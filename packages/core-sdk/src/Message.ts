import type { UUID } from "node:crypto";
import { randomUUID } from "node:crypto";

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
} | {
    readonly toolCallId: ToolCallId,
    readonly name: string,
    readonly argumentsJson: string
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

type MessageRole = Message["role"];
type MessageFor<Role extends MessageRole> = Extract<Message, { readonly role: Role }>;

function messageBase(content: string): MessageBase {
    return {
        uuid: randomUUID(),
        timestamp: new Date(),
        encodedContent: EncodedContent.fromString(content),
    };
}

export function userMessage(content: string): MessageFor<"user"> {
    return { ...messageBase(content), role: "user" };
}

export function assistantMessage(content: string, toolCalls?: readonly ToolCall[]): MessageFor<"assistant"> {
    return toolCalls === undefined || toolCalls.length === 0
        ? { ...messageBase(content), role: "assistant" }
        : { ...messageBase(content), role: "assistant", toolCalls: [...toolCalls] };
}

export function systemMessage(content: string): MessageFor<"system"> {
    return { ...messageBase(content), role: "system" };
}

export function toolResultMessage(content: string, toolCallIdValue: ToolCallId): MessageFor<"tool"> {
    return { ...messageBase(content), role: "tool", toolCallId: toolCallIdValue };
}
