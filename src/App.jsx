import { useEffect, useMemo, useRef, useState } from "react";
import girondeGeoJsonRaw from "./data/gironde.geojson?raw";
import cantonsGeoJsonRaw from "./data/cantons-33-gironde.geojson?raw";
import { fetchResults, fetchCities, fetchCity, fetchPredict } from "./api";

const girondeGeoJson = JSON.parse(girondeGeoJsonRaw);
const cantonsGeoJson = JSON.parse(cantonsGeoJsonRaw);

const BASE_VIEWBOX = { x: 0, y: 0, w: 500, h: 700 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

const TENDANCE_COLORS = {
  extreme_gauche:   "#b60000",
  "extreme-gauche": "#b60000",
  gauche:           "#e05206",
  centre:           "#ffcd00",
  droite:           "#003189",
  extreme_droite:   "#1a1a1a",
  "extreme-droite": "#1a1a1a",
};

const TENDANCE_LABELS = {
  extreme_gauche:   "Extrême gauche",
  "extreme-gauche": "Extrême gauche",
  gauche:           "Gauche",
  centre:           "Centre",
  droite:           "Droite",
  "extreme-droite": "Extrême droite",
  extreme_droite:   "Extrême droite",
};

// ---------------------------------------------------------------------------
// Normaliseurs
// ---------------------------------------------------------------------------

function normalizeResults(data) {
  const list = Array.isArray(data) ? data : (data.tendances ?? []);
  return list.map((item) => {
    const key = item.key ?? item.tendance ?? item.categorie ?? "";
    const value = item.value ?? item.pct ?? item.pourcentage ?? 0;
    return { key, label: item.label ?? TENDANCE_LABELS[key] ?? key, value: Number(value) };
  });
}

function normalizeCity(city) {
  return {
    id: city.id ?? city.code_insee ?? city.code ?? city.insee ?? "",
    name: city.name ?? city.nom ?? city.nom_commune ?? city.libelle ?? "",
    lon: Number(city.lon ?? city.longitude ?? city.lng ?? 0),
    lat: Number(city.lat ?? city.latitude ?? 0),
    population: city.population != null ? String(city.population) : "–",
    participation: city.participation != null
      ? `${city.participation}${String(city.participation).includes("%") ? "" : " %"}`
      : "–",
    tendance: city.tendance ?? city.orientation ?? "–",
    details: city.details ?? city.description ?? city.resume ?? "",
  };
}

function normalizeCities(data) {
  const list = Array.isArray(data) ? data : data.cities ?? data.communes ?? [];
  return list.map(normalizeCity);
}

// ---------------------------------------------------------------------------
// Primitives SVG
// ---------------------------------------------------------------------------

function buildRingPath(ring, projectPoint) {
  const [firstPoint, ...otherPoints] = ring;
  const start = projectPoint(firstPoint[0], firstPoint[1]);
  const segments = otherPoints
    .map(([lon, lat]) => { const { x, y } = projectPoint(lon, lat); return `L${x.toFixed(2)} ${y.toFixed(2)}`; })
    .join(" ");
  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} ${segments} Z`;
}

function buildGeometryPath(geometry, projectPoint) {
  if (geometry.type === "Polygon")
    return geometry.coordinates.map((ring) => buildRingPath(ring, projectPoint)).join(" ");
  if (geometry.type === "MultiPolygon")
    return geometry.coordinates.map((polygon) => polygon.map((ring) => buildRingPath(ring, projectPoint)).join(" ")).join(" ");
  return "";
}

// ---------------------------------------------------------------------------
// ScoreCard — couleur par tendance politique
// ---------------------------------------------------------------------------

function ScoreCard({ label, value, tendanceKey, index }) {
  const color = TENDANCE_COLORS[tendanceKey] || "#000091";
  return (
    <article className="score-card" style={{ animationDelay: `${index * 80}ms`, borderTop: `4px solid ${color}` }}>
      <p className="score-label">{label}</p>
      <div className="score-row">
        <strong className="score-value" style={{ color }}>{value}%</strong>
        <div className="score-bar">
          <span style={{ width: `${Math.min(value * 2.5, 100)}%`, background: color }} />
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Section prédiction
// ---------------------------------------------------------------------------

const PREDICT_GROUPS = [
  {
    title: "Patrimoine & fiscalité",
    fields: [
      { key: "Part_des_revenus_du_patrimoine_et_autres_revenus", label: "Revenus du patrimoine et autres revenus", unit: "%" },
      { key: "Part_des_impots", label: "Part des impôts", unit: "%", hint: "valeur négative" },
      { key: "Part_des_menages_fiscaux_imposes", label: "Ménages fiscaux imposés", unit: "%" },
      { key: "decile_9_niveau_de_vie", label: "9e décile du niveau de vie", unit: "€ / an" },
      { key: "rapport_interdecile_d9_d1", label: "Rapport interdécile (D9/D1)", unit: "" },
      { key: "Mediane_du_niveau_vie", label: "Médiane du niveau de vie", unit: "€ / an" },
      { key: "dont_part_des_revenus_des_activites_non_salariees", label: "Revenus d'activités non salariées", unit: "%" },
    ],
  },
  {
    title: "Précarité & prestations",
    fields: [
      { key: "dont_part_des_prestations_familiales", label: "Prestations familiales", unit: "%" },
      { key: "dont_part_des_indemnites_de_chomage", label: "Indemnités de chômage", unit: "%" },
      { key: "Part_des_pensions_retraites_et_rentes", label: "Pensions, retraites et rentes", unit: "%" },
    ],
  },
  {
    title: "Profil sociodémographique",
    fields: [
      { key: "age_moyen", label: "Âge moyen", unit: "ans" },
      { key: "part_cadre", label: "Part des cadres", unit: "%" },
      { key: "part_ouvrier", label: "Part des ouvriers", unit: "%" },
      { key: "nombre_personnes_menages_fiscaux", label: "Population de la commune", unit: "hab." },
    ],
  },
];

const DEFAULT_VALUES = {
  Part_des_revenus_du_patrimoine_et_autres_revenus: "8",
  Part_des_impots: "-16",
  Part_des_menages_fiscaux_imposes: "54",
  decile_9_niveau_de_vie: "40155.8",
  rapport_interdecile_d9_d1: "3.11",
  Mediane_du_niveau_vie: "23234",
  dont_part_des_revenus_des_activites_non_salariees: "5.09",
  dont_part_des_prestations_familiales: "1.82",
  dont_part_des_indemnites_de_chomage: "3.4",
  Part_des_pensions_retraites_et_rentes: "26.88",
  age_moyen: "41.28",
  part_cadre: "10.31",
  part_ouvrier: "11.37",
  nombre_personnes_menages_fiscaux: "2873.95",
};

function PredictionSection() {
  const allFields = PREDICT_GROUPS.flatMap((g) => g.fields);
  const makeForm = () => Object.fromEntries(allFields.map((f) => [f.key, DEFAULT_VALUES[f.key] ?? ""]));
  const [form, setForm] = useState(makeForm);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleChange(e) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null); setResult(null);
    const input = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : Number(v)]));
    try {
      const data = await fetchPredict("modele_rf_global_electio", input);
      setResult(data.prediction);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setForm(makeForm()); setResult(null); setError(null);
  }

  return (
    <section className="panel prediction-panel">
      <div className="panel-head">
        <div>
          <div className="panel-eyebrow">Modèle prédictif · Random Forest · Gironde (33)</div>
          <h2>Simulateur de tendances électorales</h2>
          <p>
            Renseignez les indicateurs socio-économiques d'une commune pour estimer la répartition des votes à moyen terme.
            Les champs pré-remplis correspondent aux médianes observées sur la Gironde — modifiez-les pour simuler des scénarios.
          </p>
        </div>
        <span className="tag tag--model">modele_rf_global_electio</span>
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
                      className={form[key] !== (DEFAULT_VALUES[key] ?? '') ? 'is-modified' : ''}
                    />
                  {hint && <span className="predict-field-hint">{hint}</span>}
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <div className="predict-actions">
          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? "Calcul en cours…" : "Lancer la prédiction"}
          </button>
          <button type="button" className="secondary-button" onClick={handleReset}>
            Réinitialiser aux médianes
          </button>
        </div>
      </form>

      {error && <div className="predict-error">Erreur : {error}</div>}

      {result && (
        <div className="predict-results">
          <p className="predict-results-label">
            Estimation de la répartition des votes (en %) — modèle R² moyen 0,46
          </p>
          <div className="scores-grid">
            {Object.entries(result).map(([key, value], index) => (
              <ScoreCard key={key} tendanceKey={key} label={TENDANCE_LABELS[key] ?? key} value={value} index={index} />
            ))}
          </div>
          <p className="predict-disclaimer">
            Ces résultats sont des estimations statistiques. Le modèle explique bien la variance des blocs Extrême droite (R²=0,71), Gauche (R²=0,64) et Centre (R²=0,54). La prédiction est indicative pour la Droite (R²=0,37) et peu informative pour l'Extrême gauche (R²=0,03) en raison de la faible variance de ce vote en Gironde.
          </p>
        </div>
      )}
    </section>
  );
}


function CitySearch({ cities, onSelect }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)

  const suggestions = query.length >= 2
    ? cities.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : []

  return (
    <div className="city-search-wrap">
      <input
        type="text"
        className="city-search-input"
        placeholder="Nom de commune…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && suggestions.length > 0 && (
        <ul className="city-search-list">
          {suggestions.map((c) => (
            <li key={c.id}
              className="city-search-item"
              onMouseDown={() => { onSelect(c); setQuery(c.name); setOpen(false) }}
            >
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [cities, setCities] = useState([]);
  const [scoreCards, setScoreCards] = useState([]);
  const [selectedCity, setSelectedCity] = useState(null);
  const [hoveredCityId, setHoveredCityId] = useState(null);
  const [loadingCities, setLoadingCities] = useState(true);
  const [loadingResults, setLoadingResults] = useState(true);
  const [error, setError] = useState(null);
  const [cityLimit, setCityLimit] = useState(30);

  const [viewBox, setViewBox] = useState(BASE_VIEWBOX);
  const svgRef = useRef(null);
  const panState = useRef(null);
  const lastPanMoved = useRef(false);
  const pinchState = useRef(null);
  const DRAG_THRESHOLD = 6;

  useEffect(() => {
    fetchResults("gironde")
      .then((data) => setScoreCards(normalizeResults(data)))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingResults(false));

    fetchCities("33")
      .then((data) => {
        const list = normalizeCities(data);
        setCities(list);
        if (list.length > 0) setSelectedCity(list[0]);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingCities(false));
  }, []);

  async function handleCitySelect(city) {
    setSelectedCity(city);
    try {
      const detail = await fetchCity(city.id);
      setSelectedCity(normalizeCity(detail));
    } catch { /* garde les données de base */ }
  }

  const mapProjection = useMemo(() => {
    const width = 500, height = 700, padding = 22;
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    girondeGeoJson.geometry.coordinates.forEach((polygon) =>
      polygon.forEach((ring) => ring.forEach(([lon, lat]) => {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }))
    );
    const scale = Math.min((width - padding * 2) / (maxLon - minLon), (height - padding * 2) / (maxLat - minLat));
    const offsetX = (width - (maxLon - minLon) * scale) / 2;
    const offsetY = (height - (maxLat - minLat) * scale) / 2;
    const projectPoint = (lon, lat) => ({
      x: (lon - minLon) * scale + offsetX,
      y: (maxLat - lat) * scale + offsetY,
    });
    return { path: buildGeometryPath(girondeGeoJson.geometry, projectPoint), projectPoint };
  }, []);

  const cantonPaths = useMemo(
    () => cantonsGeoJson.features.map((f) => ({ code: f.properties.code, d: buildGeometryPath(f.geometry, mapProjection.projectPoint) })),
    [mapProjection]
  );

  const parsePop = (p) => parseInt(String(p).replace(/[\s,]/g, ""), 10) || 0;

  const cityPoints = useMemo(
    () => [...cities]
      .filter((c) => c.lon !== 0 || c.lat !== 0)
      .sort((a, b) => parsePop(b.population) - parsePop(a.population))
      .slice(0, cityLimit)
      .map((city) => ({ ...city, ...mapProjection.projectPoint(city.lon, city.lat) })),
    [cities, mapProjection, cityLimit]
  );

  const total = useMemo(() => scoreCards.reduce((s, i) => s + i.value, 0).toFixed(1), [scoreCards]);
  const loading = loadingCities || loadingResults;

  function screenToViewBox(clientX, clientY) {
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w, y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h };
  }

  function clampViewBox(vb) {
    let { x, y, w, h } = vb;
    w = Math.min(BASE_VIEWBOX.w / MIN_ZOOM, Math.max(BASE_VIEWBOX.w / MAX_ZOOM, w));
    h = Math.min(BASE_VIEWBOX.h / MIN_ZOOM, Math.max(BASE_VIEWBOX.h / MAX_ZOOM, h));
    x = Math.min(Math.max(x, BASE_VIEWBOX.x), BASE_VIEWBOX.x + BASE_VIEWBOX.w - w);
    y = Math.min(Math.max(y, BASE_VIEWBOX.y), BASE_VIEWBOX.y + BASE_VIEWBOX.h - h);
    return { x, y, w, h };
  }

  function zoomButton(factor) {
    setViewBox((prev) => {
      const cx = prev.x + prev.w / 2, cy = prev.y + prev.h / 2;
      const nw = prev.w * factor, nh = prev.h * factor;
      return clampViewBox({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
    });
  }

  function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const point = screenToViewBox(e.clientX, e.clientY);
    setViewBox((prev) => {
      const nw = prev.w * factor, nh = prev.h * factor;
      return clampViewBox({ x: point.x - ((point.x - prev.x) / prev.w) * nw, y: point.y - ((point.y - prev.y) / prev.h) * nh, w: nw, h: nh });
    });
  }

  function handlePointerDown(e) {
    if (e.pointerType === "touch") return;
    panState.current = { startClientX: e.clientX, startClientY: e.clientY, startViewBox: viewBox, moved: false };
  }

  function handlePointerMove(e) {
    if (!panState.current) return;
    const svg = svgRef.current; if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = e.clientX - panState.current.startClientX, dy = e.clientY - panState.current.startClientY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) panState.current.moved = true;
    const { startViewBox } = panState.current;
    setViewBox(clampViewBox({ ...startViewBox, x: startViewBox.x - (dx / rect.width) * startViewBox.w, y: startViewBox.y - (dy / rect.height) * startViewBox.h }));
  }

  function handlePointerUp() { lastPanMoved.current = panState.current?.moved ?? false; panState.current = null; }

  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      panState.current = { startClientX: t.clientX, startClientY: t.clientY, startViewBox: viewBox, moved: false };
      pinchState.current = null;
    } else if (e.touches.length === 2) {
      panState.current = null;
      const [a, b] = e.touches;
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const mid = { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 };
      pinchState.current = { startDist: dist, startViewBox: viewBox, startCenter: screenToViewBox(mid.clientX, mid.clientY) };
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2 && pinchState.current) {
      e.preventDefault();
      const [a, b] = e.touches;
      const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
      const { startDist, startViewBox, startCenter } = pinchState.current;
      const f = startDist / dist;
      const nw = startViewBox.w * f, nh = startViewBox.h * f;
      setViewBox(clampViewBox({ x: startCenter.x - ((startCenter.x - startViewBox.x) / startViewBox.w) * nw, y: startCenter.y - ((startCenter.y - startViewBox.y) / startViewBox.h) * nh, w: nw, h: nh }));
      return;
    }
    if (e.touches.length === 1 && panState.current) {
      const svg = svgRef.current; if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const t = e.touches[0];
      const dx = t.clientX - panState.current.startClientX, dy = t.clientY - panState.current.startClientY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) { panState.current.moved = true; e.preventDefault(); }
      const { startViewBox } = panState.current;
      setViewBox(clampViewBox({ ...startViewBox, x: startViewBox.x - (dx / rect.width) * startViewBox.w, y: startViewBox.y - (dy / rect.height) * startViewBox.h }));
    }
  }

  function handleTouchEnd() { lastPanMoved.current = panState.current?.moved ?? false; panState.current = null; pinchState.current = null; }

  function handleCityPointerUp(city) { if (lastPanMoved.current) return; handleCitySelect(city); }
  function resetView() { setViewBox(BASE_VIEWBOX); }

  const isZoomed = viewBox.w < BASE_VIEWBOX.w - 0.5;
  const viewBoxAttr = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`;
  const zoomLevel = BASE_VIEWBOX.w / viewBox.w;
  const dotRadius = Math.max(1.5, 5 / zoomLevel);
  const labelFontSize = Math.max(6, 10 / zoomLevel);

  const cityTendanceColor = (city) => {
    const key = (city.tendance ?? "").toLowerCase().replace(/ /g, "_");
    return TENDANCE_COLORS[key] || "#64748b";
  };

  return (
    <div className="page-shell">

      {/* EN-TÊTE INSTITUTIONNEL */}
      <header className="site-header">
        <div className="site-header-top">
          <div className="tricolor-bar">
            <span style={{ background: "#002395" }} />
            <span style={{ background: "#ffffff" }} />
            <span style={{ background: "#ED2939" }} />
          </div>
          <div className="site-header-brand">
            <span className="site-header-sep">·</span>
            <span className="site-header-service">Analyse électorale territoriale</span>
          </div>
        </div>
        <div className="site-header-main">
          <div className="site-header-title">
            <div className="site-header-client">
              <span className="client-badge">Client</span>
              Electio-Analytics
            </div>
            <h1>Preuve de concept — Prévision électorale</h1>
            <p className="site-header-subtitle">
              Modèle prédictif supervisé sur le département de la <strong>Gironde (33)</strong> ·
              Indicateurs socio-économiques × résultats électoraux 2012–2022
            </p>
          </div>
          <div className="site-header-meta">
            <div className="meta-card">
              <span className="meta-label">Périmètre</span>
              <strong>530+ communes</strong>
            </div>
            <div className="meta-card">
              <span className="meta-label">Scrutins</span>
              <strong>2012 · 2017 · 2022</strong>
            </div>
            <div className="meta-card">
              <span className="meta-label">Modèle retenu</span>
              <strong>Random Forest</strong>
            </div>
            <div className="meta-card">
              <span className="meta-label">R² moyen</span>
              <strong className="meta-r2">0,46</strong>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="alert-error">
          <strong>Erreur de chargement :</strong> {error}
        </div>
      )}

      {/* RÉSULTATS ÉLECTORAUX */}
      <section className="section-block">
        <div className="section-head">
          <h2 className="section-title">Résultats électoraux — Gironde 2022</h2>
          <p className="section-desc">Répartition observée des votes par bloc politique sur l'ensemble du département.</p>
        </div>
        <div className="scores-grid">
          {loading
            ? <p className="loading-text">Chargement des résultats…</p>
            : scoreCards.map((card, index) => (
                <ScoreCard key={card.key} tendanceKey={card.key} label={card.label} value={card.value} index={index} />
              ))}
        </div>
        {!loading && <p className="scores-total">Total exprimé : <strong>{total} %</strong></p>}
      </section>

      {/* CARTE + COMMUNE */}
      <section className="section-block">
        <div className="section-head">
          <h2 className="section-title">Exploration territoriale</h2>
          <p className="section-desc">
            Cliquez sur une commune pour consulter son profil. Molette ou boutons +/− pour zoomer, glisser pour se déplacer.
          </p>
        </div>

        <div className="map-layout">
          <div className="map-box">
            <div className="map-controls">
              <button type="button" className="map-zoom-button" onClick={() => zoomButton(1 / 1.4)} aria-label="Zoomer">+</button>
              <button type="button" className="map-zoom-button" onClick={() => zoomButton(1.4)} aria-label="Dézoomer">−</button>
              {isZoomed && (
                <button type="button" className="map-reset-button" onClick={resetView}>Vue globale</button>
              )}
            </div>
            <div className="map-slider-wrap">
              <label className="map-slider-label">
                Communes affichées
                <input type="range" min={1} max={Math.max(cities.length, 1)} value={cityLimit}
                  onChange={(e) => setCityLimit(Number(e.target.value))} />
                <strong>{cityLimit}</strong>
              </label>
            </div>
            <span className="map-hint">Molette / pincer : zoom · Glisser : déplacer</span>
            <svg
              ref={svgRef}
              viewBox={viewBoxAttr}
              className="gironde-map"
              aria-label="Carte de la Gironde — sélection communale interactive"
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
                <linearGradient id="mapFill" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="#dbeafe" />
                  <stop offset="100%" stopColor="#bfdbfe" />
                </linearGradient>
              </defs>
              <path d={mapProjection.path} fill="url(#mapFill)" stroke="#94a3b8" strokeWidth="4" fillRule="evenodd" />
              <g className="cantons-layer" aria-hidden="true">
                {cantonPaths.map((canton) => (
                  <path key={canton.code} d={canton.d} className="canton-boundary" fill="none" />
                ))}
              </g>
              {cityPoints.map((city) => {
                const isActive = selectedCity?.id === city.id;
                const isHovered = hoveredCityId === city.id;
                const showLabel = isActive || isHovered;
                const dotColor = isActive ? cityTendanceColor(city) : "#475569";
                return (
                  <g key={city.id}>
                    <circle
                      cx={city.x} cy={city.y}
                      r={Math.max(dotRadius * 2.4, 9)}
                      fill="transparent"
                      onMouseEnter={() => setHoveredCityId(city.id)}
                      onMouseLeave={() => setHoveredCityId(null)}
                      onClick={() => handleCityPointerUp(city)}
                      style={{ cursor: "pointer" }}
                    />
                    <circle
                      cx={city.x} cy={city.y}
                      r={isActive ? dotRadius * 1.4 : dotRadius}
                      fill={dotColor}
                      style={{ pointerEvents: "none", transition: "fill 0.2s" }}
                    />
                    {showLabel && (
                      <text x={city.x} y={city.y - dotRadius - 4} textAnchor="middle"
                        className="city-label" style={{ fontSize: `${labelFontSize}px` }}>
                        {city.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          <aside className="city-panel">
            {selectedCity ? (
              <>
                <div className="city-panel-header">
                  <span className="city-kicker">Commune sélectionnée</span>
                  <h3>{selectedCity.name}</h3>
                  {selectedCity.tendance && selectedCity.tendance !== "–" && (
                    <span className="city-tendance-badge"
                      style={{
                        background: cityTendanceColor(selectedCity) + "18",
                        color: cityTendanceColor(selectedCity),
                        border: `1px solid ${cityTendanceColor(selectedCity)}40`
                      }}>
                      {selectedCity.tendance}
                    </span>
                  )}
                  {selectedCity.details && <p className="city-details">{selectedCity.details}</p>}
                </div>
                <dl className="city-stats">
                  <div className="city-stat">
                    <dt>Population</dt>
                    <dd>{selectedCity.population}</dd>
                  </div>
                  <div className="city-stat">
                    <dt>Participation</dt>
                    <dd>{selectedCity.participation}</dd>
                  </div>
                  <div className="city-stat">
                    <dt>Tendance dominante</dt>
                    <dd>{selectedCity.tendance}</dd>
                  </div>
                </dl>
                <div className="city-cta">
                  <p className="city-cta-text">Rechercher une commune :</p>
                  <CitySearch cities={cities} onSelect={handleCitySelect} />
                </div>

                <a href="#simulateur" className="city-cta-link">
                  Accéder au simulateur →
                </a>
              </>
            ) : (
              <div className="city-empty">
                <div className="city-empty-icon">📍</div>
                <p>{loadingCities ? "Chargement des communes…" : "Sélectionnez une commune sur la carte pour afficher son profil."}</p>
              </div>
            )}
          </aside>
        </div>
      </section>

      {/* SIMULATEUR */}
      <section className="section-block" id="simulateur">
        <div className="section-head">
          <h2 className="section-title">Simulation à moyen terme</h2>
          <p className="section-desc">
            Modifiez les indicateurs socio-économiques pour estimer l'évolution des tendances électorales à 1, 2 ou 3 ans.
          </p>
        </div>
        <PredictionSection />
      </section>

      {/* PIED DE PAGE */}
      <footer className="site-footer">
        <div className="footer-inner">
          <div><strong>Electio-Analytics</strong> — MSPR TPRE813 · Bloc 3 RNCP35584</div>
          <div className="footer-team">DAYOT · FADILI · NADJAR · GAUNET · DIEPPOIS · 2025–2026</div>
          <div className="footer-disclaimer">POC pédagogique — Données publiques open data · Ministère de l'Intérieur · INSEE</div>
        </div>
      </footer>
    </div>
  );
}