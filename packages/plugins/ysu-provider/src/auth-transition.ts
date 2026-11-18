export interface AuthTransitionQueue {
  /** Wait for all authentication state transitions queued so far. */
  waitForAuthTransition(): Promise<void>
  /** Serialize operations that replace or reauthorize shared session state. */
  withAuthTransition<T>(operation: () => Promise<T>): Promise<T>
}

export function createAuthTransitionQueue(): AuthTransitionQueue {
  let transitionTail: Promise<void> = Promise.resolve()

  function waitForAuthTransition(): Promise<void> {
    return transitionTail
  }

  function withAuthTransition<T>(operation: () => Promise<T>): Promise<T> {
    const previous = transitionTail
    const { promise: current, resolve: release } = Promise.withResolvers<void>()
    transitionTail = previous.then(() => current)

    return previous.then(operation).finally(() => {
      release()
    })
  }

  return {
    waitForAuthTransition,
    withAuthTransition,
  }
}
