import { useEffect, useMemo, useRef, useState } from "react";
import girondeGeoJsonRaw from "./data/gironde.geojson?raw";
import cantonsGeoJsonRaw from "./data/cantons-33-gironde.geojson?raw";
import { fetchResults, fetchCities, fetchCity, fetchPredict } from "./api";

const girondeGeoJson = JSON.parse(girondeGeoJsonRaw);
const cantonsGeoJson = JSON.parse(cantonsGeoJsonRaw);

const BASE_VIEWBOX = { x: 0, y: 0, w: 500, h: 700 };
const MIN_ZOOM = 1;     // 1 = vue complète (BASE_VIEWBOX)
const MAX_ZOOM = 6;     // 6 = zoom max (viewBox 6x plus petit)

// ---------------------------------------------------------------------------
// Normaliseurs — adaptent la réponse API au format attendu par les composants
// ---------------------------------------------------------------------------

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

  const list = Array.isArray(data) ? data : (data.tendances ?? [])

  return list.map((item) => {
    const key = item.key ?? item.tendance ?? item.categorie ?? ''
    const value = item.value ?? item.pct ?? item.pourcentage ?? 0
    return { key, label: item.label ?? LABELS[key] ?? key, value: Number(value) }
  })
}

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

// ---------------------------------------------------------------------------
// Prédiction IA — champs regroupés par thème
// ---------------------------------------------------------------------------

const PREDICT_GROUPS = [
  {
    title: "Patrimoine & fiscalité",
    fields: [
      { key: 'Part_des_revenus_du_patrimoine_et_autres_revenus', label: 'Revenus du patrimoine et autres revenus', unit: '%' },
      { key: 'Part_des_impots', label: 'Part des impôts', unit: '%', hint: 'valeur négative' },
      { key: 'Part_des_menages_fiscaux_imposes', label: 'Ménages fiscaux imposés', unit: '%' },
      { key: 'decile_9_niveau_de_vie', label: '9e décile du niveau de vie', unit: '€ / an' },
      { key: 'rapport_interdecile_d9_d1', label: 'Rapport interdécile (D9/D1)', unit: '' },
      { key: 'Mediane_du_niveau_vie', label: 'Médiane du niveau de vie', unit: '€ / an' },
      { key: 'dont_part_des_revenus_des_activites_non_salariees', label: "Revenus d'activités non salariées", unit: '%' },
    ],
  },
  {
    title: "Précarité & prestations",
    fields: [
      { key: 'dont_part_des_prestations_familiales', label: 'Prestations familiales', unit: '%' },
      { key: 'dont_part_des_indemnites_de_chomage', label: 'Indemnités de chômage', unit: '%' },
      { key: 'Part_des_pensions_retraites_et_rentes', label: 'Pensions, retraites et rentes', unit: '%' },
    ],
  },
  {
    title: "Profil sociodémographique",
    fields: [
      { key: 'age_moyen', label: 'Âge moyen', unit: 'ans' },
      { key: 'part_cadre', label: 'Part des cadres', unit: '%' },
      { key: 'part_ouvrier', label: 'Part des ouvriers', unit: '%' },
      { key: 'nombre_personnes_menages_fiscaux', label: 'Population de la commune', unit: 'hab.' },
    ],
  },
]

const PREDICT_LABELS = {
  extreme_gauche: 'Extrême gauche',
  gauche:         'Gauche',
  centre:         'Centre',
  droite:         'Droite',
  extreme_droite: 'Extrême droite',
}

