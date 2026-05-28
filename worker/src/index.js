function base64urlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + pad);

  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function importAesKeyFromSecret(secret) {
  // 必须和 Bun 脚本一致：
  // SHA-256(secret) => 32 字节 AES-256 key
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );

  return crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
}

async function decryptToken(token, secret, aadText) {
  const raw = base64urlToBytes(token);

  // AES-GCM:
  // 前 12 字节 IV
  // 后面 ciphertext + 16 字节 auth tag
  if (raw.length < 12 + 16) {
    throw new Error("Token too short");
  }

  const iv = raw.slice(0, 12);
  const ciphertextAndTag = raw.slice(12);

  const key = await importAesKeyFromSecret(secret);

  const decryptOptions = {
    name: "AES-GCM",
    iv,
  };

  // AAD 必须和 Bun 脚本里一致
  if (aadText) {
    decryptOptions.additionalData = new TextEncoder().encode(aadText);
  }

  const plaintext = await crypto.subtle.decrypt(
    decryptOptions,
    key,
    ciphertextAndTag
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

function getTokenInfoFromPath(pathname) {
  // 支持：
  // /lc/v1.k1.<token>
  const prefix = "/lc/";

  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const tokenWithMeta = pathname.slice(prefix.length);
  const parts = tokenWithMeta.split(".");

  if (parts.length !== 3) {
    return null;
  }

  const [version, keyId, token] = parts;

  if (!version || !keyId || !token) {
    return null;
  }

  return {
    version,
    keyId,
    token,
  };
}

function copyRequestHeadersForUpstream(request) {
  const headers = new Headers();

  // 支持断点续传、视频拖动、下载器分片下载
  const range = request.headers.get("Range");
  if (range) {
    headers.set("Range", range);
  }

  const ifRange = request.headers.get("If-Range");
  if (ifRange) {
    headers.set("If-Range", ifRange);
  }

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch) {
    headers.set("If-None-Match", ifNoneMatch);
  }

  const ifModifiedSince = request.headers.get("If-Modified-Since");
  if (ifModifiedSince) {
    headers.set("If-Modified-Since", ifModifiedSince);
  }

  return headers;
}

function sanitizeFilename(filename) {
  return String(filename || "download")
    .replace(/["\r\n]/g, "_")
    .replace(/[\\/:*?<>|]/g, "_");
}

function getFilenameFromPayloadOrUrl(payload) {
  if (payload.filename) {
    return sanitizeFilename(payload.filename);
  }

  try {
    const upstreamUrl = new URL(payload.url);

    const pathParam = upstreamUrl.searchParams.get("path");
    if (pathParam) {
      const decodedPath = decodeURIComponent(pathParam);
      const parts = decodedPath.split("/");
      const name = parts[parts.length - 1];

      if (name) {
        return sanitizeFilename(name);
      }
    }

    const pathname = decodeURIComponent(upstreamUrl.pathname);
    const parts = pathname.split("/");
    const name = parts[parts.length - 1];

    if (name) {
      return sanitizeFilename(name);
    }
  } catch {
    // ignore
  }

  return "download";
}

function cleanResponseHeaders(upstreamHeaders, payload, requestUrl) {
  const headers = new Headers(upstreamHeaders);

  // 不暴露上游细节
  headers.delete("Set-Cookie");
  headers.delete("Server");
  headers.delete("X-Powered-By");

  // 避免上游缓存策略影响你的下载入口，可按需调整
  // 如果你想让浏览器缓存，可以删掉下面两行
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");

  const filename = getFilenameFromPayloadOrUrl(payload);

  // 默认 inline 播放；加 ?download=1 强制下载
  const disposition =
    requestUrl.searchParams.get("download") === "1"
      ? "attachment"
      : "inline";

  headers.set(
    "Content-Disposition",
    `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`
  );

  // 如果上游没有 Content-Type，则用 payload.contentType 兜底
  if (payload.contentType && !headers.get("Content-Type")) {
    headers.set("Content-Type", payload.contentType);
  }

  return headers;
}

function isAllowedUpstreamUrl(upstreamUrl) {
  // 只允许 http/https
  if (upstreamUrl.protocol !== "https:" && upstreamUrl.protocol !== "http:") {
    return false;
  }

  // 可选：限制只能代理百度 PCS，防止这个 Worker 变成通用开放代理
  // 如果你确实需要代理其他域名，可以把这个判断删掉
  const allowedHosts = new Set([
    "pcs.baidu.com",
  ]);

  return allowedHosts.has(upstreamUrl.hostname);
}

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse("Method Not Allowed", 405);
    }

    const requestUrl = new URL(request.url);
    const tokenInfo = getTokenInfoFromPath(requestUrl.pathname);

    if (!tokenInfo) {
      return errorResponse("Usage: /lc/v1.k1.<encrypted-token>", 400);
    }

    const { version, keyId, token } = tokenInfo;

    if (version !== "v1") {
      return errorResponse("Unsupported token version", 400);
    }

    if (keyId !== "k1") {
      return errorResponse("Unsupported key id", 400);
    }

    if (!env.URL_ENCRYPTION_KEY) {
      return errorResponse("Missing URL_ENCRYPTION_KEY", 500);
    }

    let payload;

    try {
      // 必须和 Bun 加密脚本里的 AAD 一致
      const aad = `${version}.${keyId}`;
      payload = await decryptToken(token, env.URL_ENCRYPTION_KEY, aad);
    } catch {
      return errorResponse("Invalid token", 403);
    }

    if (!payload || !payload.url) {
      return errorResponse("Invalid payload: missing url", 400);
    }

    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && Number(payload.exp) < now) {
      return errorResponse("Link expired", 403);
    }

    let upstreamUrl;

    try {
      upstreamUrl = new URL(payload.url);
    } catch {
      return errorResponse("Invalid upstream url", 400);
    }

    if (!isAllowedUpstreamUrl(upstreamUrl)) {
      return errorResponse("Upstream host not allowed", 403);
    }

    const upstreamHeaders = copyRequestHeadersForUpstream(request);

    let upstream;

    try {
      upstream = await fetch(upstreamUrl.toString(), {
        method: request.method,
        headers: upstreamHeaders,
        redirect: "follow",
      });
    } catch {
      return errorResponse("Upstream fetch failed", 502);
    }

    const responseHeaders = cleanResponseHeaders(
      upstream.headers,
      payload,
      requestUrl
    );

    // 关键：
    // 直接返回 upstream.body，保持流式代理。
    // 不要 arrayBuffer()，不要 text()，不要 json()。
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
