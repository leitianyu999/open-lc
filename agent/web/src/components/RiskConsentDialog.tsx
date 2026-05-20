import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { api, messageFromError, type RiskConsentType } from '../api'
import { Button, InlineAlert, Modal } from './ui'

const consentCopy: Record<
  RiskConsentType,
  {
    title: string
    intro: string
    items: string[]
  }
> = {
  open_platform_account: {
    title: '开放平台账号责任同意书',
    intro: '继续添加开放平台账号前，请确认你理解并接受以下风险与责任。',
    items: [
      '你确认 refresh_token、AK/SK 或 OpenList 提供参数的来源合法，并且你有权在本机 Agent 中使用这些凭据。',
      'Agent 会在本机保存并使用这些凭据访问百度开放平台，必要时会校验或刷新 access_token。',
      '开放平台调用可能消耗账号额度，也可能因为参数、权限、额度、风控或 token 状态导致失败。',
      '因凭据泄露、账号异常、第三方参数不可用或违反平台规则产生的后果，由你自行承担。',
    ],
  },
  cookie_account: {
    title: 'Cookie 账号风险与责任声明',
    intro: '继续启用或添加 Cookie 账号前，请确认你理解并接受以下风险与责任。',
    items: [
      'Cookie 等同登录凭证。你确认 Cookie 来源合法，并且你有权在本机 Agent 中保存和使用它。',
      'Agent 会在本机保存 Cookie，并使用该账号访问百度网盘、检测账号状态和执行解析相关请求。',
      '解析过程可能创建、转存、访问或删除临时文件，并消耗账号空间、流量、请求额度或触发风控。',
      'Cookie 账号可能出现验证码、风控、冷却、失效、封禁或其他账号异常，相关风险由你自行承担。',
    ],
  },
  broker_execution: {
    title: 'Broker 执行风险与责任声明',
    intro: '继续开启 Broker 执行前，请确认你理解并接受以下风险与责任。',
    items: [
      '开启后，Broker 可以向本机 Agent 分发解析任务，Agent 会使用本机账号、网络和计算资源执行任务。',
      '你需要自行确认 Broker Base URL 和 Agent Token 可信，避免连接到不受信任的服务端。',
      '建议配置 Worker 端点和 Worker 加密密钥，让对外返回的下载入口使用加密代理链接，减少真实直链暴露。',
      '远程任务可能导致账号额度消耗、网络访问、解析失败、账号风控或结算争议。',
      '因远程任务来源、账号消耗、执行结果或 LC 结算产生的问题，由你自行承担。',
    ],
  },
}

export function RiskConsentDialog({
  open,
  type,
  onAccepted,
  onCancel,
}: {
  open: boolean
  type: RiskConsentType | null
  onAccepted: () => void
  onCancel: () => void
}) {
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = api.api.security['risk-consents'][':type'].$post.useMutation()
  const copy = type ? consentCopy[type] : null

  const accept = async () => {
    if (!type) return
    setError(null)
    try {
      await mutation.mutateAsync({
        param: { type },
        json: { accepted: true },
      })
      await api.api.security.status.$get.invalidate()
      setChecked(false)
      onAccepted()
    } catch (err) {
      setError(messageFromError(err, '保存风险同意失败'))
    }
  }

  const cancel = () => {
    setChecked(false)
    setError(null)
    onCancel()
  }

  return (
    <Modal open={open && Boolean(copy)} title={copy?.title ?? '风险提示与责任同意'} onClose={cancel} maxWidthClassName="max-w-2xl">
      {copy ? (
        <div className="grid gap-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <div className="text-sm font-semibold leading-6">{copy.intro}</div>
          </div>
          <div className="grid gap-3 text-sm leading-6 text-slate-700">
            {copy.items.map((item, index) => (
              <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-2" key={item}>
                <span className="flex size-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{index + 1}</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
            <input checked={checked} className="mt-1 size-4 accent-blue-600" onChange={(event) => setChecked(event.target.checked)} type="checkbox" />
            <span>我已阅读并理解上述风险，确认由我自行承担相应责任。</span>
          </label>
          {error ? (
            <InlineAlert variant="error" onClose={() => setError(null)}>
              {error}
            </InlineAlert>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={mutation.isPending} onClick={cancel} variant="secondary">
              取消
            </Button>
            <Button disabled={!checked || mutation.isPending} onClick={accept}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              同意并继续
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
