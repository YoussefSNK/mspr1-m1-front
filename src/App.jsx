import { useEffect, useMemo, useState } from "react";
import girondeGeoJsonRaw from "./data/gironde.geojson?raw";
import cantonsGeoJsonRaw from "./data/cantons-33-gironde.geojson?raw";
import { fetchResults, fetchCities, fetchCity } from "./api";

const girondeGeoJson = JSON.parse(girondeGeoJsonRaw);
const cantonsGeoJson = JSON.parse(cantonsGeoJsonRaw);

// ---------------------------------------------------------------------------
// Normaliseurs — adaptent la réponse API au format attendu par les composants
// ---------------------------------------------------------------------------

/**
 * Convertit la réponse de GET /api/results?zone=gironde en tableau de
 * scoreCards { key, label, value }.
 *
 * Supporte deux formats renvoyés par le back :
 *   • Tableau  : [{ tendance|key, pct|value|pourcentage, label? }, …]
 *   • Objet    : { extreme_gauche: 12.4, gauche: 24.8, … }
 */
function normalizeResults(data) {
  const LABELS = {
    'extreme-gauche': 'Extrême gauche',
    extreme_gauche: 'Extrême gauche',
    gauche: 'Gauche',
    centre: 'Centre',
    droite: 'Droite',
    'extreme-droite': 'Extrême droite',
    extreme_droite: 'Extrême droite',
  }

  // { tendances: [...] } — format renvoyé par GET /api/results
  const list = Array.isArray(data) ? data : (data.tendances ?? [])

  return list.map((item) => {
    const key = item.key ?? item.tendance ?? item.categorie ?? ''
    const value = item.value ?? item.pct ?? item.pourcentage ?? 0
    return { key, label: item.label ?? LABELS[key] ?? key, value: Number(value) }
  })
}

/**
 * Normalise un objet commune (liste ou détail) en shape interne :
 * { id, name, lon, lat, population, participation, tendance, details }
 */
function normalizeCity(city) {
  return {
    id: city.id ?? city.code_insee ?? city.code ?? city.insee ?? '',
    name: city.name ?? city.nom ?? city.nom_commune ?? city.libelle ?? '',
    lon: Number(city.lon ?? city.longitude ?? city.lng ?? 0),
    lat: Number(city.lat ?? city.latitude ?? 0),
    population: city.population != null ? String(city.population) : '–',
    participation: city.participation != null
      ? `${city.participation}${String(city.participation).includes('%') ? '' : ' %'}`
      : '–',
    tendance: city.tendance ?? city.orientation ?? '–',
    details: city.details ?? city.description ?? city.resume ?? '',
  }
}

function normalizeCities(data) {
  const list = Array.isArray(data) ? data : data.cities ?? data.communes ?? []
  return list.map(normalizeCity)
}

// ---------------------------------------------------------------------------
// Primitives SVG
// ---------------------------------------------------------------------------

function buildRingPath(ring, projectPoint) {
  const [firstPoint, ...otherPoints] = ring
  const start = projectPoint(firstPoint[0], firstPoint[1])
  const segments = otherPoints
    .map(([lon, lat]) => {
      const { x, y } = projectPoint(lon, lat)
      return `L${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} ${segments} Z`
}

function buildGeometryPath(geometry, projectPoint) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) => buildRingPath(ring, projectPoint)).join(" ")
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => polygon.map((ring) => buildRingPath(ring, projectPoint)).join(" "))
      .join(" ")
  }
  return ""
}

// ---------------------------------------------------------------------------
// Composants
// ---------------------------------------------------------------------------

function ScoreCard({ label, value, index }) {
  return (
    <article className="score-card" style={{ animationDelay: `${index * 80}ms` }}>
      <p className="score-label">{label}</p>
      <div className="score-row">
        <strong className="score-value">{value}%</strong>
        <div className="score-bar">
          <span style={{ width: `${value}%` }} />
        </div>
      </div>
    </article>
  )
}

