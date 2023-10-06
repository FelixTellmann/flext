import FlextLogo from "public/logo.svg";

export const HEADER = {
  logo: {
    href: "/",
    title: <FlextLogo />,
    alt: "Mateus Neres Logo",
  },
  nav: [
    {
      href: "/",
      title: "Home",
      alt: "Country roads..",
      desktop: false,
    },
    {
      href: "/#about",
      title: "About",
      alt: "More about me.",
      desktop: true,
    },
    {
      href: "/#portfolio",
      title: "Portfolio",
      alt: "Work I've done.",
      desktop: true,
    },
    {
      href: "/resume",
      title: "Resume",
      alt: "My professional resume",
      desktop: true,
    },
  ],
  profileNav: [],
};
