import type { Conversation } from "@/Conversation.js";
import type { ToolTable } from "@/tools.js";

export interface Provider {
    readonly identifier: string;
}

export interface StreamingProvider<Payload = unknown> extends Provider {
    buildPayload(conversation: Conversation, toolTable: ToolTable): Payload;
    streamResponse(payload: Payload, stdout: NodeJS.WritableStream): Promise<string>;
}
