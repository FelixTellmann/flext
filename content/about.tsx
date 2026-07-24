const DontBeADick = "/images/about/dont-be-a-dick.jpg";
const HikingProfile = "/images/about/profile-lionshead.jpg";
const Namibia = "/images/about/namibia.jpg";
const QuadBike = "/images/about/quadbike.jpg";
const AlphaBackpack = "/images/about/alpha-backpack.jpg";
const ChristmasInWilderness = "/images/about/christmas-wilderness.jpg";
const Ottertrail = "/images/about/ottertrail.jpg";
const Running = "/images/about/running.jpg";
const Restaurant = "/images/about/restaurant.jpg";
const RestaurantDiy = "/images/about/restaurant-diy.jpg";
const Wedding = "/images/about/wedding.jpg";
const AlphaLionshead = "/images/about/alpha-mountain.jpg";
const Kirstenbosch = "/images/about/kirstenbosch.jpg";
const Camping = "/images/about/camping.jpg";
const GreatIdeas = "/images/about/great-ideas.jpg";
const Desert = "/images/about/desert.jpg";
const AdelphiFamily = "/images/about/profile-adelphi.jpg";

export const ABOUT = {
  stats: [
    {
      statistic: `${new Date(Date.now() - new Date("1986-01-08T01:30:00").getTime()).getFullYear() - 1970}`,
      tooltip: `${Math.round((Date.now() - new Date("1986-01-08T01:30:00").getTime()) / 1000)} seconds`,
      caption: "Years Old",
    },
    {
      statistic: "10+",
      tooltip: "First line of code written in 1997",
      caption: "Years Web Dev",
    },
    {
      statistic: "1",
      tooltip: "Who also loves running.",
      caption: "Amazing dog",
    },
    {
      statistic: "3149",
      tooltip: "111 GitHub Stars",
      caption: "Commits",
    },
  ],
  description: (
    <>
      <p>
        I'm a Cape Town based Web Developer and Entrepreneur. My focus area for the past few years has been front-end development with{" "}
        <strong>Next.js</strong>, <strong>Typescript</strong> and <strong>TailwindCSS</strong> to create beautiful user- and developer
        experiences that bring delight.
      </p>
      <p>
        I’ve spent most of my life deeply interested in technology and food, continuously building things with both. As a teenager, I was a
        classic computer nerd, spending most of my times messing with the computer, doing 1 of 4 things: Modding games and figuring things
        out. Tinkering with hardware, building computers. Developing websites with FrontPage 98 and Flash. And of course, playing games.
      </p>
      <p>Most of that is still true today.</p>
    </>
  ),
  images: [
    {
      src: DontBeADick,
      alt: "With Liz and Alpha at House of the Machines",
    },
    {
      src: HikingProfile,
      alt: "Hiking up the slopes of Table mountain with Lions-head in the background",
    },
    {
      src: Namibia,
      alt: "Overseeing the desert in Namibia.",
    },
    {
      src: QuadBike,
      alt: "Driving quadbike in the dunes of Swakopmund.",
    },
    {
      src: AlphaBackpack,
      alt: "Hiking for 33km over Table mountain and giving Alpha a little rest in the backpack.",
    },
    {
      src: ChristmasInWilderness,
      alt: "Family Friends posing for Christmas in Wilderness, SA.",
    },
    {
      src: Ottertrail,
      alt: "Reflection of our 5 day hike with a beautiful water shot.",
    },
    {
      src: Running,
      alt: "Running down the slopes in Newlands forest.",
    },
    {
      src: Restaurant,
      alt: "Our Restaurant that we had in Knysna, The Exchange, woodfired Grill.",
    },
    {
      src: RestaurantDiy,
      alt: "DIY upgrading our restaurant, including soundproofing.",
    },
    {
      src: Wedding,
      alt: "Walking down the isle for our wedding.",
    },
    {
      src: AlphaLionshead,
      alt: "Alpha smiling on top of Lions head",
    },
    {
      src: Kirstenbosch,
      alt: "Christmas carols in Kirstenbosch, Newlands.",
    },
    {
      src: Camping,
      alt: "Camping at Addo Elephant national Park.",
    },
    {
      src: GreatIdeas,
      alt: "Reading a new book in a Jacuzzi in Cederkloof, Citrusdal.",
    },
    {
      src: Desert,
      alt: "Standing in the desert in Namibia.",
    },
    {
      src: AdelphiFamily,
      alt: "Family pic in our home in Vredehoek, Cape Town.",
    },
  ],
};
