import { Conversation } from "@/Conversation.js";
import { assistantMessage, systemMessage } from "@/Message.js";
import type { IOInterface } from "@/io.js";
import type { StreamingProvider } from "@/Provider.js";
import { ToolTable } from "@/tools.js";
import { TurnRequest } from "@/TurnRequest.js";
import type { TurnRequestReceiver } from "@/TurnRequest.js";

type RuntimeStatus = "ready" | "pending" | "streaming" | "stopped";

// RuntimeState models what the consumer is doing. The union keeps invalid
// states out of the model: pending and streaming always have a current turn
// request, while stopped has no current request and no buffered queue.
type RuntimeState =
    | {
        readonly status: "ready";
        readonly queue: readonly TurnRequest[];
        readonly lastError: Error | null;
    }
    | {
        readonly status: "pending";
        readonly current: TurnRequest;
        readonly queue: readonly TurnRequest[];
        readonly lastError: Error | null;
    }
    | {
        readonly status: "streaming";
        readonly current: TurnRequest;
        readonly queue: readonly TurnRequest[];
        readonly lastError: Error | null;
    }
    | {
        readonly status: "stopped";
        readonly queue: readonly [];
        readonly lastError: Error | null;
};

export type RuntimeOptions<Payload = unknown> = {
    readonly provider: StreamingProvider<Payload>;
    readonly ioInterface: IOInterface;
};

function readyState(lastError: Error | null = null): Extract<RuntimeState, { readonly status: "ready" }> {
    return { status: "ready", queue: [], lastError };
}

// These transition helpers are pure: each one receives the current state and
// returns the next state. Runtime owns when transitions happen; the helpers own
// which state changes are legal.
function enqueueTurnRequest(state: RuntimeState, turnRequest: TurnRequest): RuntimeState {
    if (state.status === "stopped") throw new Error("runtime is stopped");

    return { ...state, queue: [...state.queue, turnRequest] };
}

function nextPendingState(state: RuntimeState, stopRequested: boolean): RuntimeState {
    if (state.status !== "ready") return state;
    const [current, ...queue] = state.queue;
    if (!current) return stopRequested ? { status: "stopped", queue: [], lastError: state.lastError } : state;

    return { ...state, status: "pending", current, queue };
}

function beginStreaming(
    state: Extract<RuntimeState, { readonly status: "pending" }>,
): Extract<RuntimeState, { readonly status: "streaming" }> {
    return { ...state, status: "streaming" };
}

function finishTurn(
    state: Extract<RuntimeState, { readonly status: "pending" | "streaming" }>,
    stopRequested: boolean,
): RuntimeState {
    if (stopRequested && state.queue.length === 0) {
        return { status: "stopped", queue: [], lastError: state.lastError };
    }

    return { status: "ready", queue: state.queue, lastError: state.lastError };
}

function failTurn(
    state: Extract<RuntimeState, { readonly status: "pending" | "streaming" }>,
    error: Error,
    stopRequested: boolean,
): RuntimeState {
    const failedState = { ...state, lastError: error };
    return finishTurn(failedState, stopRequested);
}

