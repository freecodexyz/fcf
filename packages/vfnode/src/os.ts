import { type } from "node:os";
import { type Result, ok, err, assertNever } from "./result.js";

export type OperatingSystem =  "Linux" | "Darwin" | "Windows_NT";

export function getOs(): OperatingSystem {
    return type() as OperatingSystem;
}

export function isOsSupported(os: OperatingSystem): Result<boolean, "unsupported_os"> {
    switch (os) {
        case "Linux": return ok(true);
        case "Darwin": return ok(true);
        case "Windows_NT": return err("unsupported_os");

        default: return assertNever(os);
    }
}
