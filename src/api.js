const BASE = '/api'

async function apiFetch(path, options) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`)
  return res.json()
}

/** Agrégat départemental Gironde — TARGETS */
export function fetchResults(zone = 'gironde') {
  return apiFetch(`/results?zone=${zone}`)
}

/** Liste toutes les communes du dept — TARGETS + GEO */
export function fetchCities(departement = '33') {
  return apiFetch(`/cities?departement=${departement}`)
}

/** Fiche détaillée d'une commune (code INSEE) — TARGETS + FEATURES */
export function fetchCity(id) {
  return apiFetch(`/cities/${id}`)
}

/** Filtre ±25 % sur chaque critère — FEATURES */
export function filterCities(criteria) {
  return apiFetch('/cities/filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(criteria),
  })
}
