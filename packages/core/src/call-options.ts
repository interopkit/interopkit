/** The options of a call that waits on a service or a store. */
export interface CallOptions {
  /**
   * Ends this caller's wait. Work that several callers share runs on to its own timeout.
   *
   * @defaultValue none
   */
  readonly signal?: AbortSignal;
}
