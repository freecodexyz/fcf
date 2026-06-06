import { readFileSync, writeFileSync } from "node:fs";

const packageUrl = new URL("../package.json", import.meta.url);
const packageJson = JSON.parse(readFileSync(packageUrl, "utf8"));
const match = /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(packageJson.version);
if (!match) throw Error(`invalid package version: ${packageJson.version}`);

const major = Number(match[1]);
const minor = Number(match[2]);
const patch = Number(match[3]) + 1;
const suffix = match[4] ?? "";

packageJson.version = `${major}.${minor}.${patch}${suffix}`;
writeFileSync(packageUrl, `${JSON.stringify(packageJson, null, 2)}\n`);
