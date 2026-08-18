import "leaflet/dist/leaflet.css";
import type { ItineraryStop } from "content/itinerary";
import type { CircleMarker, Map as LeafletMap, Polyline, TileLayer } from "leaflet";
import { type FC, useEffect, useMemo, useRef } from "react";
import { useTheme } from "~/components/theme-provider";

// CARTO raster basemaps: OSM data, open with attribution, no key or token.
const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

const KIND_COLOR: Record<ItineraryStop["kind"], string> = {
  city: "#38bdf8",
  park: "#22c55e",
  friends: "#ec4899",
};

type TripMapProps = {
  stops: ItineraryStop[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

export const TripMap: FC<TripMapProps> = ({ stops, activeId, onSelect }) => {
  const container_ref = useRef<HTMLDivElement | null>(null);
  const map_ref = useRef<LeafletMap | null>(null);
  const markers_ref = useRef<Map<string, CircleMarker>>(new Map());
  const legs_ref = useRef<Polyline[]>([]);
  const tiles_ref = useRef<TileLayer | null>(null);
  // onSelect is read from a ref so re-renders never force the map to be rebuilt.
  const select_ref = useRef(onSelect);
  select_ref.current = onSelect;

  const { resolvedTheme } = useTheme();
  // Stable across renders, so the build effect below never tears the map down and rebuilds it.
  const mapped = useMemo(() => stops.filter((stop) => !stop.offMap), [stops]);

  useEffect(() => {
    let disposed = false;

    const build = async () => {
      const L = await import("leaflet");
      if (disposed || !container_ref.current || map_ref.current) return;

      const map = L.map(container_ref.current, { scrollWheelZoom: false, attributionControl: true });
      map_ref.current = map;

      tiles_ref.current = L.tileLayer(TILES.light, { attribution: ATTRIBUTION, subdomains: "abcd", maxZoom: 19 }).addTo(map);

      for (let index = 0; index < mapped.length - 1; index++) {
        const from = mapped[index];
        const to = mapped[index + 1];
        const line = L.polyline(
          [
            [from.latitude, from.longitude],
            [to.latitude, to.longitude],
          ],
          {
            color: to.arriveBy === "flight" ? "#ec4899" : "#38bdf8",
            weight: 2,
            opacity: 0.55,
            dashArray: to.arriveBy === "flight" ? "6 6" : undefined,
          },
        ).addTo(map);
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
      tiles_ref.current = null;
    };
  }, [mapped]);

  useEffect(() => {
    tiles_ref.current?.setUrl(resolvedTheme === "dark" ? TILES.dark : TILES.light);
  }, [resolvedTheme]);

  useEffect(() => {
    for (const [id, marker] of markers_ref.current) {
      const is_active = id === activeId;
      marker.setStyle({ weight: is_active ? 3 : 1.5, fillOpacity: is_active ? 1 : 0.95 });
      marker.setRadius(is_active ? 9 : 6);
      if (is_active) marker.bringToFront();
    }
    const active = mapped.find((stop) => stop.id === activeId);
    if (active && map_ref.current) {
      map_ref.current.flyTo([active.latitude, active.longitude], Math.max(map_ref.current.getZoom(), 5), { duration: 0.6 });
    }
  }, [activeId, mapped]);

  return <div ref={container_ref} className="h-[420px] w-full rounded-md md:h-[560px]" />;
};
