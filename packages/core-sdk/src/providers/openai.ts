import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { assistantMessage, toolCallId, toolResultMessage } from "@/Message.js";
import type { Message, ToolCall } from "@/Message.js";
import type { StreamingProvider } from "@/Provider.js";
import type { Conversation } from "@/Conversation.js";
import { ToolTable } from "@/tools.js";
import type { Tool, ToolArgument, ToolArgumentType } from "@/tools.js";

type JsonObject = Readonly<Record<string, unknown>>;

type OpenAIMessage =
    | { readonly role: "system" | "user"; readonly content: string }
    | { readonly role: "assistant"; readonly content: string | null; readonly tool_calls?: readonly OpenAIToolCall[] }
    | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

type OpenAIToolCall = {
    readonly id: string;
    readonly type: "function";
    readonly function: {
        readonly name: string;
        readonly arguments: string;
    };
};

type OpenAITool = {
    readonly type: "function";
    readonly function: {
        readonly name: string;
        readonly description: string;
        readonly parameters: OpenAIParameters;
    };
};

type OpenAIParameters = {
    readonly type: "object";
    readonly properties: Readonly<Record<string, OpenAIParameterSchema>>;
    readonly required: readonly string[];
};

type OpenAIParameterSchema = {
    readonly type:
        | Exclude<ToolArgumentType, "bytes" | "float" | "json">
        | "number"
        | readonly ["object", "array", "string", "number", "boolean", "null"];
    readonly contentEncoding?: "base64";
    readonly description?: string;
};

export type OpenAIChatPayload = {
    readonly request: OpenAIChatRequest;
    readonly context: OpenAIToolContext;
};

type OpenAIChatRequest = {
    readonly model: string;
    readonly messages: readonly OpenAIMessage[];
    readonly stream: true;
    readonly tools?: readonly OpenAITool[];
};

type OpenAIToolContext = {
    readonly conversation: Conversation;
    readonly toolTable: ToolTable;
};

type OpenAIStreamResponse = {
    readonly content: string;
    readonly toolCalls: readonly OpenAIToolCall[];
    readonly finishReason: string | null;
};

type ToolCallAccumulator = {
    readonly id: string | null;
    readonly type: "function";
    readonly function: {
        readonly name: string | null;
        readonly arguments: string;
    };
};

type StreamAccumulator = {
    readonly content: string;
    readonly toolCalls: readonly ToolCallAccumulator[];
    readonly finishReason: string | null;
    readonly done: boolean;
    readonly delta: string | null;
};

export type OpenAIProviderOptions = {
    readonly identifier?: string;
    readonly baseUrl?: string | URL;
    readonly model?: string;
    readonly apiKey: string;
    readonly fetch?: typeof globalThis.fetch;
    readonly maxToolRounds?: number;
};

const JSON_SCHEMA_TYPES = ["object", "array", "string", "number", "boolean", "null"] as const;