function requestStop(state: RuntimeState): RuntimeState {
    if (state.status === "stopped") return state;
    if (state.status === "ready" && state.queue.length === 0) return { status: "stopped", queue: [], lastError: state.lastError };

    return state;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * Consumes TurnRequests published through the shared TurnRequest bus.
 *
 * Example:
 *
 * ```ts
 * import { randomUUID } from "node:crypto";
 * import { Runtime, TurnRequest, userMessage } from "@freecodexyz/core-sdk";
 *
 * const runtime = new Runtime({ provider, ioInterface });
 * new TurnRequest(userMessage("hello"), { uuid: randomUUID() }).publish();
 *
 * await runtime.waitUntilReady();
 * await runtime.stop();
 * ```
 */
export class Runtime<Payload = unknown> implements TurnRequestReceiver {
    readonly conversation = Conversation.fromMessages();
    readonly toolTable = new ToolTable();

    readonly #provider: StreamingProvider<Payload>;
    readonly #ioInterface: IOInterface;
    #state: RuntimeState = readyState();
    #consumer: Promise<void>;
    #stopRequested = false;
    #stateWaiters = new Set<() => void>();

    constructor(options: RuntimeOptions<Payload>) {
        this.#provider = options.provider;
        this.#ioInterface = options.ioInterface;
        TurnRequest.subscribe(this);
        this.#consumer = this.#consumeTurnRequests();
    }

    get stdout(): NodeJS.WriteStream {
        return this.#ioInterface.stdout;
    }

    get status(): RuntimeStatus {
        return this.#state.status;
    }

    get lastError(): Error | null {
        return this.#state.lastError;
    }

    get turnRequestBuffer(): readonly TurnRequest[] {
        return [...this.#state.queue];
    }

    handleTurnRequest(turnRequest: TurnRequest): TurnRequest {
        return this.handleRequest(turnRequest);
    }

    // TurnRequest.publish() calls this through the TurnRequestReceiver
    // interface. The request is only buffered here; the background consumer
    // serializes provider calls so turns are handled in order.
    handleRequest(turnRequest: TurnRequest): TurnRequest {
        if (this.#stopRequested) throw new Error("runtime is stopping");
        this.#transition((state) => enqueueTurnRequest(state, turnRequest));
        return turnRequest;
    }

    async waitUntilReady(): Promise<this> {
        while (!this.#isReady()) {
            await this.#waitForStateChange();
        }

        return this;
    }

    async stop(): Promise<this> {
        this.#stopRequested = true;
        this.#transition(requestStop);
        await this.#consumer;
        TurnRequest.unsubscribe(this);
        return this;
    }

    setSystemPrompt(prompt: string): void {
        this.conversation.addMessage(systemMessage(prompt));
    }

    #transition(update: (state: RuntimeState) => RuntimeState): void {
        this.#state = update(this.#state);
        this.#notifyStateWaiters();
    }

    #notifyStateWaiters(): void {
        for (const notify of this.#stateWaiters) {
            notify();
        }

        this.#stateWaiters.clear();
    }

    #waitForStateChange(): Promise<void> {
        return new Promise((resolve) => {
            this.#stateWaiters.add(resolve);
        });
    }

    #isReady(): boolean {
        return this.#state.status === "stopped" || (this.#state.status === "ready" && this.#state.queue.length === 0);
    }

    async #consumeTurnRequests(): Promise<void> {
        while (true) {
            const pendingState = await this.#nextPendingState();
            if (!pendingState) return;
            await this.#consumeTurnRequest(pendingState);
        }
    }

    async #nextPendingState(): Promise<Extract<RuntimeState, { readonly status: "pending" }> | null> {
        while (true) {
            this.#transition((state) => nextPendingState(state, this.#stopRequested));

            if (this.#state.status === "pending") return this.#state;
            if (this.#state.status === "stopped") return null;

            await this.#waitForStateChange();
        }
    }

    async #consumeTurnRequest(
        pendingState: Extract<RuntimeState, { readonly status: "pending" }>,
    ): Promise<void> {
        const turnRequest = pendingState.current;

        try {
            // A turn becomes part of the conversation before payload creation
            // so providers see the full history, including the latest user
            // message and any registered tools.
            this.conversation.addMessage(turnRequest.message);
            const payload = this.#provider.buildPayload(this.conversation, this.toolTable);

            this.#state = beginStreaming(pendingState);
            this.#notifyStateWaiters();

            const response = await this.#provider.streamResponse(payload, this.stdout);
            this.conversation.addMessage(assistantMessage(response));

            if (this.#state.status === "streaming") {
                this.#state = finishTurn(this.#state, this.#stopRequested);
                this.#notifyStateWaiters();
            }
        } catch (error) {
            if (this.#state.status === "pending" || this.#state.status === "streaming") {
                this.#state = failTurn(this.#state, asError(error), this.#stopRequested);
                this.#notifyStateWaiters();
            }
        }
    }
}
