#!/usr/bin/env bun
// scripts/encrypt-url.js
//
// 用法示例：
//
// 1. 旧版 v1，对称加密，保持原行为：
//    URL_ENCRYPTION_KEY="your-secret" \
//    PUBLIC_BASE_URL="https://dl.example.com" \
//    bun scripts/encrypt-url.js "https://pcs.baidu.com/file..."
//
// 2. 新版 v2，自动从 Worker 获取公钥：
//    ENCRYPTION_VERSION=v2 \
//    PUBLIC_BASE_URL="https://dl.example.com" \
//    bun scripts/encrypt-url.js "https://pcs.baidu.com/file..."
//
// 3. 新版 v2，手动指定公钥：
//    ENCRYPTION_VERSION=v2 \
//    V2_PUBLIC_KEY="base64url-public-key" \
//    PUBLIC_BASE_URL="https://dl.example.com" \
//    bun scripts/encrypt-url.js "https://pcs.baidu.com/file..."
//
// 4. 命令行参数形式：
//    bun scripts/encrypt-url.js --v2 --base-url https://dl.example.com "https://pcs.baidu.com/file..."
//
// 环境变量：
//   PUBLIC_BASE_URL       生成分享链接的 Worker 域名，默认 https://dl.example.com
//   TTL_SECONDS           token 有效期，默认 3600 秒
//
// v1 需要：
//   URL_ENCRYPTION_KEY    和 Worker 里的 URL_ENCRYPTION_KEY 一致
//
// v2 可选：
//   V2_PUBLIC_KEY         Worker /lc/v2.auto 返回的 publicKey
//   V2_KEY_URL            公钥发现地址，默认 `${PUBLIC_BASE_URL}/lc/v2.auto`

import crypto from "node:crypto";

const DEFAULT_PUBLIC_BASE_URL = "https://dl.example.com";
const DEFAULT_TTL_SECONDS = 3600;

const V1_VERSION = "v1";
const V1_KID = "k1";

const V2_VERSION = "v2";
const V2_KID = "x1";
const V2_AAD = "v2.x1";
const V2_AES_INFO = "open-lc:v2:aes-gcm:v2.x1";
const V2_AES_SALT = "open-lc:v2:aes-gcm:salt";

// X25519 base point: u = 9
const X25519_BASE_POINT = new Uint8Array(32);
X25519_BASE_POINT[0] = 9;

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.rawUrl) {
    printUsageAndExit();
  }

  const publicBaseUrl = stripTrailingSlash(
    options.publicBaseUrl ||
      process.env.PUBLIC_BASE_URL ||
      DEFAULT_PUBLIC_BASE_URL,
  );

  const ttlSeconds = parsePositiveInteger(
    options.ttlSeconds || process.env.TTL_SECONDS,
    DEFAULT_TTL_SECONDS,
  );

  const version =
    options.version ||
    process.env.ENCRYPTION_VERSION ||
    process.env.LC_ENCRYPTION_VERSION ||
    V1_VERSION;

  const payload = buildPayload({
    rawUrl: options.rawUrl,
    ttlSeconds,
    filename: options.filename,
    contentType: options.contentType,
  });

  if (version === V1_VERSION) {
    const shareUrl = encryptV1ShareUrl({
      payload,
      publicBaseUrl,
      secret: process.env.URL_ENCRYPTION_KEY,
    });

    console.log(shareUrl);
    return;
  }

  if (version === V2_VERSION) {
    const shareUrl = await encryptV2ShareUrl({
      payload,
      publicBaseUrl,
      publicKeyText: options.publicKey || process.env.V2_PUBLIC_KEY,
      keyUrl: options.keyUrl || process.env.V2_KEY_URL,
    });

    console.log(shareUrl);
    return;
  }

  throw new Error(`Unsupported encryption version: ${version}`);
}

/**
 * 构造 payload。
 *
 * v1/v2 解密后都使用同一种 payload 结构。
 */
function buildPayload({ rawUrl, ttlSeconds, filename, contentType }) {
  return removeUndefinedFields({
    url: rawUrl,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,

    // 可选字段：Worker 会用它设置 Content-Disposition。
    filename: filename || guessFilenameFromUrl(rawUrl),

    // 可选字段：如果上游没给 Content-Type，Worker 可以兜底。
    contentType: contentType || guessContentTypeFromUrl(rawUrl),
  });
}

