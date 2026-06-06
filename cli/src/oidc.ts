import { keccak256 } from "viem";

function b64urlDecode(s: string): Buffer {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64");
}

export function b64urlToHex(s: string): `0x${string}` {
    return `0x${b64urlDecode(s).toString("hex")}`;
}

export function jwtKid(kid: string): `0x${string}` {
    return keccak256(Buffer.from(kid, "utf8"));
}

export type JwtParts = {
    headerB64: string; payloadB64: string; signatureB64: string;
    header: any;
    payload: any;
}

export function parseJwt(jwt: string): JwtParts {
    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    if (!payloadB64 || !headerB64 || !signatureB64) throw Error("Failed to decode jwt");
    const header = JSON.parse(b64urlDecode(headerB64).toString("utf-8"));
    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf-8"));
    return { headerB64, payloadB64, signatureB64, header, payload };
}
