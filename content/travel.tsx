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
    note: "Ten nights with friends. Doveras retreat held for 21–22 September. Leaving from Penn Station.",
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
    lodging: { name: "Avis rental car pickup" },
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
    note: "Five nights with friends. Buy the America the Beautiful annual pass before reaching Arches.",
  },
  {
    id: "arches",
    name: "Arches",
    region: "Moab, Utah",
    latitude: 38.57,
    longitude: -109.55,
    arriveAt: "2026-10-04T12:00",
    departAt: "2026-10-05T09:30",
    kind: "park",
    arriveBy: "road",
    lodging: { name: "La Quinta by Wyndham Moab", bookedOn: "2026-06-20" },
  },
  {
    id: "canyonlands",
    name: "Canyonlands",
    region: "Island in the Sky",
    latitude: 38.33,
    longitude: -109.86,
    arriveAt: "2026-10-05T09:30",
    departAt: "2026-10-05T13:30",
    kind: "park",
    arriveBy: "road",
    note: "Morning visit before heading west to Capitol Reef.",
  },
  {
    id: "capitol-reef",
    name: "Capitol Reef",
    region: "Waterpocket Fold",
    latitude: 38.37,
    longitude: -111.26,
    arriveAt: "2026-10-05T13:30",
    departAt: "2026-10-05T18:00",
    kind: "park",
    arriveBy: "road",
    note: "Afternoon stop, then Scenic Byway 12 south to Boulder.",
  },
  {
    id: "boulder-ut",
    name: "Boulder",
    region: "Utah, on Byway 12",
    latitude: 37.91,
    longitude: -111.42,
    arriveAt: "2026-10-05T18:00",
    departAt: "2026-10-06T11:30",
    kind: "city",
    arriveBy: "road",
    lodging: { name: "Booking.com reservation", bookedOn: "2026-06-20" },
    note: "The one confirmation I could not place is Red Sands Hotel, which is in Kanab rather than Boulder.",
  },
  {
    id: "bryce-canyon",
    name: "Bryce Canyon",
    region: "Utah",
    latitude: 37.59,
    longitude: -112.19,
    arriveAt: "2026-10-06T11:30",
    departAt: "2026-10-07T12:00",
    kind: "park",
    arriveBy: "road",
    lodging: { name: "Bryce View Lodge, Ruby's Inn Resort", bookedOn: "2026-06-20" },
  },
  {
    id: "zion",
    name: "Zion",
    region: "Springdale, Utah",
    latitude: 37.3,
    longitude: -113.03,
    arriveAt: "2026-10-07T12:00",
    departAt: "2026-10-09T09:00",
    kind: "park",
    arriveBy: "road",
    lodging: { name: "SpringHill Suites by Marriott, Springdale", bookedOn: "2026-06-20" },
  },
  {
    id: "hoover-dam",
    name: "Hoover Dam",
    region: "Nevada state line",
    latitude: 36.02,
    longitude: -114.74,
    arriveAt: "2026-10-09T11:30",
    departAt: "2026-10-09T13:00",
    kind: "city",
    arriveBy: "road",
    note: "Late-morning stop on the way into Las Vegas.",
  },
  {
    id: "las-vegas",
    name: "Las Vegas",
    region: "Nevada",
    latitude: 36.17,
    longitude: -115.14,
    arriveAt: "2026-10-09T14:00",
    departAt: "2026-10-11T23:55",
    kind: "city",
    arriveBy: "road",
    lodging: { name: "MGM Grand", bookedOn: "2026-06-20" },
    note: "Two nights, then flight UA284 east at 23:55.",
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
  },
];

const UNITED_STATES_2026_QUESTIONS: TravelQuestion[] = [
  {
    question: "Which hotel is the Boulder, Utah night?",
    detail:
      "The 5 October night is a Booking.com reservation for Boulder, but the only unplaced confirmation is Red Sands Hotel in Kanab, roughly two hours south and on the far side of Bryce.",
  },
  {
    question: "Where does the Avis car go back?",
    detail: "Collected at Denver airport on 29 September, and the onward flight leaves Las Vegas, so this looks like a one-way drop.",
  },
  {
    question: "Is the MGM Grand booking still live?",
    detail:
      "An invalid-card warning arrived on 20 June and the card was updated on 21 June, but the reservation was never explicitly reconfirmed.",
  },
  {
    question: "Nothing booked for Washington DC?",
    detail:
      "Four nights from 12 October with no reservation in any mailbox, which fits staying with friends as in New York, Boston and Telluride.",
  },
];

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