/**
 * v1：旧版对称加密。
 *
 * 必须和 Worker v1 保持一致：
 *   SHA-256(URL_ENCRYPTION_KEY) -> AES-256-GCM key
 *
 * token:
 *   base64url(nonce[12] || ciphertext || tag[16])
 *
 * link:
 *   /lc/v1.k1.<token>
 */
function encryptV1ShareUrl({ payload, publicBaseUrl, secret }) {
  if (!secret) {
    throw new Error(
      [
        "Missing env: URL_ENCRYPTION_KEY",
        "",
        "Example:",
        '  URL_ENCRYPTION_KEY="your-long-random-secret" bun scripts/encrypt-url.js "https://..."',
      ].join("\n"),
    );
  }

  const aad = `${V1_VERSION}.${V1_KID}`;
  const token = encryptV1Payload(payload, secret, aad);

  return `${publicBaseUrl}/lc/${V1_VERSION}.${V1_KID}.${token}`;
}

function encryptV1Payload(payload, secret, aadText) {
  const key = crypto.createHash("sha256").update(secret, "utf8").digest();

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);

  cipher.setAAD(Buffer.from(aadText, "utf8"));

  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return bytesToBase64url(Buffer.concat([nonce, ciphertext, tag]));
}

/**
 * v2：新版非对称加密。
 *
 * 客户端只需要 Worker 公钥：
 *   publicKey = /lc/v2.auto 返回的 publicKey
 *
 * 加密流程：
 *   1. 客户端生成一次性 X25519 ephemeral private key
 *   2. ephemeralPublicKey = X25519(ephemeralPrivateKey, basePoint)
 *   3. sharedSecret = X25519(ephemeralPrivateKey, workerPublicKey)
 *   4. AES key = HKDF-SHA256(sharedSecret, info="open-lc:v2:aes-gcm:v2.x1")
 *   5. AES-256-GCM 加密 payload
 *
 * token:
 *   base64url(ephemeralPublicKey[32] || nonce[12] || ciphertext || tag[16])
 *
 * link:
 *   /lc/v2.x1.<token>
 */
async function encryptV2ShareUrl({
  payload,
  publicBaseUrl,
  publicKeyText,
  keyUrl,
}) {
  const keyInfo = await resolveV2PublicKey({
    publicBaseUrl,
    publicKeyText,
    keyUrl,
  });

  const token = encryptV2Payload(payload, keyInfo.publicKey);
  const tokenPrefix = keyInfo.tokenPrefix || `${publicBaseUrl}/lc/v2.x1.`;

  return `${stripTrailingDots(tokenPrefix)}${token}`;
}

