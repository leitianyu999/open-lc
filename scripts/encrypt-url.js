import crypto from "node:crypto";

function base64url(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function deriveKey(secret) {
  // 必须和 Worker 一致：SHA-256(secret) => AES-256 key
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptPayload(payload, secret, aadText) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  if (aadText) {
    cipher.setAAD(Buffer.from(aadText, "utf8"));
  }

  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");

  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // 格式：iv + ciphertext + tag
  return base64url(Buffer.concat([iv, ciphertext, tag]));
}

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

const rawUrl = process.argv[2];

if (!rawUrl) {
  console.error('Usage: bun encrypt-url.js "https://example.com/file?token=..."');
  process.exit(1);
}

const secret = process.env.URL_ENCRYPTION_KEY;

if (!secret) {
  console.error("Missing env: URL_ENCRYPTION_KEY");
  console.error("Example:");
  console.error('URL_ENCRYPTION_KEY="your-long-random-secret" bun encrypt-url.js "https://..."');
  process.exit(1);
}

const publicBaseUrl = process.env.PUBLIC_BASE_URL || "https://dl.example.com";

const ttlSeconds = Number(process.env.TTL_SECONDS || 3600);

const version = "v1";
const keyId = "k1";
const aad = `${version}.${keyId}`;

const payload = {
  url: rawUrl,
  exp: Math.floor(Date.now() / 1000) + ttlSeconds,

  // 可选字段：Worker 会用它设置 Content-Disposition
  filename: guessFilenameFromUrl(rawUrl),

  // 可选字段：如果上游没给 Content-Type，Worker 可以兜底
  contentType: rawUrl.toLowerCase().includes(".mp4") ? "video/mp4" : undefined,
};

const token = encryptPayload(payload, secret, aad);

const shareUrl = `${publicBaseUrl.replace(/\/+$/, "")}/lc/${version}.${keyId}.${token}`;

console.log(shareUrl);
