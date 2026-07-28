import { ToolTable } from "@/tools.js";
import type { ToolArgumentInput, ToolArgumentType } from "@/tools.js";

type CompilableFunction = (...args: never[]) => unknown;

type ToolTypeFor<Value> =
    [NonNullable<Value>] extends [never] ? "json"
        : [NonNullable<Value>] extends [boolean] ? "bool" | "boolean"
            : [NonNullable<Value>] extends [Uint8Array] ? "binary" | "bytes"
                : [NonNullable<Value>] extends [bigint] ? "int" | "integer"
                    : [NonNullable<Value>] extends [number] ? "float" | "int" | "integer"
                        : [NonNullable<Value>] extends [string] ? "str" | "string" | "text"
                            : "json";

export type ToolParameterOptions<Value> = {
    readonly default: Exclude<Value, undefined>;
};

type RequiredToolParameter<Value> = readonly [
    name: string,
    type: ToolTypeFor<Value>,
    description?: string,
];

type DefaultedToolParameter<Value> = readonly [
    name: string,
    type: ToolTypeFor<Value>,
    description: string | undefined,
    options: ToolParameterOptions<Value>,
];

export type ToolParameter<Value> = undefined extends Value
    ? DefaultedToolParameter<Value>
    : RequiredToolParameter<Value>;

type ToolParameters<Values extends readonly unknown[]> = {
    readonly [Index in keyof Values]-?: ToolParameter<Values[Index]>;
};

type ToolParameterTypeInput =
    | ToolArgumentType
    | "bool"
    | "binary"
    | "int"
    | "str"
    | "text";

type RuntimeToolParameter = readonly [
    name: string,
    type: ToolParameterTypeInput,
    description?: string,
    options?: ToolParameterOptions<unknown>,
];

export type ToolDefinition<Callable extends CompilableFunction> = {
    readonly args: ToolParameters<Parameters<Callable>>;
    readonly description?: string;
};

export type ToolCompilerOptions = {
    readonly onError?: (error: unknown) => unknown;
};

/**
 * Compiles standard functions into ToolTable-compatible tool definitions.
 * Optional parameters without explicit defaults are intentionally not allowed.
 * This invariant ensures every invocation has a valid value for each ToolTable
 * argument, preventing missing-value errors at runtime.
 *
 * Example:
 *
 * ```ts
 * import { ToolCompiler, ToolTable } from "@freecodexyz/core-sdk";
 *
 * function sum(a: number, b = 0): number {
 *     return a + b;
 * }
 *
 * const table = new ToolTable();
 * const compiler = new ToolCompiler(table);
 * compiler.compile(sum, {
 *     args: [
 *         ["a", "integer", "First value."],
 *         ["b", "integer", "Second value.", { default: 0 }],
 *     ],
 *     description: "Add two integers.",
 * });
 *
 * const call = table.encodeCall("sum", { a: 2, b: 3 });
 * table.run(call); // 5
 * ```
 */
export class ToolCompiler {
    readonly #toolTable: ToolTable;
    readonly #onError: ((error: unknown) => unknown) | undefined;

    constructor(toolTable: ToolTable, options: ToolCompilerOptions = {}) {
        this.#toolTable = toolTable;
        this.#onError = options.onError;
    }

    compile<Callable extends CompilableFunction>(
        callable: Callable,
        definition: ToolDefinition<Callable>,
    ): Uint8Array {
        const parameters = definition.args as unknown as readonly RuntimeToolParameter[];
        const args = parameters.map((parameter) => {
            const [name, type, description, options] = parameter;
            const encodedDefault = options === undefined
                ? undefined
                : typeof options.default === "bigint"
                    ? options.default.toString()
                    : options.default instanceof Uint8Array
                        ? JSON.stringify(Array.from(options.default))
                        : JSON.stringify(options.default);
            const defaultDescription = encodedDefault === undefined ? undefined : `Default: ${encodedDefault}.`;
            const fullDescription = description === undefined
                ? defaultDescription
                : defaultDescription === undefined
                    ? description
                    : `${description} ${defaultDescription}`;

            return {
                name,
                type,
                ...(fullDescription === undefined ? {} : { description: fullDescription }),
            } as const satisfies ToolArgumentInput;
        });
        const compiled = (...values: readonly unknown[]): unknown => {
            try {
                const defaultedValues = parameters.map((parameter, index) => {
                    const value = values[index];
                    if (value !== undefined) return value;
                    return parameter[3]?.default;
                });
                return callable(...defaultedValues as Parameters<Callable>);
            } catch (error) {
                if (!this.#onError) throw error;
                return this.#onError(error);
            }
        };

        return this.#toolTable.addTool(callable.name, {
            args,
            ...(definition.description === undefined ? {} : { description: definition.description }),
            callable: compiled,
        });
    }
}