async function resolveV2PublicKey({ publicBaseUrl, publicKeyText, keyUrl }) {
  if (publicKeyText) {
    return {
      publicKey: base64urlToBytes(publicKeyText),
      tokenPrefix: `${publicBaseUrl}/lc/v2.x1.`,
    };
  }

  const discoveryUrl = keyUrl || `${publicBaseUrl}/lc/v2.auto`;

  const response = await fetch(discoveryUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch v2 public key from ${discoveryUrl}: HTTP ${response.status}`,
    );
  }

  const data = await response.json();

  if (!data || data.version !== V2_VERSION || data.kid !== V2_KID) {
    throw new Error("Invalid v2 key discovery response.");
  }

  if (!data.publicKey || typeof data.publicKey !== "string") {
    throw new Error("Invalid v2 key discovery response: missing publicKey.");
  }

  return {
    publicKey: base64urlToBytes(data.publicKey),
    tokenPrefix: data.tokenPrefix || `${publicBaseUrl}/lc/v2.x1.`,
  };
}

function encryptV2Payload(payload, receiverPublicKey) {
  if (!(receiverPublicKey instanceof Uint8Array) || receiverPublicKey.length !== 32) {
    throw new Error("Invalid v2 public key. Expected 32 raw bytes.");
  }

  const ephemeralPrivateKey = crypto.randomBytes(32);
  const ephemeralPublicKey = x25519(ephemeralPrivateKey, X25519_BASE_POINT);

  const sharedSecret = x25519(ephemeralPrivateKey, receiverPublicKey);

  const aesKey = hkdfSha256({
    inputKeyMaterial: sharedSecret,
    salt: Buffer.from(V2_AES_SALT, "utf8"),
    info: Buffer.from(V2_AES_INFO, "utf8"),
    lengthBytes: 32,
  });

  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, nonce);

  cipher.setAAD(Buffer.from(V2_AAD, "utf8"));

  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return bytesToBase64url(
    Buffer.concat([
      Buffer.from(ephemeralPublicKey),
      nonce,
      ciphertext,
      tag,
    ]),
  );
}

/**
 * HKDF-SHA256。
 *
 * 这里不用 crypto.hkdfSync，是为了在 Node/Bun 之间表现更稳定，
 * 同时也更清楚地对应 Worker 里的 HKDF 参数：
 *   salt
 *   info
 *   lengthBytes
 */
function hkdfSha256({ inputKeyMaterial, salt, info, lengthBytes }) {
  const ikm = Buffer.from(inputKeyMaterial);
  const prk = crypto.createHmac("sha256", salt).update(ikm).digest();

  const blocks = [];
  let previous = Buffer.alloc(0);
  let counter = 1;

  while (Buffer.concat(blocks).length < lengthBytes) {
    const hmac = crypto.createHmac("sha256", prk);
    hmac.update(previous);
    hmac.update(info);
    hmac.update(Buffer.from([counter]));

    previous = hmac.digest();
    blocks.push(previous);
    counter += 1;

    if (counter > 255) {
      throw new Error("HKDF output is too long.");
    }
  }

  return Buffer.concat(blocks).subarray(0, lengthBytes);
}

/**
 * 内置 X25519。
 *
 * 用途：
 *   1. v2 客户端生成 ephemeralPublicKey
 *   2. v2 客户端计算 sharedSecret
 *
 * 不依赖外部库。
 * 实现的是 RFC 7748 Montgomery ladder 的核心流程。
 */
function x25519(scalarBytes, uBytes) {
  const p = (1n << 255n) - 19n;

  const kBytes = new Uint8Array(scalarBytes);

  // X25519 scalar clamping
  kBytes[0] &= 248;
  kBytes[31] &= 127;
  kBytes[31] |= 64;

  const k = decodeLittleEndian(kBytes);
  const u = decodeLittleEndian(uBytes);

  let x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254; t >= 0; t--) {
    const kt = (k >> BigInt(t)) & 1n;
    swap ^= kt;

    if (swap === 1n) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }

    swap = kt;

    const a = mod(x2 + z2, p);
    const aa = mod(a * a, p);
    const b = mod(x2 - z2, p);
    const bb = mod(b * b, p);
    const e = mod(aa - bb, p);
    const c = mod(x3 + z3, p);
    const d = mod(x3 - z3, p);
    const da = mod(d * a, p);
    const cb = mod(c * b, p);

    x3 = mod((da + cb) * (da + cb), p);
    z3 = mod(x1 * mod((da - cb) * (da - cb), p), p);
    x2 = mod(aa * bb, p);
    z2 = mod(e * mod(aa + 121665n * e, p), p);
  }

  if (swap === 1n) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }

  const result = mod(x2 * modPow(z2, p - 2n, p), p);
  return encodeLittleEndian(result, 32);
}

function mod(a, p) {
  const r = a % p;
  return r >= 0n ? r : r + p;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = mod(base, modulus);
  let e = exponent;

  while (e > 0n) {
    if (e & 1n) {
      result = mod(result * b, modulus);
    }

    b = mod(b * b, modulus);
    e >>= 1n;
  }

  return result;
}

function decodeLittleEndian(bytes) {
  let n = 0n;

  for (let i = bytes.length - 1; i >= 0; i--) {
    n = (n << 8n) + BigInt(bytes[i]);
  }

  return n;
}

function encodeLittleEndian(num, length) {
  const out = new Uint8Array(length);
  let n = num;

  for (let i = 0; i < length; i++) {
    out[i] = Number(n & 255n);
    n >>= 8n;
  }

  return out;
}

/**
 * 参数解析。
 */
function parseArgs(args) {
  const options = {
    rawUrl: undefined,
    version: undefined,
    publicBaseUrl: undefined,
    ttlSeconds: undefined,
    publicKey: undefined,
    keyUrl: undefined,
    filename: undefined,
    contentType: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    }

    if (arg === "--v1") {
      options.version = V1_VERSION;
      continue;
    }

    if (arg === "--v2") {
      options.version = V2_VERSION;
      continue;
    }

    if (arg === "--version") {
      options.version = requireValue(args, ++i, "--version");
      continue;
    }

    if (arg === "--base-url") {
      options.publicBaseUrl = requireValue(args, ++i, "--base-url");
      continue;
    }

    if (arg === "--ttl") {
      options.ttlSeconds = requireValue(args, ++i, "--ttl");
      continue;
    }

    if (arg === "--public-key") {
      options.publicKey = requireValue(args, ++i, "--public-key");
      continue;
    }

    if (arg === "--key-url") {
      options.keyUrl = requireValue(args, ++i, "--key-url");
      continue;
    }

    if (arg === "--filename") {
      options.filename = requireValue(args, ++i, "--filename");
      continue;
    }

    if (arg === "--content-type") {
      options.contentType = requireValue(args, ++i, "--content-type");
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (!options.rawUrl) {
      options.rawUrl = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return options;
}

function requireValue(args, index, flag) {
  const value = args[index];

  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function printUsageAndExit(code = 1) {
  const text = `
Usage:
  bun scripts/encrypt-url.js [options] "https://example.com/file?token=..."

Options:
  --v1                       Use legacy v1 symmetric encryption. Default.
  --v2                       Use v2 X25519 public-key encryption.
  --version v1|v2            Same as --v1 or --v2.
  --base-url <url>           Worker public base URL.
  --ttl <seconds>            Token TTL. Default: 3600.
  --public-key <key>         v2 public key, base64url raw 32-byte key.
  --key-url <url>            v2 key discovery URL. Default: PUBLIC_BASE_URL/lc/v2.auto.
  --filename <name>          Override filename.
  --content-type <type>      Override content type.
  -h, --help                 Show help.

Examples:
  URL_ENCRYPTION_KEY="secret" \\
  PUBLIC_BASE_URL="https://dl.example.com" \\
  bun scripts/encrypt-url.js --v1 "https://pcs.baidu.com/file..."

  PUBLIC_BASE_URL="https://dl.example.com" \\
  bun scripts/encrypt-url.js --v2 "https://pcs.baidu.com/file..."
`.trim();

  console.error(text);
  process.exit(code);
}

/**
 * URL / payload 辅助函数。
 */
function guessFilenameFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    const pathParam = url.searchParams.get("path");
    if (pathParam) {
      const decodedPath = decodeURIComponent(pathParam);
      const parts = decodedPath.split("/");
      return parts[parts.length - 1] || undefined;
    }

    const pathname = decodeURIComponent(url.pathname);
    const parts = pathname.split("/");
    return parts[parts.length - 1] || undefined;
  } catch {
    return undefined;
  }
}

function guessContentTypeFromUrl(rawUrl) {
  const lower = rawUrl.toLowerCase();

  if (lower.includes(".mp4")) return "video/mp4";
  if (lower.includes(".m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.includes(".json")) return "application/json";
  if (lower.includes(".txt")) return "text/plain";
  if (lower.includes(".pdf")) return "application/pdf";
  if (lower.includes(".zip")) return "application/zip";

  return undefined;
}

function removeUndefinedFields(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function parsePositiveInteger(value, fallback) {
  const n = Number(value);

  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }

  return Math.floor(n);
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function stripTrailingDots(value) {
  return String(value).replace(/\.*$/, ".");
}

/**
 * base64url no padding -> Uint8Array
 */
function base64urlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  return new Uint8Array(Buffer.from(base64 + pad, "base64"));
}

/**
 * Uint8Array / Buffer -> base64url no padding
 */
function bytesToBase64url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}