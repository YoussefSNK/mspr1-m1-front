import { useMemo, useState } from "react";
import girondeGeoJsonRaw from "./data/gironde.geojson?raw";
import cantonsGeoJsonRaw from "./data/cantons-33-gironde.geojson?raw";

const girondeGeoJson = JSON.parse(girondeGeoJsonRaw);
const cantonsGeoJson = JSON.parse(cantonsGeoJsonRaw);

const scoreCards = [
  { key: "extreme-gauche", label: "Extrême gauche", value: 12.4 },
  { key: "gauche", label: "Gauche", value: 24.8 },
  { key: "centre", label: "Centre", value: 18.2 },
  { key: "droite", label: "Droite", value: 27.1 },
  { key: "extreme-droite", label: "Extrême droite", value: 17.5 },
];

const cities = [
  {
    id: 1,
    name: "Bordeaux",
    lon: -0.5792,
    lat: 44.8378,
    population: "257 000",
    participation: "68,2 %",
    tendance: "Centre / Droite",
    details: "Capitale régionale avec une forte densité de population et un profil électoral contrasté."
  },
  {
    id: 2,
    name: "Mérignac",
    lon: -0.6456,
    lat: 44.842,
    population: "77 000",
    participation: "64,8 %",
    tendance: "Centre",
    details: "Commune importante de la métropole bordelaise."
  },
  {
    id: 3,
    name: "Pessac",
    lon: -0.6315,
    lat: 44.8065,
    population: "66 000",
    participation: "65,4 %",
    tendance: "Gauche / Centre",
    details: "Ville universitaire avec une dynamique plutôt urbaine."
  },
  {
    id: 4,
    name: "Arcachon",
    lon: -1.165,
    lat: 44.658,
    population: "11 000",
    participation: "72,1 %",
    tendance: "Droite",
    details: "Zone littorale avec une participation plus élevée."
  },
  {
    id: 5,
    name: "Libourne",
    lon: -0.242,
    lat: 44.914,
    population: "24 000",
    participation: "66,9 %",
    tendance: "Droite / Centre",
    details: "Commune de l'est girondin, utile pour comparer les territoires."
  },
  {
    id: 6,
    name: "Langon",
    lon: -0.249,
    lat: 44.552,
    population: "7 500",
    participation: "69,3 %",
    tendance: "Droite",
    details: "Ville plus petite permettant de varier les profils."
  },
  {
    id: 7,
    name: "Lesparre-Médoc",
    lon: -0.937,
    lat: 45.307,
    population: "5 700",
    participation: "70,4 %",
    tendance: "Droite / Extrême droite",
    details: "Point intéressant pour illustrer le nord du département."
  },
];

function buildRingPath(ring, projectPoint) {
  const [firstPoint, ...otherPoints] = ring;
  const start = projectPoint(firstPoint[0], firstPoint[1]);
  const segments = otherPoints
    .map(([lon, lat]) => {
      const { x, y } = projectPoint(lon, lat);
      return `L${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} ${segments} Z`;
}

function buildGeometryPath(geometry, projectPoint) {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring) => buildRingPath(ring, projectPoint)).join(" ");
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => polygon.map((ring) => buildRingPath(ring, projectPoint)).join(" "))
      .join(" ");
  }

  return "";
}

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
  );
}

export default function App() {
  const [selectedCity, setSelectedCity] = useState(cities[0]);

  const mapProjection = useMemo(() => {
    const width = 500;
    const height = 700;
    const padding = 22;
    const coordinates = girondeGeoJson.geometry.coordinates;

    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    coordinates.forEach((polygon) => {
      polygon.forEach((ring) => {
        ring.forEach(([lon, lat]) => {
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        });
      });
    });

    const rangeLon = maxLon - minLon;
    const rangeLat = maxLat - minLat;
    const drawableWidth = width - padding * 2;
    const drawableHeight = height - padding * 2;
    const scale = Math.min(drawableWidth / rangeLon, drawableHeight / rangeLat);
    const offsetX = (width - rangeLon * scale) / 2;
    const offsetY = (height - rangeLat * scale) / 2;

    const projectPoint = (lon, lat) => ({
      x: (lon - minLon) * scale + offsetX,
      y: (maxLat - lat) * scale + offsetY,
    });

    const mapPath = buildGeometryPath(girondeGeoJson.geometry, projectPoint);

    return {
      path: mapPath,
      projectPoint,
    };
  }, []);

  const cantonPaths = useMemo(
    () =>
      cantonsGeoJson.features.map((feature) => ({
        code: feature.properties.code,
        d: buildGeometryPath(feature.geometry, mapProjection.projectPoint),
      })),
    [mapProjection]
  );

  const cityPoints = useMemo(
    () =>
      cities.map((city) => ({
        ...city,
        ...mapProjection.projectPoint(city.lon, city.lat),
      })),
    [mapProjection]
  );

  const total = useMemo(
    () => scoreCards.reduce((sum, item) => sum + item.value, 0).toFixed(1),
    []
  );

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
            <strong>5 tendances</strong>
          </div>
          <div className="mini-stat">
            <span>Zone</span>
            <strong>Gironde</strong>
          </div>
          <div className="mini-stat">
            <span>Total mocké</span>
            <strong>{total} %</strong>
          </div>
        </div>
      </header>

      <section className="scores-grid">
        {scoreCards.map((card, index) => (
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
                      className={selectedCity.id === city.id ? "city-dot active" : "city-dot"}
                      onMouseEnter={() => setSelectedCity(city)}
                      onClick={() => setSelectedCity(city)}
                    />
                    <text
                      x={city.x}
                      y={city.y - 10}
                      textAnchor="middle"
                      className="city-label"
                    >
                      {city.name}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <aside className="city-panel">
              <div className="city-panel-top">
                <span className="city-kicker">Commune sélectionnée</span>
                <h3>{selectedCity.name}</h3>
                <p>{selectedCity.details}</p>
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

              <button className="primary-button">Consulter la fiche détaillée</button>
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
              <strong>3. Données affichées</strong>
              <p>Les informations peuvent être raccordées à une source officielle de résultats.</p>
            </div>
            <div className="stack-card">
              <strong>4. Évolutions prévues</strong>
              <p>Ajout de filtres de lecture, exports et comparaisons multi-territoires.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
