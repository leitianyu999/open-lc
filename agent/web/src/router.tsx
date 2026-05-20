import { createHashHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from './components/AppShell'
import { HomePage } from './pages/HomePage'
import { HistoryPage } from './pages/HistoryPage'
import { MyAccountsPage } from './pages/MyAccountsPage'
import { BrokerPage } from './pages/BrokerPage'
import { BrokerRunDetailPage } from './pages/BrokerRunDetailPage'
import { SettingsPage } from './pages/SettingsPage'

const rootRoute = createRootRoute({
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const localHistoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  component: HistoryPage,
})

const localAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts',
  component: MyAccountsPage,
})

const brokerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/broker',
  component: BrokerPage,
})

const brokerRunDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/broker/runs/$runId',
  component: BrokerRunDetailPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([indexRoute, localHistoryRoute, localAccountsRoute, brokerRoute, brokerRunDetailRoute, settingsRoute])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
