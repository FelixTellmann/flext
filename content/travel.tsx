export type TravelStopKind = "city" | "park" | "friends";

export type TravelArrival = "flight" | "road" | "rail";

export type TravelStop = {
  id: string;
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  /** Local wall-clock, treated as UTC so the timeline reads the same in every browser. */
  arriveAt: string;
  departAt: string;
  kind: TravelStopKind;
  arriveBy: TravelArrival;
  /** Public detail only. Confirmation numbers and tickets stay behind admin auth, never in this module. */
  lodging?: { name: string; bookedOn?: string };
  /** Banner image under public/images/travel/, center-cropped to 3:1. Credit names the Commons author and license. */
  image?: { src: string; alt: string; credit: string };
  note?: string;
};

export type TravelQuestion = { question: string; detail: string };

export type TravelTrip = {
  /** Date-led so trips sort and read chronologically: "2026-09-united-states". */
  slug: string;
  title: string;
  pre: string;
  intro: string;
  startsAt: string;
  endsAt: string;
  stops: TravelStop[];
  openQuestions: TravelQuestion[];
};

const UNITED_STATES_2026_STOPS: TravelStop[] = [
  {
    id: "cape-town-out",
    name: "Cape Town",
    region: "South Africa",
    latitude: -33.97,
    longitude: 18.6,
    arriveAt: "2026-09-14T00:00",
    departAt: "2026-09-14T19:50",
    kind: "city",
    arriveBy: "road",
    image: {
      src: "/images/travel/cape-town.jpg",
      alt: "Table Mountain across the bay",
      credit: "Photo: Danie van der Merwe (CC BY 2.0)",
    },
    note: "Flight UA2222 to Newark, departing 19:50.",
  },
  {
    id: "new-york",
    name: "New York",
    region: "Arriving Newark EWR",
    latitude: 40.75,
    longitude: -73.99,
    arriveAt: "2026-09-15T05:20",
    departAt: "2026-09-25T07:41",
    kind: "friends",
    arriveBy: "flight",
    image: {
      src: "/images/travel/new-york.jpg",
      alt: "Lower Manhattan skyline",
      credit: "Photo: King of Hearts (CC BY-SA 4.0)",
    },
    note: "Ten nights with friends. Leaving from Penn Station.",
  },
  {
    id: "boston",
    name: "Boston",
    region: "Back Bay Station",
    latitude: 42.35,
    longitude: -71.08,
    arriveAt: "2026-09-25T11:59",
    departAt: "2026-09-29T07:55",
    kind: "friends",
    arriveBy: "rail",
    image: {
      src: "/images/travel/boston.jpg",
      alt: "Boston skyline from the Charles River",
      credit: "Photo: King of Hearts (CC BY-SA 4.0)",
    },
    note: "Four nights with friends, then Delta 499 west to Denver.",
  },
  {
    id: "denver",
    name: "Denver",
    region: "Colorado",
    latitude: 39.74,
    longitude: -104.99,
    arriveAt: "2026-09-29T10:40",
    departAt: "2026-09-29T11:40",
    kind: "city",
    arriveBy: "flight",
    image: {
      src: "/images/travel/denver.jpg",
      alt: "Denver skyline with Mount Evans behind",
      credit: "Photo: David Herrera (CC BY 2.0)",
    },
    lodging: { name: "Avis one-way rental, drop-off in Las Vegas" },
    note: "Land at 10:40, collect the car, and drive south-west into the Rockies.",
  },
  {
    id: "telluride",
    name: "Telluride",
    region: "Colorado Rockies",
    latitude: 37.94,
    longitude: -107.81,
    arriveAt: "2026-09-29T18:00",
    departAt: "2026-10-04T09:00",
    kind: "friends",
    arriveBy: "road",
    image: {
      src: "/images/travel/telluride.jpg",
      alt: "Telluride in its box canyon",
      credit: "Photo: Daniel Ribar (CC0)",
    },
    note: "Five nights with friends. Buy the America the Beautiful annual pass before reaching Arches.",
  },
  {
    id: "arches",
    name: "Arches National Park",
    region: "Utah",
    latitude: 38.6166,
    longitude: -109.6188,
    arriveAt: "2026-10-04T12:00",
    departAt: "2026-10-04T18:00",
    kind: "park",
    arriveBy: "road",
    image: {
      src: "/images/travel/arches.jpg",
      alt: "Red rock arches at Arches National Park",
      credit: "Photo: Luca Galuzzi (CC BY-SA 2.5)",
    },
    note: "Afternoon in the park after the drive from Telluride.",
  },
  {
    id: "moab",
    name: "Moab",
    region: "Utah",
    latitude: 38.5733,
    longitude: -109.5498,
    arriveAt: "2026-10-04T18:00",
    departAt: "2026-10-05T09:30",
    kind: "city",
    arriveBy: "road",
    image: {
      src: "/images/travel/moab.jpg",
      alt: "La Sal Mountains behind Moab's red rock",
      credit: "Photo: RichieB_pics (CC BY 2.0)",
    },
    lodging: { name: "La Quinta by Wyndham Moab", bookedOn: "2026-06-20" },
  },
  {
    id: "canyonlands",
    name: "Canyonlands National Park",
    region: "Island in the Sky",
    latitude: 38.459,
    longitude: -109.8206,
    arriveAt: "2026-10-05T09:30",
    departAt: "2026-10-05T13:30",
    kind: "park",
    arriveBy: "road",
    image: {
      src: "/images/travel/canyonlands.jpg",
      alt: "Mesa Arch at sunrise",
      credit: "Photo: Thomas Wolf (CC BY-SA 3.0)",
    },
    note: "Morning on the Island in the Sky mesa before heading west.",
  },
  {
    id: "capitol-reef",
    name: "Capitol Reef National Park",
    region: "Waterpocket Fold",
    latitude: 38.2914,
    longitude: -111.2615,
    arriveAt: "2026-10-05T13:30",
    departAt: "2026-10-05T17:30",
    kind: "park",
    arriveBy: "road",
    image: {
      src: "/images/travel/capitol-reef.jpg",
      alt: "Waterpocket Fold cliffs",
      credit: "Photo: Murray Foubister (CC BY-SA 2.0)",
    },
  },
  {
    id: "torrey",
    name: "Torrey",
    region: "Utah, by Capitol Reef",
    latitude: 38.2994,
    longitude: -111.4197,
    arriveAt: "2026-10-05T17:30",
    departAt: "2026-10-06T11:00",
    kind: "city",
    arriveBy: "road",
    image: {
      src: "/images/travel/torrey.jpg",
      alt: "Red cliffs near Torrey",
      credit: "Photo: Tracy Zhang (CC0)",
    },
    lodging: { name: "Red Sands Hotel & Spa", bookedOn: "2026-06-20" },
  },
  {
    id: "bryce-canyon",
    name: "Bryce Canyon National Park",
    region: "Utah",
    latitude: 37.6404,
    longitude: -112.1696,
    arriveAt: "2026-10-06T11:30",
    departAt: "2026-10-06T18:00",
    kind: "park",
    arriveBy: "road",
    image: {
      src: "/images/travel/bryce-canyon.jpg",
      alt: "Bryce Canyon amphitheater hoodoos",
      credit: "Photo: Jon Zander (CC BY-SA 3.0)",
    },
    note: "Scenic Byway 12 over Boulder Mountain on the way in.",
  },
  {
    id: "bryce-canyon-city",
    name: "Bryce Canyon City",
    region: "Utah",
    latitude: 37.6737,
    longitude: -112.1567,
    arriveAt: "2026-10-06T18:00",
    departAt: "2026-10-07T09:00",
    kind: "city",
    arriveBy: "road",
    image: {
      src: "/images/travel/bryce-canyon-city.jpg",
      alt: "Hoodoos in Red Canyon on Scenic Byway 12",
      credit: "Photo: US National Archives (Public domain)",
    },
    lodging: { name: "Bryce View Lodge, Ruby's Inn Resort", bookedOn: "2026-06-20" },
  },
  {
    id: "zion",
    name: "Zion National Park",
    region: "Zion Canyon",
    latitude: 37.2005,
    longitude: -112.9878,
    arriveAt: "2026-10-07T12:00",
    departAt: "2026-10-07T18:00",
    kind: "park",
    arriveBy: "road",
    image: {
      src: "/images/travel/zion.jpg",
      alt: "First sun on the Watchman in Zion",
      credit: "Photo: Don Graham (CC BY-SA 2.0)",
    },
  },
  {
    id: "springdale",
    name: "Springdale",
    region: "Utah, at Zion's gate",
    latitude: 37.1889,
    longitude: -112.9989,
    arriveAt: "2026-10-07T18:00",
    departAt: "2026-10-09T09:00",
    kind: "city",
    arriveBy: "road",
    image: {
      src: "/images/travel/springdale.jpg",
      alt: "Springdale beneath Zion's cliffs",
      credit: "Photo: Jared (CC BY 2.0)",
    },
    lodging: { name: "SpringHill Suites by Marriott", bookedOn: "2026-06-20" },
    note: "Both nights here, with the full day of 8 October back in Zion.",
  },
  {
    id: "valley-of-fire",
    name: "Valley of Fire",
    region: "Nevada state park",
    latitude: 36.4297,
    longitude: -114.5139,
    arriveAt: "2026-10-09T11:30",
    departAt: "2026-10-09T13:30",
    kind: "park",
    arriveBy: "road",
    image: {
      src: "/images/travel/valley-of-fire.jpg",
      alt: "Aztec sandstone in Valley of Fire",
      credit: "Photo: Bernard Spragg (CC0)",
    },
    note: "Red-rock detour off I-15, then the Northshore Road along Lake Mead towards Hoover Dam.",
  },
  {
    id: "hoover-dam",
    name: "Hoover Dam",
    region: "Nevada state line",
    latitude: 36.016,
    longitude: -114.737,
    arriveAt: "2026-10-09T14:30",
    departAt: "2026-10-09T16:00",
    kind: "park",
    arriveBy: "road",
    image: {
      src: "/images/travel/hoover-dam.jpg",
      alt: "Hoover Dam in Black Canyon",
      credit: "Photo: Christian David (CC BY-SA 4.0)",
    },
  },
  {
    id: "las-vegas",
    name: "Las Vegas",
    region: "Nevada",
    latitude: 36.17,
    longitude: -115.14,
    arriveAt: "2026-10-09T17:00",
    departAt: "2026-10-11T23:55",
    kind: "city",
    arriveBy: "road",
    image: {
      src: "/images/travel/las-vegas.jpg",
      alt: "Aerial view of the Las Vegas Strip",
      credit: "Photo: Carol M. Highsmith (Public domain)",
    },
    lodging: { name: "MGM Grand", bookedOn: "2026-06-20" },
    note: "Drop the one-way rental, then two nights before flight UA284 east at 23:55.",
  },
  {
    id: "washington",
    name: "Washington DC",
    region: "Arriving Dulles IAD",
    latitude: 38.95,
    longitude: -77.45,
    arriveAt: "2026-10-12T07:28",
    departAt: "2026-10-15T18:45",
    kind: "friends",
    arriveBy: "flight",
    image: {
      src: "/images/travel/washington.jpg",
      alt: "Aerial view of the National Mall",
      credit: "Photo: Mario Roberto Durán Ortiz (CC BY-SA 4.0)",
    },
    note: "Three nights with friends before flight UA1011 home.",
  },
  {
    id: "cape-town-home",
    name: "Cape Town",
    region: "Home",
    latitude: -33.97,
    longitude: 18.6,
    arriveAt: "2026-10-16T15:20",
    departAt: "2026-10-18T00:00",
    kind: "city",
    arriveBy: "flight",
    image: {
      src: "/images/travel/cape-town.jpg",
      alt: "Table Mountain across the bay",
      credit: "Photo: Danie van der Merwe (CC BY 2.0)",
    },
  },
];

const UNITED_STATES_2026_QUESTIONS: TravelQuestion[] = [];

const UNITED_STATES_2026: TravelTrip = {
  slug: "2026-09-united-states",
  title: "Five weeks across the United States",
  pre: "14 September – 16 October 2026",
  intro:
    "Cape Town to New York, up to Boston, then a drive from Denver through the Colorado Rockies and five Utah national parks to Las Vegas, finishing in Washington DC.",
  startsAt: "2026-09-14T00:00",
  endsAt: "2026-10-16T16:00",
  stops: UNITED_STATES_2026_STOPS,
  openQuestions: UNITED_STATES_2026_QUESTIONS,
};

/** Newest first. Add future trips here; every route reads this collection. */
export const TRIPS: TravelTrip[] = [UNITED_STATES_2026];

export const findTrip = (slug: string) => TRIPS.find((trip) => trip.slug === slug);
