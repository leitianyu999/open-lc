# Open LC Worker

This directory is an independent Cloudflare Worker project for the Open LC download proxy.

The Worker source is generated during the Open LC export from the monorepo script:

```txt
scripts/worker.js -> worker/src/index.js
```

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LeUKi/open-lc/tree/main/worker)

The Worker supports two encrypted link modes:

- `v2` public-key discovery, recommended for new setups. The Worker keeps the encryption root, and LC Agent only stores one or more Worker proxy endpoints.
- `v1` shared secret, kept for compatibility. LC Agent and the Worker must use the same encryption key.

The Worker declares `URL_ENCRYPTION_KEY` as a required secret in `wrangler.jsonc`. Set it in Cloudflare Dashboard before using the Worker.

```txt
Workers & Pages
-> Select your deployed Worker
-> Settings
-> Variables and Secrets
-> Add
-> Secret
```

```txt
Name: URL_ENCRYPTION_KEY
Value: your encryption key
```

In LC Agent Settings:

- For `v2`, choose `v2 公钥发现` and enter the Worker proxy endpoint. Multiple endpoints are supported, one per line. LC Agent validates each endpoint through `/lc/v2.auto` and does not store the Worker secret.
- For `v1`, choose `v1 共享密钥`; the Agent-side Worker encryption key must match `URL_ENCRYPTION_KEY`.

`ALLOWED_HOSTS` defaults to `*`. To restrict upstream hosts, set `ALLOWED_HOSTS` in Worker Variables to a comma-separated host list.

Do not commit this secret to the repository.

To verify v2 discovery, open:

```txt
https://your-worker.example.com/lc/v2.auto
```

It should return JSON containing `version: "v2"`, `kid: "x1"`, and `publicKey`.

## Manual Deploy

```sh
npm install
npx wrangler secret put URL_ENCRYPTION_KEY
npm run deploy
```

## Local Development

```sh
npm install
npm run dev
```

For local development, create a `.dev.vars` file in this directory. This value is the local Worker's encryption root for both v1 and v2:

```txt
URL_ENCRYPTION_KEY=your-local-key
```

Do not commit `.dev.vars`.

## Git Deployment

When connecting this repository to Cloudflare Git deployment, set the project root directory to:

```txt
worker
```

This keeps Worker deployment dependencies isolated from the rest of the Open LC repository.
