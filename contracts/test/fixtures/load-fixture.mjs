import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const TEST_RSA_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCN8nAo79olM8K+
SLbu/Oz0EwBgPdY+KxfAuAdbDF4EHpcViRUv50bzQT0pw/b1iiTC/qu4dziFx97Y
t0+5vDiEjxzYMZRH8WxtEFBHeXGpM47DAG6rMAYoXhMhnoVTEkz/3r2802OYSino
sI2Mxpje7vmnI2SefbOAkiOemxvYM/XGeH/Cb6W8i8+pTjZYRZbjDd8Lr2XzUZEj
j0ep1NYeBbmQZ/r4BtXuXU75xD9I7/+ar4qEGr92Oj9+9yqsxaRLNjtA84AMMkPg
b+gHnZn0wnQwVMXS5TF7+WhUt4Pkuv+DllkGewkqztugOoQCU4kivbiYhk4RBMqo
4se2H44VAgMBAAECggEAM65CQdVaElNvIwKsgATcbN0CNQgumcHsywD1xKOTE2Lj
1TZs3V0SSvzEvREZODrMuaYpdWcK0EJ+E19iiphJ55GHifs7JppyxJ6869j+lgEs
iDj/EhrREx91Tbc+iYlPOZWqdTZtu4O9EHg/gTLJc9mEUeMj/kR792K9z0Bf+e4e
R9qFE5pi2i6JueqrubKitDwSwHG3ZMHQU3HLLEF3O3szdUphoiXfga08xFGJlRIS
0L21N4CRG5gw8W2/0ZorzZcntuFztJgOSemofPDcFQC1qXnqbVdzA4da2gRr/3JD
aIAwC+AXLGg4OBOdFCec5HSb6yW7KKU3qKu83f0l3QKBgQDCB5Zk91Zpv6E+9NQo
EE35ZGiIUx/C9lp3Oi8aoDLizmkNKM87yU110ZdB22qomsgsvHIXMEhZof7xkNbG
giaE9ByBCyLaNofA0Z7lZLGs0F4t3CW6H7kTwPrzQ3sin3loaptnn2UlvAE6ssO4
T4FRaVuaIQN42r1bnA9eZYGMuwKBgQC7SG265eIoks3gnnT+4Z8OK4V+7UyCHuix
COgHNRPSGxx/QKne7GHq/amwtJUG+N/o5Xc0QCMHZzENecEmJnV6xg7o05SPaTNO
MoiAMG5H88Vfvk6RZkUDjWn/rfLVdwN7lKqOkXk505icYtmFPrTlNUurm1wZPUUq
r/a5jv6LbwKBgGSK2fvnzvdtPXkKFQXNrRoWVbSOnl7AmZA+rjn12Wh93SHci8ZH
QcRTnzWZJWPJEQFdhSFO+662qw0yKJkkyCEM/dhAlQbOSvo3pUbpLsiGEMdi1Inl
9lmuHlwAE8aVLKxW0cCYcCllip2IFLNlP3WYSsdLZCkz7/uQmsYng0IRAoGBAKd/
0dQUgj7zfXplfhHvzIep2Q16QrEl38tmQc8gY4fIg6Y0OTmNhM3c7QWDnL3NnMT5
ZbGvoySd4DtDJ8JtJykVNoR5pybUWfSYMYkkx51GosJMvIxCQXs54RGxi7vrY4wF
nL1B0oArhRRpPE51lOhi0Di9DJPuPow9MJcpEvO1AoGAbMzqkcS8DWi/+Au7VaWU
psaokuxFg/HS48h+5Z6YvbrYXsVpeJJB5qwu/xD87SXFeyIjdYf+jEKsyjagnX7t
qbO/aPxqAc88n99z57EKjB73Hk2+Yrg6jk97fW4RYf2AjQzTWZF9Ak5SI0ZUzmCS
nKG27ed/zJnymS277DA7Jcc=
-----END PRIVATE KEY-----`;

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function b64urlToHex(value) {
  return `0x${Buffer.from(value, "base64url").toString("hex")}`;
}

function bytes32Ascii(value) {
  return `0x${Buffer.concat([Buffer.from(value), Buffer.alloc(32)]).subarray(0, 32).toString("hex")}`;
}

const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const repoId = process.argv[3] ?? fixture.repoId;
const ownerId = process.argv[4] ?? fixture.ownerId;
const recipient = (process.argv[5] ?? fixture.recipient).toLowerCase();
const exp = fixture.exp ?? 4102444800;
const nbf = fixture.nbf ?? 0;
const kid = fixture.kid ?? bytes32Ascii(fixture.kidText);
const kidText = fixture.kidText ?? "kid-001";

const privateKey = createPrivateKey(TEST_RSA_PRIVATE_KEY);
const publicJwk = createPublicKey(privateKey).export({ format: "jwk" });

const headerB64 = b64url({ alg: "RS256", typ: "JWT", kid: kidText });
const payloadB64 = b64url({
  aud: recipient,
  repository_id: String(repoId),
  repository_owner_id: String(ownerId),
  exp,
  nbf,
});
const signature = sign("RSA-SHA256", Buffer.from(`${headerB64}.${payloadB64}`), privateKey);

const output = JSON.stringify({
  kid,
  headerB64,
  payloadB64,
  signature: `0x${signature.toString("hex")}`,
  modulus: b64urlToHex(publicJwk.n),
  exponent: b64urlToHex(publicJwk.e),
  recipient,
  repoId: Number(repoId),
  ownerId: Number(ownerId),
  exp,
  nbf,
});

process.stdout.write(`0x${Buffer.from(output).toString("hex")}`);