function ErrorBanner({ message }) {
  return (
    <div style={{ padding: '12px 16px', background: '#450a0a', color: '#fca5a5', borderRadius: 8, marginBottom: 16 }}>
      Erreur de chargement : {message}
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [cities, setCities] = useState([])
  const [scoreCards, setScoreCards] = useState([])
  const [selectedCity, setSelectedCity] = useState(null)
  const [loadingCities, setLoadingCities] = useState(true)
  const [loadingResults, setLoadingResults] = useState(true)
  const [error, setError] = useState(null)

  // Chargement initial
  useEffect(() => {
    fetchResults('gironde')
      .then((data) => setScoreCards(normalizeResults(data)))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingResults(false))

    fetchCities('33')
      .then((data) => {
        const list = normalizeCities(data)
        setCities(list)
        if (list.length > 0) setSelectedCity(list[0])
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingCities(false))
  }, [])

  // Sélection d'une commune — enrichit avec GET /api/cities/{id}
  async function handleCitySelect(city) {
    setSelectedCity(city)
    try {
      const detail = await fetchCity(city.id)
      setSelectedCity(normalizeCity(detail))
    } catch {
      // on conserve les données de base si le détail échoue
    }
  }

  // Projection cartographique
  const mapProjection = useMemo(() => {
    const width = 500
    const height = 700
    const padding = 22
    const coordinates = girondeGeoJson.geometry.coordinates

    let minLon = Infinity, maxLon = -Infinity
    let minLat = Infinity, maxLat = -Infinity

    coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        ring.forEach(([lon, lat]) => {
          minLon = Math.min(minLon, lon)
          maxLon = Math.max(maxLon, lon)
          minLat = Math.min(minLat, lat)
          maxLat = Math.max(maxLat, lat)
        })
      })
    })

    const rangeLon = maxLon - minLon
    const rangeLat = maxLat - minLat
    const drawableWidth = width - padding * 2
    const drawableHeight = height - padding * 2
    const scale = Math.min(drawableWidth / rangeLon, drawableHeight / rangeLat)
    const offsetX = (width - rangeLon * scale) / 2
    const offsetY = (height - rangeLat * scale) / 2

    const projectPoint = (lon, lat) => ({
      x: (lon - minLon) * scale + offsetX,
      y: (maxLat - lat) * scale + offsetY,
    })

    return { path: buildGeometryPath(girondeGeoJson.geometry, projectPoint), projectPoint }
  }, [])

  const cantonPaths = useMemo(
    () => cantonsGeoJson.features.map((feature) => ({
      code: feature.properties.code,
      d: buildGeometryPath(feature.geometry, mapProjection.projectPoint),
    })),
    [mapProjection]
  )

  const cityPoints = useMemo(
    () => cities
      .filter((c) => c.lon !== 0 || c.lat !== 0)
      .map((city) => ({ ...city, ...mapProjection.projectPoint(city.lon, city.lat) })),
    [cities, mapProjection]
  )

  const total = useMemo(
    () => scoreCards.reduce((sum, item) => sum + item.value, 0).toFixed(1),
    [scoreCards]
  )

  const loading = loadingCities || loadingResults

  return (
    <div className="page-shell">
      <div className="background-glow glow-1" />
      <div className="background-glow glow-2" />

      <header className="hero-card">
        <div>
          <span className="eyebrow">République Française • Service public</span>
          <h1>Tableau de bord électoral — Gironde</h1>
          <p className="hero-text">
            Restitution territoriale des indicateurs électoraux avec consultation
            par commune et synthèse départementale.
          </p>
        </div>

        <div className="hero-stats">
          <div className="mini-stat">
            <span>Catégories</span>
            <strong>{scoreCards.length} tendances</strong>
          </div>
          <div className="mini-stat">
            <span>Zone</span>
            <strong>Gironde</strong>
          </div>
          <div className="mini-stat">
            <span>Total</span>
            <strong>{loading ? '…' : `${total} %`}</strong>
          </div>
        </div>
      </header>

      {error && <ErrorBanner message={error} />}

      <section className="scores-grid">
        {loading
          ? <p style={{ color: '#94a3b8' }}>Chargement des résultats…</p>
          : scoreCards.map((card, index) => (
              <ScoreCard key={card.key} label={card.label} value={card.value} index={index} />
            ))}
      </section>

      <section className="dashboard-grid">
        <div className="panel large-panel">
          <div className="panel-head">
            <div>
              <h2>Carte départementale de la Gironde</h2>
              <p>Sélectionne une commune pour consulter les informations associées.</p>
            </div>
            <span className="tag">Données territoriales</span>
          </div>

          <div className="map-layout">
            <div className="map-box">
              <svg viewBox="0 0 500 700" className="gironde-map" aria-label="Carte réelle de la Gironde">
                <defs>
                  <linearGradient id="mapFill" x1="0%" x2="100%" y1="0%" y2="100%">
                    <stop offset="0%" stopColor="#dbeafe" />
                    <stop offset="100%" stopColor="#bfdbfe" />
                  </linearGradient>
                </defs>

                <path
                  d={mapProjection.path}
                  fill="url(#mapFill)"
                  stroke="#94a3b8"
                  strokeWidth="4"
                  fillRule="evenodd"
                />

                <g className="cantons-layer" aria-hidden="true">
                  {cantonPaths.map((canton) => (
                    <path key={canton.code} d={canton.d} className="canton-boundary" fill="none" />
                  ))}
                </g>

                {cityPoints.map((city) => (
                  <g key={city.id}>
                    <circle
                      cx={city.x}
                      cy={city.y}
                      r="7"
                      className={selectedCity?.id === city.id ? "city-dot active" : "city-dot"}
                      onMouseEnter={() => handleCitySelect(city)}
                      onClick={() => handleCitySelect(city)}
                    />
                    <text x={city.x} y={city.y - 10} textAnchor="middle" className="city-label">
                      {city.name}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <aside className="city-panel">
              {selectedCity ? (
                <>
                  <div className="city-panel-top">
                    <span className="city-kicker">Commune sélectionnée</span>
                    <h3>{selectedCity.name}</h3>
                    <p>{selectedCity.details || '–'}</p>
                  </div>

                  <div className="info-list">
                    <div className="info-card">
                      <span>Population</span>
                      <strong>{selectedCity.population}</strong>
                    </div>
                    <div className="info-card">
                      <span>Participation</span>
                      <strong>{selectedCity.participation}</strong>
                    </div>
                    <div className="info-card">
                      <span>Tendance</span>
                      <strong>{selectedCity.tendance}</strong>
                    </div>
                  </div>
                </>
              ) : (
                <p style={{ color: '#94a3b8' }}>
                  {loadingCities ? 'Chargement des communes…' : 'Sélectionne une commune sur la carte.'}
                </p>
              )}

              <button
                className="primary-button"
                disabled={!selectedCity}
                onClick={() => selectedCity && handleCitySelect(selectedCity)}
              >
                Consulter la fiche détaillée
              </button>
            </aside>
          </div>
        </div>

        <div className="panel side-panel">
          <h2>Organisation du tableau de bord</h2>

          <div className="stack-cards">
            <div className="stack-card">
              <strong>1. Indicateurs politiques</strong>
              <p>Présentation synthétique des tendances sur le périmètre départemental.</p>
            </div>
            <div className="stack-card">
              <strong>2. Carte territoriale</strong>
              <p>Visualisation de la Gironde avec limites cantonales et points de communes.</p>
            </div>
            <div className="stack-card">
              <strong>3. Données API</strong>
              <p>Les informations sont chargées depuis le back-end en temps réel.</p>
            </div>
            <div className="stack-card">
              <strong>4. Évolutions prévues</strong>
              <p>Ajout de filtres POST /api/cities/filter et comparaisons multi-territoires.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
