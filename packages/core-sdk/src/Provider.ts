import { Agent as HttpsAgent } from "node:https";
import { URL } from "node:url";

export interface Provider {
    readonly identifier: string;
}

export type HttpsProviderConfig = {
    baseUrl: URL
};

export interface HttpsProvider extends Provider {
    readonly config: HttpsProviderConfig;
    readonly baseUrl: URL;
    readonly httpsAgent: HttpsAgent;
}