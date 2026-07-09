import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const abis = [
  {
    artifact: "../../../contracts/out/RIK.sol/RIK.json",
    output: "../src/abi/RIK.json",
  },
  {
    artifact: "../../../contracts/out/FCFWrapper.sol/FCFWrapper.json",
    output: "../src/abi/FCFWrapper.json",
  },
];

const abiDir = new URL("../src/abi", import.meta.url);
mkdirSync(abiDir, { recursive: true });

for (const { artifact, output } of abis) {
  const artifactUrl = new URL(artifact, import.meta.url);
  const abiUrl = new URL(output, import.meta.url);
  const artifactJson = JSON.parse(readFileSync(artifactUrl, "utf8"));
  if (!Array.isArray(artifactJson.abi)) {
    throw Error(`${artifact} does not contain an abi array`);
  }

  writeFileSync(abiUrl, `${JSON.stringify(artifactJson.abi, null, 2)}\n`);
}
