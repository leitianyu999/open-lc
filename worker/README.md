# Open LC Worker

This directory is an independent Cloudflare Worker project for the Open LC download proxy.

The Worker source is generated during the Open LC export from the monorepo script:

```txt
scripts/worker.js -> worker/src/index.js
```

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LeUKi/open-lc/tree/main/worker)

After deployment, set the `URL_ENCRYPTION_KEY` secret in Cloudflare Dashboard. Otherwise, the Worker cannot decrypt generated links.

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

The value must match the Worker encryption key configured in LC Agent. Do not commit this secret to the repository.

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

For local development, create a `.dev.vars` file in this directory:

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
