import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

const SELECTOR_SIZE = 4;
const ARG_BLOB_OFFSET_SIZE = 1;
const ARG_TABLE_ENTRY_SIZE = 4;
const MAX_U8 = 0xff;
const MAX_U16 = 0xffff;

// Encoded calls are laid out as:
// [selector][args_blob_offset][arg0_offset:u16][arg0_len:u16]...[args_blob]
// Offsets in the argument table are relative to args_blob, not the full call.
export type ToolArgumentType = "boolean" | "bytes" | "float" | "integer" | "json" | "string";

type ToolArgumentTypeInput =
    | ToolArgumentType
    | "bool"
    | "binary"
    | "int"
    | "str"
    | "text";

const TYPE_ALIASES = {
    bool: "boolean",
    boolean: "boolean",
    bytes: "bytes",
    binary: "bytes",
    float: "float",
    int: "integer",
    integer: "integer",
    json: "json",
    str: "string",
    string: "string",
    text: "string",
} as const satisfies Record<ToolArgumentTypeInput, ToolArgumentType>;

declare const nonEmptyStringBrand: unique symbol;
type NonEmptyString = string & { readonly [nonEmptyStringBrand]: true };

declare const selectorSizeBrand: unique symbol;
type SelectorSize = number & { readonly [selectorSizeBrand]: true };

export type ToolArgument = {
    readonly name: string;
    readonly type: ToolArgumentType;
    readonly description?: string;
};

type NormalizedToolArgument = ToolArgument & {
    readonly name: NonEmptyString;
};

export type ToolArgumentInput =
    | ToolArgument
    | {
        readonly name: string;
        readonly type?: ToolArgumentTypeInput;
        readonly description?: string;
    }
    | readonly [string, ToolArgumentTypeInput?, string?]
    | string;

export type ToolCallable = (...values: readonly unknown[]) => unknown;

export type Tool = {
    readonly functionName: string;
    readonly signature: string;
    readonly selector: Uint8Array;
    readonly arguments: readonly ToolArgument[];
    readonly description?: string;
    readonly callable: ToolCallable;
};

type RegisteredTool = Omit<Tool, "functionName" | "arguments"> & {
    readonly functionName: NonEmptyString;
    readonly arguments: readonly NormalizedToolArgument[];
};

export type AddToolOptions = {
    readonly args?: readonly ToolArgumentInput[];
    readonly description?: string;
    readonly callable: ToolCallable;
};

export type ToolCallValues =
    | readonly unknown[]
    | Readonly<Record<string, unknown>>
    | unknown;

function nonEmptyString(value: unknown, label: string): NonEmptyString {
    const normalized = String(value);
    if (normalized.length === 0) throw new Error(`${label} cannot be empty`);
    return normalized as NonEmptyString;
}

function selectorSize(bytes: unknown): SelectorSize {
    if (!Number.isInteger(bytes) || typeof bytes !== "number" || bytes <= 0) {
        throw new Error("selector size must be a positive integer");
    }

    return bytes as SelectorSize;
}

function normalizeFunctionName(functionName: unknown): NonEmptyString {
    return nonEmptyString(functionName, "function name");
}

function normalizeArgumentName(argumentName: unknown): NonEmptyString {
    return nonEmptyString(argumentName, "argument name");
}

function normalizeType(type: unknown): ToolArgumentType {
    const key = String(type).toLowerCase() as ToolArgumentTypeInput;
    const normalized = TYPE_ALIASES[key];
    if (!normalized) throw new Error(`unsupported argument type: ${String(type)}`);
    return normalized;
}

function normalizeArgument(argument: ToolArgumentInput): NormalizedToolArgument {
    if (Array.isArray(argument)) {
        const name = normalizeArgumentName(argument[0]);
        const type = normalizeType(argument[1] ?? "string");
        const description = argument[2];
        return description === undefined ? { name, type } : { name, type, description };
    }

    if (typeof argument === "object" && argument !== null) {
        const input = argument as {
            readonly name: string;
            readonly type?: ToolArgumentTypeInput;
            readonly description?: string;
        };
        const name = normalizeArgumentName(input.name);
        const type = normalizeType(input.type ?? "string");
        return input.description === undefined
            ? { name, type }
            : { name, type, description: input.description };
    }

    return { name: normalizeArgumentName(argument), type: "string" };
}

