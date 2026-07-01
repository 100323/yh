export const GENIE_SWEEP_COMMAND_DELAY_MS = 1200;
export const GENIE_SWEEP_SWEEP_DELAY_MS = 1800;
export const GENIE_SWEEP_TICKET_DELAY_MS = 1200;

export function buildGenieSweepTaskOptions(config = {}) {
  return {
    ...config,
    commandDelayMs: GENIE_SWEEP_COMMAND_DELAY_MS,
    sweepDelayMs: GENIE_SWEEP_SWEEP_DELAY_MS,
    ticketDelayMs: GENIE_SWEEP_TICKET_DELAY_MS,
  };
}