function isRecord(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableContent(message: Extract<Message, { readonly role: "assistant" }>): string | null {
    const content = message.encodedContent.decode();
    return message.toolCalls && content.length === 0 ? null : content;
}

function toolCallPayload(toolCall: ToolCall): OpenAIToolCall {
    return {
        id: toolCall.toolCallId,
        type: "function",
        function: {
            name: toolCall.name,
            arguments: "argumentsJson" in toolCall ? toolCall.argumentsJson : JSON.stringify(toolCall.arguments),
        },
    };
}

function messagePayload(message: Message): OpenAIMessage {
    switch (message.role) {
        case "system":
        case "user":
            return { role: message.role, content: message.encodedContent.decode() };
        case "assistant": {
            const payload = { role: "assistant", content: nullableContent(message) } satisfies OpenAIMessage;
            return message.toolCalls && message.toolCalls.length > 0
                ? { ...payload, tool_calls: message.toolCalls.map((toolCall) => toolCallPayload(toolCall)) }
                : payload;
        }
        case "tool":
            return {
                role: "tool",
                tool_call_id: message.toolCallId,
                content: message.encodedContent.decode(),
            };
    }
}

function argumentSchema(argument: ToolArgument): OpenAIParameterSchema {
    const schema = (() => {
        switch (argument.type) {
            case "boolean":
                return { type: "boolean" } as const;
            case "bytes":
                return { type: "string", contentEncoding: "base64" } as const;
            case "float":
                return { type: "number" } as const;
            case "integer":
                return { type: "integer" } as const;
            case "json":
                return { type: JSON_SCHEMA_TYPES } as const;
            case "string":
                return { type: "string" } as const;
        }
    })();

    return argument.description === undefined ? schema : { ...schema, description: argument.description };
}

function parametersPayload(tool: Tool): OpenAIParameters {
    const properties = Object.fromEntries(
        tool.arguments.map((argument) => [argument.name, argumentSchema(argument)]),
    );

    return {
        type: "object",
        properties,
        required: tool.arguments.map((argument) => argument.name),
    };
}

function toolsPayload(toolTable: ToolTable): readonly OpenAITool[] {
    return [...toolTable.tools.values()].map((tool) => ({
        type: "function",
        function: {
            name: tool.functionName,
            description: tool.description ?? `Execute ${tool.functionName}`,
            parameters: parametersPayload(tool),
        },
    }));
}

function emptyStreamAccumulator(): StreamAccumulator {
    return { content: "", toolCalls: [], finishReason: null, done: false, delta: null };
}

function emptyToolCall(): ToolCallAccumulator {
    return { id: null, type: "function", function: { name: null, arguments: "" } };
}

function mergeToolCalls(
    toolCalls: readonly ToolCallAccumulator[],
    deltas: readonly JsonObject[],
): readonly ToolCallAccumulator[] {
    const next = [...toolCalls];

    for (const delta of deltas) {
        const index = typeof delta.index === "number" ? delta.index : next.length;
        const current = next[index] ?? emptyToolCall();
        const functionDelta = isRecord(delta.function) ? delta.function : {};
        const currentFunction = current.function;

        next[index] = {
            id: typeof delta.id === "string" ? delta.id : current.id,
            type: delta.type === "function" ? "function" : current.type,
            function: {
                name: typeof functionDelta.name === "string" ? functionDelta.name : currentFunction.name,
                arguments: typeof functionDelta.arguments === "string"
                    ? `${currentFunction.arguments}${functionDelta.arguments}`
                    : currentFunction.arguments,
            },
        };
    }

    return next;
}

function processStreamLine(line: string, state: StreamAccumulator): StreamAccumulator {
    const emptyLine = line.length === 0 || line.startsWith(":") || !line.startsWith("data:");
    if (emptyLine) return { ...state, delta: null };

    const data = line.slice("data:".length).trim();
    if (data === "[DONE]") return { ...state, done: true, delta: null };

    const event = JSON.parse(data) as unknown;
    if (!isRecord(event)) throw new Error("OpenAI stream event must be a JSON object");
    if (event.error) throw new Error(String(event.error));

    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] : {};
    const delta = isRecord(choice.delta) ? choice.delta : {};
    const finishReason = typeof choice.finish_reason === "string"
        ? choice.finish_reason
        : typeof delta.finish_reason === "string"
            ? delta.finish_reason
            : state.finishReason;

    const toolDeltas = Array.isArray(delta.tool_calls)
        ? delta.tool_calls.filter(isRecord)
        : [];
    const toolCalls = toolDeltas.length === 0 ? state.toolCalls : mergeToolCalls(state.toolCalls, toolDeltas);
    const contentDelta = typeof delta.content === "string" ? delta.content : "";

    return {
        content: contentDelta.length === 0 ? state.content : `${state.content}${contentDelta}`,
        toolCalls,
        finishReason,
        done: state.done,
        delta: contentDelta.length === 0 ? null : contentDelta,
    };
}

function finalizedToolCalls(toolCalls: readonly ToolCallAccumulator[]): readonly OpenAIToolCall[] {
    return toolCalls.map((toolCall) => {
        if (!toolCall.id) throw new Error("tool call is missing an id");
        if (!toolCall.function.name) throw new Error("tool call is missing a function name");

        return {
            id: toolCall.id,
            type: "function",
            function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
            },
        };
    });
}

function parseToolArguments(argumentsJson: string): JsonObject {
    const parsed = JSON.parse(argumentsJson) as unknown;
    if (!isRecord(parsed)) throw new Error("tool arguments must be a JSON object");
    return parsed;
}

function providerArgumentValue(argument: ToolArgument, value: unknown): unknown {
    if (argument.type !== "bytes") return value;
    if (typeof value !== "string") throw new Error(`bytes argument ${argument.name} must be base64`);
    return new Uint8Array(Buffer.from(value, "base64"));
}

function toolResultContent(result: unknown): string {
    if (typeof result === "string") return result;
    return JSON.stringify(result) ?? "null";
}

class ToolCallValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ToolCallValidationError";
    }
}

function validationError(error: unknown): ToolCallValidationError {
    return error instanceof ToolCallValidationError
        ? error
        : new ToolCallValidationError(error instanceof Error ? error.message : String(error));
}

export class OpenAIProvider implements StreamingProvider<OpenAIChatPayload> {
    readonly identifier: string;
    readonly baseUrl: URL;
    readonly model: string;

    readonly #apiKey: string;
    readonly #fetch: typeof globalThis.fetch;
    readonly #maxToolRounds: number;

    constructor(options: OpenAIProviderOptions) {
        if (options.apiKey.length === 0) throw new Error("apiKey is required");
        if (options.maxToolRounds !== undefined && (!Number.isInteger(options.maxToolRounds) || options.maxToolRounds < 0)) {
            throw new Error("maxToolRounds must be a non-negative integer");
        }

        this.identifier = options.identifier ?? "openai";
        this.baseUrl = new URL(options.baseUrl ?? "https://api.openai.com/v1/chat/completions");
        this.model = options.model ?? "gpt-5-mini";
        this.#apiKey = options.apiKey;
        this.#fetch = options.fetch ?? globalThis.fetch;
        this.#maxToolRounds = options.maxToolRounds ?? 8;
    }

