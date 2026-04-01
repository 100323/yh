import type { App } from "vue";

const DEFAULT_TIMEOUT = 5 * 1000;

type ResolveFn<T> = (value: T) => void;
type RejectFn = (reason?: unknown) => void;

interface CacheConfig<T = unknown> {
  content?: Record<string, CacheItem<T>>;
  timeout?: number;
}

type CacheFetcher<T> =
  | ((key: string, conf: Required<CacheConfig<T>>) => Promise<T> | T)
  | Promise<T>
  | T;

class CacheItem<T = unknown> {
  key: string;
  private _value: T | null;
  private expiresAt: number;
  private completed = false;
  reject: RejectFn[] = [];
  reslove: ResolveFn<T>[] = [];

  constructor(key: string, value: T | null, timeout = DEFAULT_TIMEOUT) {
    this.key = key;
    this._value = value;
    this.expiresAt = Date.now() + timeout;
  }

  get timeout() {
    return this.expiresAt;
  }

  set val(data: T) {
    this.completed = true;
    this._value = data;
  }

  get val() {
    return this._value as T;
  }

  toJSON() {
    return {
      key: this.key,
      val: this._value,
      timeout: this.expiresAt,
    };
  }

  isTimeout() {
    return this.expiresAt < Date.now();
  }

  isOk() {
    return this.completed;
  }
}

class Cache<T = unknown> {
  name: string;
  content: Record<string, CacheItem<T>>;
  timeout: number;

  constructor(name: string, { content = {}, timeout = DEFAULT_TIMEOUT }: CacheConfig<T> = {}) {
    this.name = name;
    this.content = content;
    this.timeout = timeout;
  }

  async get(key: string, callback: CacheFetcher<T>, conf?: Partial<CacheConfig<T>>) {
    const item = this.content[key];
    const finalConf: Required<CacheConfig<T>> = {
      content: this.content,
      timeout: conf?.timeout ?? this.timeout,
    };

    if (item != null) {
      if (!item.isOk()) {
        return new Promise<T>((reslove, reject) => {
          item.reslove.push(reslove);
          item.reject.push(reject);
        });
      }

      if (!item.isTimeout()) {
        return item.val;
      }
    }

    return this.feach(key, callback, finalConf);
  }

  async feach(
    key: string,
    callback: CacheFetcher<T>,
    conf: Required<CacheConfig<T>> = { content: this.content, timeout: this.timeout },
  ) {
    const oldItem = this.content[key];
    const newItem = new CacheItem<T>(key, null, conf.timeout);
    this.content[key] = newItem;

    let data: T;

    try {
      if (typeof callback === "function") {
        data = await (callback as (key: string, conf: Required<CacheConfig<T>>) => Promise<T> | T)(
          key,
          conf,
        );
      } else {
        data = await callback;
      }

      oldItem?.reslove.forEach((fn) => fn?.(data));
      newItem.reslove.forEach((fn) => fn?.(data));
      newItem.val = data;
      return data;
    } catch (error) {
      console.error(`${this.name}-${key}: the ajax request is failed : ${String(error)}`);
      oldItem?.reject.forEach((fn) => fn?.(error));
      newItem.reject.forEach((fn) => fn?.(error));
      throw error;
    } finally {
      if (oldItem) {
        oldItem.reject.length = 0;
        oldItem.reslove.length = 0;
      }
      newItem.reject.length = 0;
      newItem.reslove.length = 0;
    }
  }

  clean(content: Record<string, CacheItem<T>> = {}) {
    this.content = content;
  }
}

class CacheManager {
  content: Record<string, Cache<any>>;
  timeout: number;

  constructor(content: Record<string, Cache<any>> = {}, timeout = DEFAULT_TIMEOUT) {
    this.content = content;
    this.timeout = timeout;
  }

  getCache<T = unknown>(name: string, config?: Partial<CacheConfig<T>>) {
    let cache = this.content[name] as Cache<T> | undefined;
    if (cache == null) {
      cache = new Cache<T>(name, {
        timeout: config?.timeout ?? this.timeout,
      });
      this.content[name] = cache;
    } else if (config?.timeout != null) {
      cache.timeout = config.timeout;
    }
    return cache;
  }

  delCache(name: string) {
    delete this.content[name];
  }

  clear() {
    this.content = {};
  }
}

const $CacheManager = new CacheManager();

const install = (vm: App) => {
  (vm.config.globalProperties as Record<string, unknown>).$CacheManager = $CacheManager;
};

window.$CacheManager = $CacheManager;

export { $CacheManager, CacheManager, Cache, CacheItem, install };
