import {
  CodeBracketIcon,
  CodeBracketSquareIcon,
  ComputerDesktopIcon,
  LanguageIcon,
  WifiIcon,
} from "@heroicons/react/24/solid";
import { FaBaby } from "@react-icons/all-files/fa/FaBaby";
import { FaGraduationCap } from "@react-icons/all-files/fa/FaGraduationCap";
import { SiAmazonaws } from "@react-icons/all-files/si/SiAmazonaws";
import { SiShopify } from "@react-icons/all-files/si/SiShopify";

export const TIMELINEOBJECT = {
  "2000": [
    {
      date: "2000-08-15",
      heading: "Born",
      description: "In Rio de Janeiro - Brazil",
      Icon: ({ className = "" }) => <FaBaby className={className} />,
    },
  ],
  "2007": [
    {
      date: "2007-05-01",
      heading: "Online",
      description: "My first contact with the internet, I used dial-up internet",
      Icon: ({ className = "" }) => <WifiIcon className={className} />,
    },
  ],
  "2009": [
    {
      date: "2009-07-13",
      heading: "First Computer",
      description: "My first home computer, my father got it from a friend",
      Icon: ({ className = "" }) => <ComputerDesktopIcon className={className} />,
    },
  ],
  "2015": [
    {
      date: "2015-02-03",
      heading: "First line of code",
      description: "My first line of code was developing a plugin for a java minecraft server",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
  ],
  "2017": [
    {
      date: "2017-01-01",
      heading: "Graduated High School",
      description: "I finished high school in my hometown",
      Icon: ({ className = "" }) => <FaGraduationCap className={className} />,
    },
  ],
  "2018": [
    {
      date: "2018-01-01",
      heading: "Coding Skills",
      description: "I continued to develop my knowledge of programming and did some freelance work",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
  ],
  "2019": [
    {
      date: "2019-01-01",
      heading: "Freelance development",
      description: "I developed a bot for twitch and other freelancers for foreigners",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
  ],
  "2020": [
    {
      date: "2020-02-01",
      heading: "Computer science degree",
      description: "I started the computer science course at Anhanguera University",
      Icon: ({ className = "" }) => <FaGraduationCap className={className} />,
    },
    {
      date: "2020-09-01",
      heading: "My online game server",
      description: "I set up an online Minecraft server together with friends, with unique systems and using good practices",
      Icon: ({ className = "" }) => <ComputerDesktopIcon className={className} />,
    },
  ],
  "2021": [
    {
      date: "2021-01-01",
      heading: "Freelance development",
      description: "I continued with freelance developments and some personal achievements",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
  ],
  "2022": [
    {
      date: "2022-01-01",
      heading: "Freelance development",
      description: "I continued with freelance development",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
    {
      date: "2022-03-01",
      heading: "Shopify webstore team",
      description: "I was part of the development team for some dropshipping stores on Shopify",
      Icon: ({ className = "" }) => <SiShopify className={className} />,
    },
  ],
  "2023": [
    {
      date: "2023-05-01",
      heading: "Compasso UOL",
      description:
        "I was hired by compasso as a backend developer and assigned to the PagBank team",
      Icon: ({ className = "" }) => <CodeBracketSquareIcon className={className} />,
    },
    {
      date: "2023-07-31",
      heading: "Learning English",
      description: "I started to deepen my knowledge of English",
      Icon: ({ className = "" }) => <LanguageIcon className={className} />,
    },
    {
      date: "2023-09-09",
      heading: "AWS Certified Cloud Practitioner",
      description: "I managed to get an AWS certification",
      Icon: ({ className = "" }) => <SiAmazonaws className={className} />,
    },
  ],
};
