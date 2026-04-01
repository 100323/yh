declare global {
  interface Window {
    $CacheManager?: any;
    GAME_VERSION?: string;
    CODE_VERSION?: string;
  }

  var GAME_VERSION: string | undefined;
  var CODE_VERSION: string | undefined;
}

export {};
