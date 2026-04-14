import { useEffect, useMemo, useState } from "react";
import girondeGeoJsonRaw from "./data/gironde.geojson?raw";
import cantonsGeoJsonRaw from "./data/cantons-33-gironde.geojson?raw";
import { fetchResults, fetchCities, fetchCity, fetchPredict } from "./api";

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

const PREDICT_FIELDS = [
  { key: 'FEAT_Vote_2017',                                    label: '% vote Extrême Droite 2017' },
  { key: 'Mediane_du_niveau_vie',                             label: 'Médiane du niveau de vie (€)' },
  { key: 'part_ouvrier',                                      label: 'Part des ouvriers (%)' },
  { key: 'part_cadre',                                        label: 'Part des cadres (%)' },
  { key: 'part_retraite_csp',                                 label: 'Part des retraités (%)' },
  { key: 'Cambriolages_de_logement_nombre_sum',               label: 'Cambriolages de logement' },
  { key: 'Violences_physiques_hors_cadre_familial_nombre_sum',label: 'Violences physiques' },
  { key: 'age_moyen',                                         label: 'Âge moyen (ans)' },
  { key: 'Sans_Diplome_CEP',                                  label: 'Sans diplôme ou CEP (%)' },
]

const PREDICT_LABELS = {
  extreme_gauche: 'Extrême gauche',
  gauche:         'Gauche',
  centre:         'Centre',
  droite:         'Droite',
  extreme_droite: 'Extrême droite',
}

function PredictionSection() {
  const emptyForm = Object.fromEntries(PREDICT_FIELDS.map(f => [f.key, '']))
  const [form, setForm] = useState(emptyForm)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    const input = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : Number(v)])
    )

    try {
      const data = await fetchPredict('modele_rf_global_electio', input)
      setResult(data.prediction)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleReset() {
    setForm(emptyForm)
    setResult(null)
    setError(null)
  }

  return (
    <section className="panel" style={{ marginTop: 22 }}>
      <div className="panel-head">
        <div>
          <h2>Prédiction IA par commune</h2>
          <p>Renseigne les indicateurs d'une commune pour estimer la répartition des votes. Les champs laissés vides sont remplacés par la médiane de l'entraînement.</p>
        </div>
        <span className="tag">modele_rf_global_electio</span>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
          {PREDICT_FIELDS.map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.9rem', color: 'var(--muted)' }}>
              {label}
              <input
                type="number"
                name={key}
                value={form[key]}
                onChange={handleChange}
                placeholder="—"
                step="any"
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: '#f9fafb',
                  fontSize: '0.95rem',
                  color: 'var(--text)',
                  outline: 'none',
                }}
              />
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="submit" className="primary-button" disabled={loading} style={{ marginTop: 0 }}>
            {loading ? 'Calcul en cours…' : 'Lancer la prédiction'}
          </button>
          <button type="button" onClick={handleReset} style={{ marginTop: 0, padding: '14px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--muted)' }}>
            Réinitialiser
          </button>
        </div>
      </form>

      {error && (
        <div style={{ marginTop: 20, padding: '12px 16px', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: 8 }}>
          Erreur : {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 24 }}>
          <p style={{ margin: '0 0 14px', color: 'var(--muted)', fontSize: '0.9rem' }}>Résultats estimés (en %)</p>
          <div className="scores-grid">
            {Object.entries(result).map(([key, value], index) => (
              <ScoreCard key={key} label={PREDICT_LABELS[key] ?? key} value={value} index={index} />
            ))}
          </div>
        </div>
      )}
    </section>
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
  const [cityLimit, setCityLimit] = useState(7)

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

  const parsePop = (p) => parseInt(String(p).replace(/[\s,]/g, ''), 10) || 0

  const cityPoints = useMemo(
    () => [...cities]
      .filter((c) => c.lon !== 0 || c.lat !== 0)
      .sort((a, b) => parsePop(b.population) - parsePop(a.population))
      .slice(0, cityLimit)
      .map((city) => ({ ...city, ...mapProjection.projectPoint(city.lon, city.lat) })),
    [cities, mapProjection, cityLimit]
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              <span className="tag">Données territoriales</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#94a3b8' }}>
                Villes affichées : <strong style={{ color: '#e2e8f0', minWidth: 24, textAlign: 'right' }}>{cityLimit}</strong>
                <input
                  type="range"
                  min={1}
                  max={Math.max(cities.length, 1)}
                  value={cityLimit}
                  onChange={(e) => setCityLimit(Number(e.target.value))}
                  style={{ width: 120 }}
                />
                <span style={{ minWidth: 24, color: '#64748b' }}>{Math.max(cities.length, 1)}</span>
              </label>
            </div>
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

      <PredictionSection />
    </div>
  )
}
