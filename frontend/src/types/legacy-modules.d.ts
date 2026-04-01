declare module "@/utils/logger" {
  export const wsLogger: any;
  export const gameLogger: any;
  export const tokenLogger: any;
}

declare module "@/utils/bonProtocol" {
  export const bonProtocol: any;
  export const g_utils: any;
  export class ProtoMsg {
    constructor(cmd?: string, body?: any);
    cmd?: string;
    body?: any;
    error?: any;
    getData: () => any;
  }
}

declare module "@/utils/xyzwWebSocket" {
  export class XyzwWebSocketClient {
    constructor(config?: any);
    [key: string]: any;
  }
}

declare module "@/utils/studyQuestionsFromJSON" {
  export const preloadQuestions: any;
  export const findAnswer: any;
  export const findAnswerForQuestion: any;
}

declare module "@/router" {
  const router: any;
  export default router;
}

declare module "@utils/api" {
  const api: any;
  export default api;
}

declare module "@/api" {
  const api: any;
  export default api;
  export const request: any;
}

declare module "crypto-js" {
  export const MD5: any;
  export const lib: any;
  export const enc: any;
  const CryptoJS: any;
  export default CryptoJS;
}
