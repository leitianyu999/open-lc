import type { ElectrobunConfig } from 'electrobun'

export default {
  app: {
    name: 'LC Agent',
    identifier: 'dev.lc.agent',
    version: '0.0.0',
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: 'src/index.ts',
    },
    copy: {
      '../web/dist': 'web/dist',
      '../drizzle': 'drizzle',
    },
  },
} satisfies ElectrobunConfig
