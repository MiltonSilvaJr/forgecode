export * as SubscriptionNotice from "./notice.js"

/** Version of the terms-of-use notice. Incrementing it re-prompts for acceptance. */
export const VERSION = 1

export interface Notice {
  readonly version: number
  readonly text: string
}

/** Versioned terms-of-use notice for a subscription provider. */
export function notice(providerID: string): Notice {
  return {
    version: VERSION,
    text:
      `Enabling subscription authentication for ${providerID} reuses the session kept by its official CLI ` +
      "and may violate that provider's terms of service. Connect an API key instead to use the " +
      "officially supported path.",
  }
}
