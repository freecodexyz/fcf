import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const RIK_CONTRACT_ADDRESS = "0xc03a52cD0EB2d5d456e64bda0557Db04608d1eac" as `0x${string}`;

export type Config = Record<string, unknown>;

let config: Config | undefined;

export function getConfig(): Config {
    if (!config) config = readConfig();
    return config;
}

export function readConfig(): Config {
    try {
        const value = JSON.parse(readFileSync(configFilePath(), "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid config file");
        return value as Config;
    } catch (err: any) {
        if (err?.code === "ENOENT") return initNewConfig();
        throw err;
    }
}

function initNewConfig(): Config {
    // define initial config shape and data
    const stub = {
        rikContractAddress: RIK_CONTRACT_ADDRESS,
        fcfWrapperAddress: "0xf696da98df236a36536e9385dAf05D196579612B"
    };
    writeConfig(stub);
    return stub;
}

export function writeConfig(value: Config): void {
    const filePath = configFilePath();
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

    const tmpPath = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmpPath, filePath);
    chmodSync(filePath, 0o600);
    config = value;
}

function configFilePath(): string {
    if (process.env.FCF_CONFIG_HOME) return join(resolve(process.env.FCF_CONFIG_HOME), "config.json");
    if (process.env.XDG_CONFIG_HOME) return join(resolve(process.env.XDG_CONFIG_HOME), "fcf", "config.json");
    return join(homedir(), ".config", "fcf", "config.json");
}