function normalizeArguments(args: readonly ToolArgumentInput[]): readonly NormalizedToolArgument[] {
    return args.map((argument) => normalizeArgument(argument));
}

function signatureFor(functionName: string, args: readonly NormalizedToolArgument[]): string {
    return `${normalizeFunctionName(functionName)}(${args.map((argument) => argument.name).join(", ")})`;
}

function selectorFor(signature: string, bytes: SelectorSize): Uint8Array {
    const digest = createHash("sha256").update(signature).digest();
    return new Uint8Array(digest.subarray(0, bytes));
}

function selectorKey(selector: Uint8Array): string {
    return Buffer.from(selector).toString("hex");
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }

    return bytes;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function valuesFromRecord(tool: RegisteredTool, values: Readonly<Record<string, unknown>>): readonly unknown[] {
    return tool.arguments.map((argument) => {
        if (Object.hasOwn(values, argument.name)) return values[argument.name];
        throw new Error(`missing argument: ${argument.name}`);
    });
}

function valuesFromArray(tool: RegisteredTool, values: readonly unknown[]): readonly unknown[] {
    if (values.length !== tool.arguments.length) {
        throw new Error(`tool ${tool.functionName} expects ${tool.arguments.length} arguments`);
    }

    return values;
}

function valuesFor(tool: RegisteredTool, values: ToolCallValues): readonly unknown[] {
    if (Array.isArray(values)) return valuesFromArray(tool, values);
    if (isRecord(values)) return valuesFromRecord(tool, values);
    if (tool.arguments.length === 1) return [values];

    throw new Error(`tool ${tool.functionName} expects ${tool.arguments.length} arguments`);
}

function encodeBoolean(value: unknown): Uint8Array {
    if (value === true) return new Uint8Array([1]);
    if (value === false) return new Uint8Array([0]);
    throw new Error("boolean arguments must be true or false");
}

function encodeBytes(value: unknown): Uint8Array {
    if (!(value instanceof Uint8Array)) throw new Error("bytes arguments must be Uint8Array values");
    return new Uint8Array(value);
}

function encodeFloat(value: unknown): Uint8Array {
    const number = Number(value);
    if (Number.isNaN(number)) throw new Error("float arguments must be numeric");
    return new TextEncoder().encode(String(number));
}

function encodeInteger(value: unknown): Uint8Array {
    if (typeof value === "bigint") return new TextEncoder().encode(value.toString());
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error("integer arguments must be safe integers");
    return new TextEncoder().encode(String(number));
}

function encodeJson(value: unknown): Uint8Array {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("json arguments must be JSON serializable");
    return new TextEncoder().encode(json);
}

function encodeString(value: unknown): Uint8Array {
    return new TextEncoder().encode(String(value));
}

function encodeValue(type: ToolArgumentType, value: unknown): Uint8Array {
    switch (type) {
        case "boolean":
            return encodeBoolean(value);
        case "bytes":
            return encodeBytes(value);
        case "float":
            return encodeFloat(value);
        case "integer":
            return encodeInteger(value);
        case "json":
            return encodeJson(value);
        case "string":
            return encodeString(value);
    }
}

function decodeBoolean(bytes: Uint8Array): boolean {
    if (bytes.length !== 1) throw new Error("boolean arguments must be one byte");
    const value = bytes[0];
    if (value === 0) return false;
    if (value === 1) return true;
    throw new Error("boolean arguments must be encoded as 0 or 1");
}

function decodeFloat(bytes: Uint8Array): number {
    const number = Number(new TextDecoder("ascii").decode(bytes));
    if (Number.isNaN(number)) throw new Error("float argument is not numeric");
    return number;
}

