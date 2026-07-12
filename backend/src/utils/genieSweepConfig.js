export const GENIE_SWEEP_COMMAND_DELAY_MS = 5000;
export const GENIE_SWEEP_SWEEP_DELAY_MS = 4000;
export const GENIE_SWEEP_TICKET_DELAY_MS = 3000;
export const GENIE_SWEEP_RETRY_DELAY_MS = 6000;
export const GENIE_SWEEP_MAX_RETRY_DELAY_MS = 24000;
export const GENIE_SWEEP_RETRY_JITTER_MS = 1000;
export const GENIE_SWEEP_MAX_COMMAND_RETRIES = 3;

export function buildGenieSweepTaskOptions(config = {}) {
  return {
    ...config,
    commandDelayMs: GENIE_SWEEP_COMMAND_DELAY_MS,
    sweepDelayMs: GENIE_SWEEP_SWEEP_DELAY_MS,
    ticketDelayMs: GENIE_SWEEP_TICKET_DELAY_MS,
    retryDelayMs: GENIE_SWEEP_RETRY_DELAY_MS,
    maxRetryDelayMs: GENIE_SWEEP_MAX_RETRY_DELAY_MS,
    retryJitterMs: GENIE_SWEEP_RETRY_JITTER_MS,
    maxCommandRetries: GENIE_SWEEP_MAX_COMMAND_RETRIES,
  };
}
