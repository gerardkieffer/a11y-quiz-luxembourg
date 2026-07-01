const BASE_URL = "https://observatoire.accessibilite.public.lu/api/1";

async function fetchJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

export function getAuditsList() {
  // The API's default year window is narrow; a wide explicit range is
  // needed to get the full history. type=1 = in-depth/RAWeb audits (see
  // plan notes: the endpoint's own doc string mislabels 1/2/3).
  return fetchJson(`${BASE_URL}/audits?type=1&in=2000&out=2030`);
}

export function getAuditDetail(auditId) {
  return fetchJson(`${BASE_URL}/audits/${auditId}`);
}

export function getInventory() {
  return fetchJson(`${BASE_URL}/inventory`);
}

export function getStatements() {
  return fetchJson(`${BASE_URL}/statements`);
}

export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
