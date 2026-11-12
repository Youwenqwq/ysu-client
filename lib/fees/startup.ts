/**
 * 费用类插件的启动检查注册表。
 *
 * PluginRuntime 没有向插件暴露宿主启动完成的通用事件，因此这里提供最小
 * 启动适配：插件在 definition 中注册检查，宿主在 Provider 初始化完成后
 * 调用 {@link runFeeStartupChecks}。检查彼此隔离，失败不会影响其他插件。
 */

export type FeeStartupCheck = () => Promise<void> | void

const checks = new Set<FeeStartupCheck>()

/** 注册一个费用插件启动检查，返回注销函数。 */
export function registerFeeStartupCheck(check: FeeStartupCheck): () => void {
  checks.add(check)
  return () => {
    checks.delete(check)
  }
}

/** 运行全部已注册检查；单项失败会被吞掉，不影响其他检查。 */
export async function runFeeStartupChecks(): Promise<void> {
  await Promise.allSettled(Array.from(checks, (check) => Promise.resolve().then(check)))
}
