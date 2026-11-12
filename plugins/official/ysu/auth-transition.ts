let transitionTail: Promise<void> = Promise.resolve()

/** Wait for all authentication state transitions queued so far. */
export function waitForAuthTransition(): Promise<void> {
  return transitionTail
}

/** Serialize operations that replace or reauthorize shared session state. */
export function withAuthTransition<T>(operation: () => Promise<T>): Promise<T> {
  const previous = transitionTail
  const { promise: current, resolve: release } = Promise.withResolvers<void>()
  transitionTail = previous.then(() => current)

  return previous.then(operation).finally(() => {
    release()
  })
}