function decodeInteger(bytes: Uint8Array): number {
    const text = new TextDecoder("ascii").decode(bytes);
    if (!/^-?\d+$/.test(text)) throw new Error("integer argument is not numeric");
    const number = Number(text);
    if (!Number.isSafeInteger(number)) throw new Error("integer argument exceeds safe integer range");
    return number;
}

function decodeJson(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function decodeString(bytes: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function decodeValue(type: ToolArgumentType, bytes: Uint8Array): unknown {
    switch (type) {
        case "boolean":
            return decodeBoolean(bytes);
        case "bytes":
            return new Uint8Array(bytes);
        case "float":
            return decodeFloat(bytes);
        case "integer":
            return decodeInteger(bytes);
        case "json":
            return decodeJson(bytes);
        case "string":
            return decodeString(bytes);
    }
}

function fixedSelector(bytes: Uint8Array, size: SelectorSize): Uint8Array {
    return bytes.length === size ? bytes : bytes.subarray(0, size);
}

function decodeArgumentTable(bytes: Uint8Array, tool: RegisteredTool): readonly Uint8Array[] {
    if (bytes.length === 0) throw new Error("missing argument table");

    const argsBlobOffset = bytes[0];
    const expectedOffset = ARG_BLOB_OFFSET_SIZE + (tool.arguments.length * ARG_TABLE_ENTRY_SIZE);
    if (argsBlobOffset !== expectedOffset) {
        throw new Error("argument table does not match registered tool arity");
    }

    if (argsBlobOffset > bytes.length) throw new Error("selector is shorter than argument table");
    const argsBlob = bytes.subarray(argsBlobOffset);

    return tool.arguments.map((_argument, index) => {
        const entryOffset = ARG_BLOB_OFFSET_SIZE + (index * ARG_TABLE_ENTRY_SIZE);
        const view = new DataView(bytes.buffer, bytes.byteOffset + entryOffset, ARG_TABLE_ENTRY_SIZE);
        const relativeOffset = view.getUint16(0);
        const length = view.getUint16(2);
        const encodedValue = argsBlob.subarray(relativeOffset, relativeOffset + length);

        if (encodedValue.length !== length) throw new Error("argument table points outside argument blob");
        return encodedValue;
    });
}

export class ToolTable {
    readonly #selectorSize: SelectorSize;
    readonly #table = new Map<string, ToolCallable>();
    readonly #tools = new Map<string, RegisteredTool>();

    constructor(options: { readonly selectorSize?: number } = {}) {
        this.#selectorSize = selectorSize(options.selectorSize ?? SELECTOR_SIZE);
    }

    static signatureFor(functionName: string, args: readonly ToolArgumentInput[] = []): string {
        return signatureFor(functionName, normalizeArguments(args));
    }

    static selectorFor(signature: string, options: { readonly bytes?: number } = {}): Uint8Array {
        return selectorFor(String(signature), selectorSize(options.bytes ?? SELECTOR_SIZE));
    }

    get selectorSize(): number {
        return this.#selectorSize;
    }

    get table(): ReadonlyMap<string, ToolCallable> {
        return this.#table;
    }

    get tools(): ReadonlyMap<string, Tool> {
        return this.#tools;
    }

    addTool(functionName: string, options: AddToolOptions): Uint8Array {
        // Example:
        // table.addTool("sum", {
        //     args: [["a", "integer"], ["b", "integer"]],
        //     callable: (a, b) => Number(a) + Number(b),
        // });
        if (typeof options.callable !== "function") throw new Error("tool callable is required");

        const normalizedFunctionName = normalizeFunctionName(functionName);
        const normalizedArguments = normalizeArguments(options.args ?? []);
        const signature = signatureFor(normalizedFunctionName, normalizedArguments);
        const selector = selectorFor(signature, this.#selectorSize);
        const key = selectorKey(selector);

        if (this.#tools.has(key)) throw new Error(`tool selector collision for ${JSON.stringify(signature)}`);

        const tool: RegisteredTool = options.description === undefined
            ? {
                functionName: normalizedFunctionName,
                signature,
                selector,
                arguments: normalizedArguments,
                callable: options.callable,
            }
            : {
                functionName: normalizedFunctionName,
                signature,
                selector,
                arguments: normalizedArguments,
                description: options.description,
                callable: options.callable,
            };

        this.#tools.set(key, tool);
        this.#table.set(key, options.callable);

        return new Uint8Array(selector);
    }

    encodeCall(functionName: string, values: ToolCallValues = []): Uint8Array {
        const tool = this.#toolForName(functionName);
        const encodedValues = valuesFor(tool, values).map((value, index) => {
            const argument = tool.arguments[index];
            if (!argument) throw new Error("argument table does not match registered tool arity");
            return encodeValue(argument.type, value);
        });

        const argsBlobOffset = ARG_BLOB_OFFSET_SIZE + (tool.arguments.length * ARG_TABLE_ENTRY_SIZE);
        if (argsBlobOffset > MAX_U8) throw new Error("argument table is too large");

        const argTable = new Uint8Array(argsBlobOffset);
        argTable[0] = argsBlobOffset;
        const argsBlobParts: Uint8Array[] = [];
        let argsBlobSize = 0;

        encodedValues.forEach((encodedValue, index) => {
            const offset = argsBlobSize;
            const length = encodedValue.length;
            if (offset > MAX_U16 || length > MAX_U16) {
                throw new Error("encoded argument exceeds 16-bit table limits");
            }

            const entryOffset = ARG_BLOB_OFFSET_SIZE + (index * ARG_TABLE_ENTRY_SIZE);
            const view = new DataView(argTable.buffer, argTable.byteOffset + entryOffset, ARG_TABLE_ENTRY_SIZE);
            view.setUint16(0, offset);
            view.setUint16(2, length);

            argsBlobParts.push(encodedValue);
            argsBlobSize += length;
        });

        return concatBytes([tool.selector, argTable, concatBytes(argsBlobParts)]);
    }

    decodeCall(selector: Uint8Array): Record<string, unknown> {
        const [tool, encodedArguments] = this.#decodeSelector(selector);
        const decoded: Record<string, unknown> = {};

        tool.arguments.forEach((argument, index) => {
            const encodedValue = encodedArguments[index];
            if (!encodedValue) throw new Error("argument table does not match registered tool arity");
            decoded[argument.name] = decodeValue(argument.type, encodedValue);
        });

        return decoded;
    }

    run(selector: Uint8Array): unknown {
        const [tool, encodedArguments] = this.#decodeSelector(selector);
        const values = tool.arguments.map((argument, index) => {
            const encodedValue = encodedArguments[index];
            if (!encodedValue) throw new Error("argument table does not match registered tool arity");
            return decodeValue(argument.type, encodedValue);
        });

        const callable = this.#table.get(selectorKey(tool.selector));
        if (!callable) throw new Error("unknown tool selector");
        return callable(...values);
    }

    toolFor(selector: Uint8Array): Tool {
        const tool = this.#tools.get(selectorKey(fixedSelector(selector, this.#selectorSize)));
        if (!tool) throw new Error("unknown tool selector");
        return tool;
    }

    #toolForName(functionName: string): RegisteredTool {
        const name = normalizeFunctionName(functionName);
        for (const tool of this.#tools.values()) {
            if (tool.functionName === name) return tool;
        }

        throw new Error(`unknown tool: ${name}`);
    }

    #decodeSelector(selector: Uint8Array): readonly [RegisteredTool, readonly Uint8Array[]] {
        if (selector.length < this.#selectorSize) {
            throw new Error(`selector is shorter than ${this.#selectorSize} bytes`);
        }

        const fixed = selector.subarray(0, this.#selectorSize);
        const tool = this.#tools.get(selectorKey(fixed));
        if (!tool) throw new Error("unknown tool selector");

        return [tool, decodeArgumentTable(selector.subarray(this.#selectorSize), tool)];
    }
}
