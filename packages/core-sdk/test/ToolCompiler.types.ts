import { ToolCompiler, ToolTable } from "../src/index.js";

const compiler = new ToolCompiler(new ToolTable());

function defaulted(value = 1): number {
    return value;
}

compiler.compile(defaulted, {
    args: [["value", "integer", "Value to return.", { default: 1 }]],
});

function optional(value?: number): number | undefined {
    return value;
}

compiler.compile(optional, {
    // @ts-expect-error Parameters that permit undefined require an explicit default.
    args: [["value", "integer"]],
});
