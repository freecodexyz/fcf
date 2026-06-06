import { readFileSync } from "node:fs";

const fixture = readFileSync(process.argv[2]);
process.stdout.write(`0x${fixture.toString("hex")}`);
