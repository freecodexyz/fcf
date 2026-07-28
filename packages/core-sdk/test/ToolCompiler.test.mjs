import assert from "node:assert/strict";
import test from "node:test";
import {
    Conversation,
    OpenAIProvider,
    ToolCompiler,
    ToolTable,
} from "../dist/index.js";

test("compiles a standard function with explicit defaults", () => {
    const table = new ToolTable();
    const compiler = new ToolCompiler(table);

    function join(prefix, count = 2, suffix = "") {
        return Array.from({ length: count }, () => prefix).join("") + suffix;
    }

    compiler.compile(join, {
        args: [
            ["prefix", "string", "Text to repeat."],
            ["count", "integer", "Repetition count.", { default: 2 }],
            ["suffix", "string", "Text to append.", { default: "" }],
        ],
        description: "Repeat and join text.",
    });

    const encoded = table.encodeCall("join", { prefix: "a", count: 1, suffix: "" });
    assert.equal(table.run(encoded), "a");
    assert.deepEqual(table.decodeCall(encoded), { prefix: "a", count: 1, suffix: "" });

    const compiled = table.toolFor(encoded).callable;
    assert.equal(compiled("a", undefined, undefined), "aa");
    assert.equal(compiled("a"), "aa");
});

test("keeps required-only call encoding compatible", () => {
    const table = new ToolTable();
    const selector = table.addTool("echo", {
        args: [["value", "string"]],
        callable: (value) => value,
    });
    const call = table.encodeCall("echo", { value: "ok" });

    assert.equal(call[selector.length], 5);
    assert.equal(table.run(call), "ok");
});

test("keeps every provider parameter required and describes defaults", () => {
    const table = new ToolTable();
    const compiler = new ToolCompiler(table);

    function inspect(path, depth = 1, filter = "*") {
        return { path, depth, filter };
    }

    compiler.compile(inspect, {
        args: [
            ["path", "string"],
            ["depth", "integer", "Traversal depth.", { default: 1 }],
            ["filter", "string", "Name filter.", { default: "*" }],
        ],
    });

    const provider = new OpenAIProvider({ apiKey: "test" });
    const payload = provider.buildPayload(Conversation.fromMessages(), table);
    const parameters = payload.request.tools[0].function.parameters;

    assert.deepEqual(parameters.required, ["path", "depth", "filter"]);
    assert.equal(parameters.properties.depth.description, "Traversal depth. Default: 1.");
    assert.equal(Object.hasOwn(parameters.properties.depth, "default"), false);
});

test("uses the configured error handler", () => {
    const table = new ToolTable();
    const compiler = new ToolCompiler(table, {
        onError: (error) => `error: ${error.message}`,
    });

    function fail(message) {
        throw new Error(message);
    }

    compiler.compile(fail, { args: [["message", "string"]] });

    assert.equal(table.run(table.encodeCall("fail", ["broken"])), "error: broken");
});