function PredictionSection() {
  const allFields = PREDICT_GROUPS.flatMap((g) => g.fields)
  const DEFAULT_VALUES = {
    Part_des_revenus_du_patrimoine_et_autres_revenus: '8',
    Part_des_impots: '-16',
    Part_des_menages_fiscaux_imposes: '54',
    decile_9_niveau_de_vie: '40155.8',
    rapport_interdecile_d9_d1: '3.11',
    Mediane_du_niveau_vie: '23234',
    dont_part_des_revenus_des_activites_non_salariees: '5.09',
    dont_part_des_prestations_familiales: '1.82',
    dont_part_des_indemnites_de_chomage: '3.4',
    Part_des_pensions_retraites_et_rentes: '26.88',
    age_moyen: '41.28',
    part_cadre: '10.31',
    part_ouvrier: '11.37',
    nombre_personnes_menages_fiscaux: '2873.95',
}
const emptyForm = Object.fromEntries(allFields.map(f => [f.key, DEFAULT_VALUES[f.key] ?? '']))
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
    setForm(Object.fromEntries(allFields.map(f => [f.key, DEFAULT_VALUES[f.key] ?? ''])))
    setResult(null)
    setError(null)
  }

  return (
    <section className="panel prediction-panel">
      <div className="panel-head">
        <div>
          <h2>Prédiction IA par commune</h2>
          <p>Renseigne les indicateurs d'une commune pour estimer la répartition des votes. Les champs laissés vides sont remplacés par la médiane de l'entraînement.</p>
        </div>
        <span className="tag">modele_rf_global_electio</span>
      </div>

      <form onSubmit={handleSubmit}>
        {PREDICT_GROUPS.map((group) => (
          <fieldset className="predict-group" key={group.title}>
            <legend>{group.title}</legend>
            <div className="predict-grid">
              {group.fields.map(({ key, label, unit, hint }) => (
                <label className="predict-field" key={key}>
                  <span className="predict-field-label">
                    {label}
                    {unit && <span className="predict-field-unit"> ({unit})</span>}
                  </span>
                  <input
                    type="number"
                    name={key}
                    value={form[key]}
                    onChange={handleChange}
                    placeholder="—"
                    step="any"
                  />
                  {hint && <span className="predict-field-hint">{hint}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="predict-actions">
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? 'Calcul en cours…' : 'Lancer la prédiction'}
          </button>
          <button type="button" className="secondary-button" onClick={handleReset}>
            Réinitialiser
          </button>
        </div>
      </form>

      {error && (
        <div className="predict-error">
          Erreur : {error}
        </div>
      )}

      {result && (
        <div className="predict-results">
          <p className="predict-results-label">Résultats estimés (en %)</p>
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
  const [hoveredCityId, setHoveredCityId] = useState(null)
  const [loadingCities, setLoadingCities] = useState(true)
  const [loadingResults, setLoadingResults] = useState(true)
  const [error, setError] = useState(null)
  const [cityLimit, setCityLimit] = useState(7)

  // ----- Pan / Zoom de la carte -----------------------------------------
  const [viewBox, setViewBox] = useState(BASE_VIEWBOX)
  const svgRef = useRef(null)
  const panState = useRef(null) // { startClientX, startClientY, startViewBox, moved }
  const lastPanMoved = useRef(false)
  const pinchState = useRef(null) // { startDist, startViewBox, startCenter }
  const DRAG_THRESHOLD = 6 // px — au-delà, on considère que c'est un déplacement, pas un tap

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

  async function handleCitySelect(city) {
    setSelectedCity(city)
    try {
      const detail = await fetchCity(city.id)
      setSelectedCity(normalizeCity(detail))
    } catch {
      // on conserve les données de base si le détail échoue
    }
  }

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

  // ----- Helpers Pan / Zoom ----------------------------------------------

  // Convertit des coordonnées écran (px) en coordonnées du viewBox courant
  function screenToViewBox(clientX, clientY) {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const px = (clientX - rect.left) / rect.width
    const py = (clientY - rect.top) / rect.height
    return {
      x: viewBox.x + px * viewBox.w,
      y: viewBox.y + py * viewBox.h,
    }
  }

  function clampViewBox(vb) {
    let { x, y, w, h } = vb
    // borne la taille (zoom min/max)
    w = Math.min(BASE_VIEWBOX.w / MIN_ZOOM, Math.max(BASE_VIEWBOX.w / MAX_ZOOM, w))
    h = Math.min(BASE_VIEWBOX.h / MIN_ZOOM, Math.max(BASE_VIEWBOX.h / MAX_ZOOM, h))
    // borne la position pour ne pas sortir de la carte de base
    x = Math.min(Math.max(x, BASE_VIEWBOX.x), BASE_VIEWBOX.x + BASE_VIEWBOX.w - w)
    y = Math.min(Math.max(y, BASE_VIEWBOX.y), BASE_VIEWBOX.y + BASE_VIEWBOX.h - h)
    return { x, y, w, h }
  }

  function handleWheel(e) {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15
    const cursor = screenToViewBox(e.clientX, e.clientY)
    zoomAround(cursor, zoomFactor)
  }

  // Zoom centré sur un point précis du viewBox courant
  function zoomAround(point, zoomFactor) {
    setViewBox((prev) => {
      const newW = prev.w * zoomFactor
      const newH = prev.h * zoomFactor
      const ratioX = (point.x - prev.x) / prev.w
      const ratioY = (point.y - prev.y) / prev.h
      const newX = point.x - ratioX * newW
      const newY = point.y - ratioY * newH
      return clampViewBox({ x: newX, y: newY, w: newW, h: newH })
    })
  }

  // Boutons +/- : zoom centré sur le centre de la vue actuelle
  function zoomButton(factor) {
    setViewBox((prev) => {
      const center = { x: prev.x + prev.w / 2, y: prev.y + prev.h / 2 }
      const newW = prev.w * factor
      const newH = prev.h * factor
      return clampViewBox({
        x: center.x - newW / 2,
        y: center.y - newH / 2,
        w: newW,
        h: newH,
      })
    })
  }

  // --- Souris / trackpad : pan au cliqué-glissé ---
  function handlePointerDown(e) {
    if (e.pointerType === "touch") return
    panState.current = { startClientX: e.clientX, startClientY: e.clientY, startViewBox: viewBox, moved: false }
  }

  function handlePointerMove(e) {
    if (!panState.current) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const { startClientX, startClientY, startViewBox } = panState.current

    const dxPx = e.clientX - startClientX
    const dyPx = e.clientY - startClientY
    if (Math.abs(dxPx) > DRAG_THRESHOLD || Math.abs(dyPx) > DRAG_THRESHOLD) {
      panState.current.moved = true
    }

    const dx = -(dxPx / rect.width) * startViewBox.w
    const dy = -(dyPx / rect.height) * startViewBox.h

    setViewBox(clampViewBox({ ...startViewBox, x: startViewBox.x + dx, y: startViewBox.y + dy }))
  }

  function handlePointerUp(e) {
    lastPanMoved.current = panState.current?.moved ?? false
    panState.current = null
  }

  // --- Tactile : un doigt = pan, deux doigts = pinch-to-zoom ---
  function touchDistance(touches) {
    const [a, b] = touches
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
  }

  function touchMidpoint(touches) {
    const [a, b] = touches
    return { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 }
  }

  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      panState.current = { startClientX: t.clientX, startClientY: t.clientY, startViewBox: viewBox, moved: false }
      pinchState.current = null
    } else if (e.touches.length === 2) {
      panState.current = null
      const dist = touchDistance(e.touches)
      const mid = touchMidpoint(e.touches)
      pinchState.current = {
        startDist: dist,
        startViewBox: viewBox,
        startCenter: screenToViewBox(mid.clientX, mid.clientY),
      }
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinchState.current) {
      e.preventDefault()
      const dist = touchDistance(e.touches)
      const { startDist, startViewBox, startCenter } = pinchState.current
      const factor = startDist / dist // doigts qui s'écartent -> dist augmente -> factor < 1 -> zoom in
      const newW = startViewBox.w * factor
      const newH = startViewBox.h * factor
      const ratioX = (startCenter.x - startViewBox.x) / startViewBox.w
      const ratioY = (startCenter.y - startViewBox.y) / startViewBox.h
      const newX = startCenter.x - ratioX * newW
      const newY = startCenter.y - ratioY * newH
      setViewBox(clampViewBox({ x: newX, y: newY, w: newW, h: newH }))
      return
    }

    if (e.touches.length === 1 && panState.current) {
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const t = e.touches[0]
      const { startClientX, startClientY, startViewBox } = panState.current

      const dxPx = t.clientX - startClientX
      const dyPx = t.clientY - startClientY
      if (Math.abs(dxPx) > DRAG_THRESHOLD || Math.abs(dyPx) > DRAG_THRESHOLD) {
        panState.current.moved = true
        e.preventDefault() // bloque le scroll de page seulement une fois le pan engagé
      }

      const dx = -(dxPx / rect.width) * startViewBox.w
      const dy = -(dyPx / rect.height) * startViewBox.h

      setViewBox(clampViewBox({ ...startViewBox, x: startViewBox.x + dx, y: startViewBox.y + dy }))
    }
  }

  function handleTouchEnd() {
    lastPanMoved.current = panState.current?.moved ?? false
    panState.current = null
    pinchState.current = null
  }

  // Sélection d'une ville : ignorée si le pointeur a bougé (= pan), pour
  // éviter de sélectionner accidentellement une commune pendant un déplacement.
  function handleCityPointerUp(city) {
    if (lastPanMoved.current) return
    handleCitySelect(city)
  }

  function resetView() {
    setViewBox(BASE_VIEWBOX)
  }

  const isZoomed = viewBox.w < BASE_VIEWBOX.w - 0.5

  const viewBoxAttr = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`

  // Taille des points / labels adaptée au niveau de zoom courant
  const zoomLevel = BASE_VIEWBOX.w / viewBox.w
  const dotRadius = Math.max(1.5, 5 / zoomLevel)
  const labelFontSize = Math.max(6, 10 / zoomLevel)

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

      <section className="dashboard-grid dashboard-grid--single">
        <div className="panel large-panel">
          <div className="panel-head">
            <div>
              <h2>Carte départementale de la Gironde</h2>
              <p>Molette pour zoomer, cliquer-glisser pour vous déplacer. Cliquez sur une commune pour consulter ses informations.</p>
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
              <div className="map-controls">
                <button type="button" className="map-zoom-button" onClick={() => zoomButton(1 / 1.4)} aria-label="Zoomer">
                  +
                </button>
                <button type="button" className="map-zoom-button" onClick={() => zoomButton(1.4)} aria-label="Dézoomer">
                  −
                </button>
                {isZoomed && (
                  <button type="button" className="map-reset-button" onClick={resetView}>
                    Réinitialiser
                  </button>
                )}
              </div>
              <span className="map-hint">Pincer ou molette : zoom · Glisser : déplacer</span>
              <svg
                ref={svgRef}
                viewBox={viewBoxAttr}
                className="gironde-map"
                aria-label="Carte réelle de la Gironde, interactive avec zoom et déplacement"
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              >
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

                {cityPoints.map((city) => {
                  const isActive = selectedCity?.id === city.id
                  const isHovered = hoveredCityId === city.id
                  const showLabel = isActive || isHovered

                  return (
                    <g key={city.id}>
                      {/* Zone de tap invisible plus large que le point visible,
                          plus confortable au doigt sans gêner la lecture visuelle. */}
                      <circle
                        cx={city.x}
                        cy={city.y}
                        r={Math.max(dotRadius * 2.4, 9)}
                        fill="transparent"
                        onMouseEnter={() => setHoveredCityId(city.id)}
                        onMouseLeave={() => setHoveredCityId(null)}
                        onClick={() => handleCityPointerUp(city)}
                        style={{ cursor: "pointer" }}
                      />
                      <circle
                        cx={city.x}
                        cy={city.y}
                        r={dotRadius}
                        className={isActive ? "city-dot active" : "city-dot"}
                        style={{ pointerEvents: "none" }}
                      />
                      {showLabel && (
                        <text
                          x={city.x}
                          y={city.y - dotRadius - 4}
                          textAnchor="middle"
                          className="city-label"
                          style={{ fontSize: `${labelFontSize}px` }}
                        >
                          {city.name}
                        </text>
                      )}
                    </g>
                  )
                })}
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
            </aside>
          </div>
        </div>
      </section>

      <PredictionSection />
    </div>
  )
}