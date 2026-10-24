/** Only the current feed request may update results, pagination or loading state. */
export class SkbirdFeedRequests {
  private generation = 0
  private active: number | null = null

  begin(append: boolean): number | null {
    if (append && this.active !== null) return null
    this.active = ++this.generation
    return this.active
  }

  isCurrent(request: number): boolean {
    return this.active === request
  }

  finish(request: number): void {
    if (this.isCurrent(request)) this.active = null
  }

  invalidate(): void {
    this.active = null
  }
}
