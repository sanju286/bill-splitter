// Every call goes through here. It never throws: a failed request becomes
// { ok: false } and the UI decides what to show (kept simple per the brief:
// no external fetch lib).
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string }

export type ApiInit = {
  method?: 'GET' | 'POST'
  body?: unknown
  idempotencyKey?: string
}

// Pulls the human message out of the API's { "error": "..." } responses.
function errorMessageFrom(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const error = (data as { error: unknown }).error
    if (typeof error === 'string' && error.length > 0) {
      return error
    }
  }
  return fallback
}

// JSON responses that are not objects (or fail to parse) come back as null —
// still a handled case, still no crash.
export async function apiCall<T>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  if (init.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = init.idempotencyKey
  }

  try {
    const response = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const data: unknown = await response.json().catch(() => null)
    if (response.ok) {
      return { ok: true, data: data as T }
    }
    return {
      ok: false,
      status: response.status,
      message: errorMessageFrom(data, `Request failed with status ${response.status}`),
    }
  } catch {
    // Network failure, DNS error, aborted request… the page shows this text
    // and keeps working.
    return {
      ok: false,
      status: null,
      message: 'Could not reach the API',
    }
  }
}
