import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const artifactUrl = new URL("../../../contracts/out/RIK.sol/RIK.json", import.meta.url);
const abiUrl = new URL("../src/abi/RIK.json", import.meta.url);

const artifact = JSON.parse(readFileSync(artifactUrl, "utf8"));
if (!Array.isArray(artifact.abi)) throw Error("ABI JSON file does not contain an abi array");

mkdirSync(new URL("../src/abi", import.meta.url), { recursive: true });
writeFileSync(abiUrl, `${JSON.stringify(artifact.abi, null, 2)}\n`);
