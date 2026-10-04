import { nativeFetchGlobals } from '../../tests-preload.ts';

export async function withNativeFetch<T>(run: () => Promise<T>): Promise<T> {
  const dom = {
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
  };
  Object.assign(globalThis, nativeFetchGlobals);
  try {
    return await run();
  } finally {
    Object.assign(globalThis, dom);
  }
}
