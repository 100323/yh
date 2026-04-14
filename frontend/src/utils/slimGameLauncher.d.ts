export interface SlimGameLaunchOptions {
  sessionId?: string;
  embed?: boolean | string;
}

export interface SlimGameLaunchResult {
  launchKey: string;
  launchUrl: string;
  payload: Record<string, any>;
  sessionId: string;
  openedInNewWindow: boolean;
}

export function prepareSlimGameLaunch(account?: Record<string, any>, options?: SlimGameLaunchOptions): SlimGameLaunchResult;
export function openSlimGameWithAccount(account?: Record<string, any>, options?: SlimGameLaunchOptions): SlimGameLaunchResult;
