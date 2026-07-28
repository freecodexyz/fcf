# @freecodexyz/core-sdk

Core TypeScript SDK for fcf.

## Compiling tools

`ToolCompiler` registers standard positional functions in a `ToolTable`. Its
parameter descriptors are checked against the function's TypeScript parameter
types.

```ts
import { ToolCompiler, ToolTable } from "@freecodexyz/core-sdk";

function read(path: string, offset = 0, limit = Number.MAX_SAFE_INTEGER): string {
    // Read and return the selected lines.
    return `${path}:${String(offset)}:${String(limit)}`;
}

const table = new ToolTable();
const compiler = new ToolCompiler(table);

compiler.compile(read, {
    args: [
        ["path", "string", "File to read."],
        ["offset", "integer", "Zero-based line offset.", { default: 0 }],
        ["limit", "integer", "Maximum number of lines.", { default: Number.MAX_SAFE_INTEGER }],
    ],
    description: "Read a file with line numbers.",
});
```

`ToolTable` continues to treat every parameter as required. When a function
parameter's TypeScript type permits `undefined`, its descriptor must supply a
default. The compiler applies that default before invocation and includes it in
the argument description; it does not add optional-parameter behavior to
`ToolTable` or providers.
