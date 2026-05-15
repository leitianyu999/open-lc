import { badRequest } from '../lib/errors'
import { getSettingBoolean, setSetting } from '../settings/service'

export type DesktopSwitchResult = {
  ok: boolean
  error?: string
}

export type DesktopRuntimeSnapshot = {
  desktopMode: boolean
  externalAccessEnabled: boolean
  restartPending: boolean
  lastSwitchError: string | null
  bindHost: string | null
  port: number | null
  localUrl: string | null
  externalUrls: string[]
  primaryExternalUrl: string | null
}

export type DesktopController = {
  getRuntime: () => DesktopRuntimeSnapshot
  setExternalAccess: (enabled: boolean) => DesktopSwitchResult | Promise<DesktopSwitchResult>
  openExternalBrowser: () => DesktopRuntimeSnapshot | Promise<DesktopRuntimeSnapshot>
}

let desktopController: DesktopController | null = null

export const getDesktopExternalAccessEnabled = () =>
  getSettingBoolean('desktopExternalAccess')

export const saveDesktopExternalAccessEnabled = (enabled: boolean) => {
  setSetting('desktopExternalAccess', enabled)
}

export const registerDesktopController = (controller: DesktopController) => {
  desktopController = controller
}

export const getDesktopRuntime = (): DesktopRuntimeSnapshot => {
  if (!desktopController) {
    return {
      desktopMode: false,
      externalAccessEnabled: getDesktopExternalAccessEnabled(),
      restartPending: false,
      lastSwitchError: null,
      bindHost: null,
      port: null,
      localUrl: null,
      externalUrls: [],
      primaryExternalUrl: null,
    }
  }
  return desktopController.getRuntime()
}

export const setDesktopExternalAccess = async (enabled: boolean) => {
  if (!desktopController) {
    throw badRequest('DESKTOP_RUNTIME_UNAVAILABLE', '桌面运行时不可用')
  }

  const previous = getDesktopExternalAccessEnabled()
  saveDesktopExternalAccessEnabled(enabled)
  const result = await desktopController.setExternalAccess(enabled)
  if (!result.ok) {
    saveDesktopExternalAccessEnabled(previous)
    throw badRequest(
      'DESKTOP_LISTENER_SWITCH_FAILED',
      result.error || '桌面监听切换失败',
    )
  }
  return desktopController.getRuntime()
}

export const openDesktopExternalBrowser = async () => {
  if (!desktopController) {
    throw badRequest('DESKTOP_RUNTIME_UNAVAILABLE', '桌面运行时不可用')
  }
  const runtime = desktopController.getRuntime()
  if (!runtime.primaryExternalUrl && !runtime.localUrl) {
    throw badRequest('DESKTOP_OPEN_BROWSER_UNAVAILABLE', '没有可用访问地址')
  }
  return desktopController.openExternalBrowser()
}
