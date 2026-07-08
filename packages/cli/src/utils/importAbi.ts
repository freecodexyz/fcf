import { accessSync, constants, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";
import staticAbi from "../abi/RIK.json" with { type: "json" };

const CONTRACT_NAME = "RIK";
const ABI_PATH = fileURLToPath(new URL(`../../../../contracts/out/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`, import.meta.url));

function checkPathExists(path: string): boolean {
  if (!path.trim()) return false;

  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function importAbi(): Abi {
    if (!process.env.SKIP_STATIC_ABI) return staticAbi as Abi;
    if (!checkPathExists(ABI_PATH)) throw Error("ABI JSON file not found");

    const raw: string = readFileSync(ABI_PATH, { encoding: "utf-8" });
    const artifact = JSON.parse(raw) as { abi?: unknown };
    if (!Array.isArray(artifact.abi)) throw Error("ABI JSON file does not contain an abi array");

    return artifact.abi as Abi;
}
