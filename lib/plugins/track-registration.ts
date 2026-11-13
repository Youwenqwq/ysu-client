import type { Context } from "@cordisjs/core"

/**
 * Attaches disposal before publishing a registration. A continuation holding a
 * disposed plugin context therefore fails before it can leak global state.
 */
export function trackPluginRegistration(ctx: Context, register: () => () => void): () => void {
  let active = true
  let dispose = () => {}
  const onDispose = () => {
    if (!active) return
    active = false
    dispose()
  }
  const unregister = ctx.on("dispose", onDispose)
  try {
    dispose = register()
  } catch (error) {
    unregister()
    throw error
  }
  return () => {
    if (!active) return
    active = false
    unregister()
    dispose()
  }
}
