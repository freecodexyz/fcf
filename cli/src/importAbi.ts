import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Abi } from "viem";

const CONTRACT_NAME = "RIK";

function checkPathExists(path: string): boolean {
  if (!path.trim()) return false;

  try {
    accessSync(resolve(path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function importAbi(): Abi {
    const abiPath = `../contracts/out/${CONTRACT_NAME}.sol/${CONTRACT_NAME}.json`;
    if (!checkPathExists(abiPath)) throw Error("ABI JSON file not found");

    const raw: string = readFileSync(abiPath, { encoding: "utf-8" });
    const abi: Abi = [JSON.parse(raw)] as const;
    return abi;
}