    buildPayload(conversation: Conversation, toolTable: ToolTable): OpenAIChatPayload {
        const request = {
            model: this.model,
            messages: conversation.messages.map((message) => messagePayload(message)),
            stream: true,
        } satisfies OpenAIChatRequest;
        const tools = toolsPayload(toolTable);

        return {
            request: tools.length === 0 ? request : { ...request, tools },
            context: { conversation, toolTable },
        };
    }

    async streamResponse(payload: OpenAIChatPayload, stdout: NodeJS.WritableStream): Promise<string> {
        let currentPayload = payload;
        let toolRounds = 0;

        while (true) {
            const response = await this.#requestStream(currentPayload, stdout);
            if (response.toolCalls.length === 0) return response.content;
            if (toolRounds >= this.#maxToolRounds) {
                throw new Error(`OpenAI tool call limit exceeded (${this.#maxToolRounds})`);
            }

            toolRounds += 1;
            this.#handleToolCalls(currentPayload.context, response);
            currentPayload = this.buildPayload(currentPayload.context.conversation, currentPayload.context.toolTable);
        }
    }

    async #requestStream(payload: OpenAIChatPayload, stdout: NodeJS.WritableStream): Promise<OpenAIStreamResponse> {
        const response = await this.#fetch(this.baseUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.#apiKey}`,
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            body: JSON.stringify(payload.request),
        });

        if (!response.ok) {
            throw new Error(`OpenAI request failed (${response.status}): ${await response.text()}`);
        }

        if (!response.body) throw new Error("OpenAI response did not include a stream body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let state = emptyStreamAccumulator();

        while (!state.done) {
            const chunk = await reader.read();
            if (chunk.done) break;

            buffer += decoder.decode(chunk.value, { stream: true });
            const result = this.#processBuffer(buffer, state, stdout);
            buffer = result.buffer;
            state = result.state;
        }

        buffer += decoder.decode();
        if (!state.done && buffer.trim().length > 0) {
            state = processStreamLine(buffer.trim(), state);
            if (state.delta) stdout.write(state.delta);
        }

        return {
            content: state.content,
            toolCalls: finalizedToolCalls(state.toolCalls),
            finishReason: state.finishReason,
        };
    }

    #processBuffer(
        buffer: string,
        state: StreamAccumulator,
        stdout: NodeJS.WritableStream,
    ): { readonly buffer: string; readonly state: StreamAccumulator } {
        let currentBuffer = buffer;
        let currentState = state;
        let lineEnd = currentBuffer.indexOf("\n");

        while (lineEnd >= 0) {
            const line = currentBuffer.slice(0, lineEnd).trim();
            currentBuffer = currentBuffer.slice(lineEnd + 1);
            currentState = processStreamLine(line, currentState);
            if (currentState.delta) stdout.write(currentState.delta);
            if (currentState.done) break;
            lineEnd = currentBuffer.indexOf("\n");
        }

        return { buffer: currentBuffer, state: currentState };
    }

    #handleToolCalls(context: OpenAIToolContext, response: OpenAIStreamResponse): void {
        context.conversation.addMessage(
            assistantMessage(
                response.content,
                response.toolCalls.map((toolCall) => ({
                    toolCallId: toolCallId(toolCall.id),
                    name: toolCall.function.name,
                    argumentsJson: toolCall.function.arguments,
                })),
            ),
        );

        for (const toolCall of response.toolCalls) {
            context.conversation.addMessage(this.#executeToolCall(context.toolTable, toolCall));
        }
    }

    #executeToolCall(toolTable: ToolTable, toolCall: OpenAIToolCall): Extract<Message, { readonly role: "tool" }> {
        try {
            const selector = this.#toolCallSelector(toolTable, toolCall);
            return toolResultMessage(toolResultContent(toolTable.run(selector)), toolCallId(toolCall.id));
        } catch (error) {
            if (!(error instanceof ToolCallValidationError)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            return toolResultMessage(toolResultContent({ error: message }), toolCallId(toolCall.id));
        }
    }

    #toolCallSelector(toolTable: ToolTable, toolCall: OpenAIToolCall): Uint8Array {
        try {
            const tool = [...toolTable.tools.values()].find((candidate) => candidate.functionName === toolCall.function.name);
            if (!tool) throw new ToolCallValidationError(`unknown tool: ${toolCall.function.name}`);

            const parsedArguments = parseToolArguments(toolCall.function.arguments);
            const values = Object.fromEntries(
                tool.arguments.map((argument) => {
                    if (!Object.hasOwn(parsedArguments, argument.name)) {
                        throw new ToolCallValidationError(`missing argument: ${argument.name}`);
                    }

                    return [argument.name, providerArgumentValue(argument, parsedArguments[argument.name])];
                }),
            );

            return toolTable.encodeCall(tool.functionName, values);
        } catch (error) {
            throw validationError(error);
        }
    }
}

export { OpenAIProvider as OpenaiProvider };
