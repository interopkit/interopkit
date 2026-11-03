/**
 * An `XMLHttpRequest` over `fetch`, as much of one as the browser build of axios uses: the bundle of `@xapi/cmi5` carries that
 * build, whose only adapter outside a browser is this one.
 */
export class FetchXmlHttpRequest {
  readyState = 0;
  status = 0;
  statusText = "";
  responseText = "";
  response = "";
  responseURL = "";
  responseType = "";
  timeout = 0;
  withCredentials = false;
  onloadend: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private method = "GET";
  private url = "";
  private readonly headers: Record<string, string> = {};
  private answer: Headers | undefined;

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getAllResponseHeaders(): string {
    return [...(this.answer?.entries() ?? [])].map(([name, value]) => `${name}: ${value}`).join("\r\n");
  }

  abort(): void {
    this.onabort?.();
  }

  send(body?: string | null): void {
    fetch(this.url, { method: this.method, headers: this.headers, ...(body == null ? {} : { body }) })
      .then(async (answer) => {
        this.answer = answer.headers;
        this.status = answer.status;
        this.statusText = answer.statusText;
        this.responseURL = answer.url;
        this.responseText = await answer.text();
        this.response = this.responseText;
        this.readyState = 4;
        this.onloadend?.();
      })
      .catch((error: unknown) => this.onerror?.(error));
  }
}
