function b64urlDecode(s: string): Buffer {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return Buffer.from(s, "base64");
}

export type JwtParts = {
    headerB64: string; payloadB64: string; signatureB64: string;
    payload: any;
}

export function parseJwt(jwt: string): JwtParts {
    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    if (!payloadB64 || !headerB64 || !signatureB64) throw Error("Failed to decode jwt");
    const payload = JSON.parse(b64urlDecode(payloadB64).toString("utf-8"));
    return { headerB64, payloadB64, signatureB64, payload };
}