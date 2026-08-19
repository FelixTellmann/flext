import "leaflet/dist/leaflet.css";
import type { TravelStop } from "content/travel";
import { DRIVING_ROUTES } from "content/travel-routes";
import type { CircleMarker, Map as LeafletMap, Polyline } from "leaflet";
import { type FC, useEffect, useMemo, useRef } from "react";

// CARTO Voyager raster basemap: OSM data, open with attribution, no key or token. Used in both
// themes — dark mode deliberately keeps the light tiles for the native Google/Apple maps look.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const KIND_COLOR: Record<TravelStop["kind"], string> = {
  city: "#38bdf8",
  park: "#22c55e",
  friends: "#ec4899",
};

// A leg is drawn as a sampled quadratic arc rather than a straight line: the control point sits
// perpendicular to the midpoint, bowing flights hard and drives gently. Lat/lng is treated as a
// plane, which is inaccurate but reads well at these distances.
const arcPoints = (from: TravelStop, to: TravelStop, bow: number): [number, number][] => {
  const mid_latitude = (from.latitude + to.latitude) / 2;
  const mid_longitude = (from.longitude + to.longitude) / 2;
  const delta_latitude = to.latitude - from.latitude;
  const delta_longitude = to.longitude - from.longitude;
  const control_latitude = mid_latitude + delta_longitude * bow;
  const control_longitude = mid_longitude - delta_latitude * bow;
  const points: [number, number][] = [];
  const samples = 48;
  for (let step = 0; step <= samples; step++) {
    const t = step / samples;
    const inverse = 1 - t;
    points.push([
      inverse * inverse * from.latitude + 2 * inverse * t * control_latitude + t * t * to.latitude,
      inverse * inverse * from.longitude + 2 * inverse * t * control_longitude + t * t * to.longitude,
    ]);
  }
  return points;
};

type TripMapProps = {
  stops: TravelStop[];
  /** Drives the marker highlight; follows the timeline scrub as well as clicks. */
  activeId: string | null;
  /** Drives the zoom: an explicit selection centers that stop, null frames the whole trip. */
  focusId: string | null;
  onSelect: (id: string) => void;
};

export const TripMap: FC<TripMapProps> = ({ stops, activeId, focusId, onSelect }) => {
  const container_ref = useRef<HTMLDivElement | null>(null);
  const map_ref = useRef<LeafletMap | null>(null);
  const markers_ref = useRef<Map<string, CircleMarker>>(new Map());
  const legs_ref = useRef<Polyline[]>([]);
  // onSelect is read from a ref so re-renders never force the map to be rebuilt.
  const select_ref = useRef(onSelect);
  select_ref.current = onSelect;

  // Stable across renders, so the build effect below never tears the map down and rebuilds it.
  const mapped = useMemo(() => [...stops], [stops]);

  useEffect(() => {
    let disposed = false;

    const build = async () => {
      const L = await import("leaflet");
      if (disposed || !container_ref.current || map_ref.current) return;

      // Wheel zoom is safe here: the page is a fixed viewport that never scrolls itself, and
      // Leaflet preventDefaults the trackpad-pinch wheel events so the site does not zoom with it.
      const map = L.map(container_ref.current, { scrollWheelZoom: true, attributionControl: true });
      map_ref.current = map;

      L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, subdomains: "abcd", maxZoom: 19 }).addTo(map);

      for (let index = 0; index < mapped.length - 1; index++) {
        const from = mapped[index];
        const to = mapped[index + 1];
        const is_flight = to.arriveBy === "flight";
        // Road legs follow their real driving geometry; flights and rail fall back to drawn arcs.
        const road = DRIVING_ROUTES[`${from.id}->${to.id}`];
        // Movement is uniformly sky so pink stays reserved for the friends stops; dashes mark flights.
        const line = L.polyline(road ?? arcPoints(from, to, is_flight ? 0.22 : 0.08), {
          color: "#38bdf8",
          weight: road ? 2.5 : 2,
          opacity: road ? 0.75 : 0.55,
          dashArray: is_flight ? "6 6" : undefined,
        }).addTo(map);
        legs_ref.current.push(line);
      }

      for (const stop of mapped) {
        const marker = L.circleMarker([stop.latitude, stop.longitude], {
          radius: 6,
          color: "#ffffff",
          weight: 1.5,
          fillColor: KIND_COLOR[stop.kind],
          fillOpacity: 0.95,
        }).addTo(map);
        marker.bindTooltip(stop.name, { direction: "top", offset: [0, -8], className: "trip-tip" });
        marker.on("click", () => select_ref.current(stop.id));
        markers_ref.current.set(stop.id, marker);
      }

      map.fitBounds(
        mapped.map((stop) => [stop.latitude, stop.longitude]),
        { padding: [40, 40] },
      );
      // The container is grid-sized, so its box is only final after layout settles.
      requestAnimationFrame(() => map.invalidateSize());
    };

    void build();

    return () => {
      disposed = true;
      map_ref.current?.remove();
      map_ref.current = null;
      markers_ref.current.clear();
      legs_ref.current = [];
    };
  }, [mapped]);

  useEffect(() => {
    for (const [id, marker] of markers_ref.current) {
      const is_active = id === activeId;
      marker.setStyle({ weight: is_active ? 3 : 1.5, fillOpacity: is_active ? 1 : 0.95 });
      marker.setRadius(is_active ? 9 : 6);
      if (is_active) marker.bringToFront();
    }
  }, [activeId]);

  // Selecting a stop centers it at a fixed regional zoom; deselecting frames the whole trip again.
  useEffect(() => {
    const map = map_ref.current;
    if (!map) return;
    if (!focusId) {
      map.flyToBounds(
        mapped.map((stop) => [stop.latitude, stop.longitude]),
        { padding: [40, 40], duration: 0.8 },
      );
      return;
    }
    const index = mapped.findIndex((stop) => stop.id === focusId);
    if (index < 0) return;
    const target = mapped[index];
    // A fixed zoom keeps every click consistent: neighbour-derived framing either dove into
    // tight clusters or panned out to world scale when the next stop was a flight away.
    // Manual zoom is unaffected.
    map.flyTo([target.latitude, target.longitude], 7, { duration: 0.8 });
  }, [focusId, mapped]);

  // The panel layout resizes the map's box (breakpoint changes, panel collapse), and Leaflet
  // caches container dimensions, so every observed resize must invalidate them.
  useEffect(() => {
    if (!container_ref.current) return;
    const observer = new ResizeObserver(() => map_ref.current?.invalidateSize());
    observer.observe(container_ref.current);
    return () => observer.disconnect();
  }, []);

  return <div ref={container_ref} className="h-full w-full" />;
};
