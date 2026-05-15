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
    mac: {
      icons: 'icon.iconset',
    },
    win: {
      icon: 'icon.png',
    },
    linux: {
      icon: 'icon.png',
    },
  },
} satisfies ElectrobunConfig
