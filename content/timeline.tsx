import { StarIcon } from "@heroicons/react/20/solid";
import { BookOpenIcon, BuildingOffice2Icon, CakeIcon, ChartBarIcon, CodeBracketIcon, CodeBracketSquareIcon, ComputerDesktopIcon, FireIcon, LanguageIcon, SignalIcon, UserCircleIcon, WifiIcon } from "@heroicons/react/24/solid";
import { AiOutlineDollar } from "@react-icons/all-files/ai/AiOutlineDollar";
import { BiGame } from "@react-icons/all-files/bi/BiGame";
import { BiSticker } from "@react-icons/all-files/bi/BiSticker";
import { FaBaby } from "@react-icons/all-files/fa/FaBaby";
import { FaChalkboardTeacher } from "@react-icons/all-files/fa/FaChalkboardTeacher";
import { FaGraduationCap } from "@react-icons/all-files/fa/FaGraduationCap";
import { FaPlaneDeparture } from "@react-icons/all-files/fa/FaPlaneDeparture";
import { FaQuestion } from "@react-icons/all-files/fa/FaQuestion";
import { FaTruck } from "@react-icons/all-files/fa/FaTruck";
import { FaTruckMoving } from "@react-icons/all-files/fa/FaTruckMoving";
import { GiAfrica } from "@react-icons/all-files/gi/GiAfrica";
import { GiBigDiamondRing } from "@react-icons/all-files/gi/GiBigDiamondRing";
import { GiOppositeHearts } from "@react-icons/all-files/gi/GiOppositeHearts";
import { GiShipBow } from "@react-icons/all-files/gi/GiShipBow";
import { GiSoccerBall } from "@react-icons/all-files/gi/GiSoccerBall";
import { GiSouthAfrica } from "@react-icons/all-files/gi/GiSouthAfrica";
import { GiSuspensionBridge } from "@react-icons/all-files/gi/GiSuspensionBridge";
import { GrRestaurant } from "@react-icons/all-files/gr/GrRestaurant";
import { IoMdRestaurant } from "@react-icons/all-files/io/IoMdRestaurant";
import { RiVirusLine } from "@react-icons/all-files/ri/RiVirusLine";
import { RiWalkFill } from "@react-icons/all-files/ri/RiWalkFill";
import { SiCoronaengine } from "@react-icons/all-files/si/SiCoronaengine";
import { SiShopify } from "@react-icons/all-files/si/SiShopify";
import { BsFillPatchQuestionFill } from "react-icons/all";

export const TIMELINEOBJECT = {
  "1986": [
    {
      date: "1986-01-08",
      heading: "Born",
      description: "In Viersen Germany, a few days early.",
      Icon: ({ className = "" }) => <FaBaby className={className} />,
    },
  ],
  "1996": [
    {
      date: "1996-06-01",
      heading: "Online",
      description:
        "I was fortunate to explore the internet at the age of 10 using a 28.9KBit modem. I was absolutely mind blown 🤯",
      Icon: ({ className = "" }) => <WifiIcon className={className} />,
    },
  ],
  "1997": [
    {
      date: "1997-01-01",
      heading: "First Computer",
      description:
        "My brother and I were building our first computer from scratch, using my stepdads old hardware and buying some new components. 133Mhz Pentium with 8mb ram 😂",
      Icon: ({ className = "" }) => <ComputerDesktopIcon className={className} />,
    },
    {
      date: "1997-06-01",
      heading: "First line of code",
      description:
        "My stepdad Franz thought me programming ⌨, building a calculator 🧮 and a racing game 👾 🏎 with Delphi and Pascal",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
  ],
  "1999": [
    {
      date: "1999-01-01",
      heading: "Visit to SF",
      description:
        "Exploring the tech world as a teenager. I bought a brand new Laser Mouse 🖱 at the Metreon downtown San Fransisco.",
      Icon: ({ className = "" }) => <GiSuspensionBridge className={className} />,
    },
    {
      date: "1999-05-01",
      heading: "Gaming",
      description:
        "I got into Gaming 🕹 and Lan Parties, playing Half-life, Diablo I & StarCraft (when not struggling to setup the 10MBit network)",
      Icon: ({ className = "" }) => <BiGame className={className} />,
    },
  ],
  "2000": [
    {
      date: "2000-01-01",
      heading: "Web development",
      description: "I build my first websites using MS FrontPage 98. Anyone remembers Frames? 🙃",
      Icon: ({ className = "" }) => <CodeBracketSquareIcon className={className} />,
    },
  ],
  "2001": [
    {
      date: "2001-01-01",
      heading: "Game Modding",
      description:
        "I got into game Modding and started experimenting, mostly with Counter Strike & the HL engine.",
      Icon: ({ className = "" }) => <SiCoronaengine className={className} />,
    },
  ],
  "2002": [
    {
      date: "2002-01-01",
      heading: "First Visit to SA",
      description:
        "I went to South Africa for the first time, visiting St Francis Bay on the Garden Route.",
      Icon: ({ className = "" }) => <GiAfrica className={className} />,
    },
  ],
  "2004": [
    {
      date: "2004-01-01",
      heading: "Graduated High School",
      description:
        "I completed my last three years at a High-school for Technology and Media in Germany and shortly after found myself working different jobs, trying to figure out what I wanted to do.",
      Icon: ({ className = "" }) => <FaGraduationCap className={className} />,
    },
  ],
  "2005": [
    {
      date: "2005-01-01",
      heading: "Lost Teenager",
      description:
        "After High school, I was totally lost in direction, thinking that my skills in game modding/web dev weren't any useful.",
      Icon: ({ className = "" }) => <FaQuestion className={className} />,
    },
  ],
  "2006": [
    {
      date: "2006-01-01",
      heading: "Second visit to SA",
      description:
        "I visited South Africa for the second time. This time, exploring Cape Town and I totally fell in love with it.",
      Icon: ({ className = "" }) => <GiSouthAfrica className={className} />,
    },
  ],
  "2007": [
    {
      date: "2007-01-01",
      heading: "Planning my Career",
      description:
        "This was a big step for me at the age of 21. I decided to take on a different career path, jumping straight into my other passion for food & hospitality, leaving the tech world as a hobby.",
      Icon: ({ className = "" }) => <GrRestaurant className={className} />,
    },
    {
      date: "2007-05-01",
      heading: "Move to South Africa",
      description:
        "I decided to pack up my things in Germany and start my Career in Hospitality in Cape Town, to gain international experience. ",
      Icon: ({ className = "" }) => <FaPlaneDeparture className={className} />,
    },
    {
      date: "2007-08-01",
      heading: "Learning English",
      description:
        "I took a deep dive into learning English within 3 months in South Africa, going from hating languages to 100% native.",
      Icon: ({ className = "" }) => <LanguageIcon className={className} />,
    },
  ],
  "2008": [
    {
      date: "2008-01-01",
      heading: "Short-term Study",
      description: "I started at the International Hotel School for a 6 month adjustment course.",
      Icon: ({ className = "" }) => <FaGraduationCap className={className} />,
    },
    {
      date: "2008-06-01",
      heading: "Germany vs South Africa",
      description: "I moved back to Germany in july 2008, to start an apprenticeship as a Chef.",
      Icon: ({ className = "" }) => <FaPlaneDeparture className={className} />,
    },
    {
      date: "2008-09-01",
      heading: "Financial Crisis",
      description:
        "My apprenticeship was cut short, as the establishment closed down as retrenching all apprentices as the Financial crisis hit Germany.",
      Icon: ({ className = "" }) => <GrRestaurant className={className} />,
    },
  ],
  "2009": [
    {
      date: "2009-01-01",
      heading: "Full-time Study",
      description:
        "I once again, moved back to South Africa. This time to stay for at least 3 years to study Cheffing & Hospitality full-time.",
      Icon: ({ className = "" }) => <BookOpenIcon className={className} />,
    },
  ],
  "2010": [
    {
      date: "2010-01-01",
      heading: "World Cup 2010",
      description:
        "It was amazing to be in Cape Town during the World Cup 2010 in SA. Germany vs Argentina - 4:0",
      Icon: ({ className = "" }) => <GiSoccerBall className={className} />,
    },
  ],
  "2011": [
    {
      date: "2011-09-01",
      heading: "Working on Cruise Line",
      description:
        "Spend 4 months traveling the seas onboard of the Yachts of Seabourn. Visited many countries in North America & The Caribbean while working as a Waiter.",
      Icon: ({ className = "" }) => <GiShipBow className={className} />,
    },
  ],
  "2012": [
    {
      date: "2012-06-01",
      heading: "Graduated Varsity",
      description:
        "I graduated with three Higher National Diplomas Summa Cum Laude, covering all aspects I needed to know to one day open my own restaurant",
      Icon: ({ className = "" }) => <FaGraduationCap className={className} />,
    },
    {
      date: "2012-06-01",
      heading: "Getting into Management",
      description:
        "I started as a waiter and got promoted shortly after to Assistant Restaurant Manager at Salt Restaurant. Developing some great connections.",
      Icon: ({ className = "" }) => <UserCircleIcon className={className} />,
    },
  ],
  "2013": [
    {
      date: "2013-06-01",
      heading: "Kitima Restaurant",
      description:
        "Joined the Best Asian Restaurant in South Africa as a Restaurant Manager overseeing a team of 50 employees.",
      Icon: ({ className = "" }) => <IoMdRestaurant className={className} />,
    },
    {
      date: "2013-09-01",
      heading: "Training & Development",
      description:
        "I took on a specialized role focusing on training & development of the team to reach their full potential.",
      Icon: ({ className = "" }) => <FaChalkboardTeacher className={className} />,
    },
  ],
  "2014": [
    {
      date: "2014-01-01",
      heading: "Reconnecting the dots",
      description:
        "I was exposed to a lot of IT & Web dev work for the restaurant. I reconnected a lot of my teenage skill with IT and learned more about POS systems.",
      Icon: ({ className = "" }) => <GiOppositeHearts className={className} />,
    },
    {
      date: "2014-06-01",
      heading: "Personal Website",
      description:
        "I decided to build my site with WordPress, showing a gallery and info about me. Unfortunately, I didn't use Git yet and lost the source code on a old HDD.",
      Icon: ({ className = "" }) => <ComputerDesktopIcon className={className} />,
    },
  ],
  "2015": [
    {
      date: "2015-01-01",
      heading: "Restaurant Consultant",
      description:
        "I left my full-time position early in 2015 to focus on a Postgraduate diploma at UCT. I continued my work in a Consulting Role.",
      Icon: ({ className = "" }) => <UserCircleIcon className={className} />,
    },
    {
      date: "2015-03-01",
      heading: "Co-founded SimplyStuck",
      description:
        "Started a Vinyl sticker business, while exploring the very interesting customer segment of students 👨‍ 🎓 It was part study, part real business, but somehow eventually faded & failed as we had a team of 6 co-founders. Stick to 1 or 2 if you can. 😉",
      Icon: ({ className = "" }) => <BiSticker className={className} />,
    },
    {
      date: "2015-05-01",
      heading: "Got Engaged",
      description:
        "I asked my then girlfriend, Elizabeth, to marry me. She said yes! I took her out for a super romantic dinner and popped the question in a full restaurant.",
      Icon: ({ className = "" }) => <GiBigDiamondRing className={className} />,
    },
    {
      date: "2015-08-01",
      heading: "Graduated Postgraduate at UCT",
      description:
        "I went back to University in 2015 to advance with a Postgraduate Diploma in Business Management & Entrepreneurship. 📚 👓",
      Icon: ({ className = "" }) => <FaGraduationCap className={className} />,
    },
    {
      date: "2015-12-01",
      heading: "Got Married",
      description:
        "If this Year wasn't enough. Liz and I decided to have a small ceremony with the closes friends & family at a beautiful wine farm in Cape Town.",
      Icon: ({ className = "" }) => <GiBigDiamondRing className={className} />,
    },
  ],
  "2016": [
    {
      date: "2016-01-01",
      heading: "Opening a Restaurant",
      description:
        "After graduation, I got straight back to work. This time as General Manager, opening a brand new Restaurant in Cape Town (for a private investor)",
      Icon: ({ className = "" }) => <IoMdRestaurant className={className} />,
    },
    {
      date: "2016-03-01",
      heading: "Project Management & IT",
      description:
        "I opened Raya Kitchen over 2 months including construction and hiring a new team from scratch, and setting the POS & IT operations.",
      Icon: ({ className = "" }) => <ChartBarIcon className={className} />,
    },
    {
      date: "2016-06-01",
      heading: "Coding Skills",
      description:
        "I pursued my interests in web development & tech professionally. I did a deep dive completing the FreeCodeCamp Front-end & Back-end Certifications.",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
    {
      date: "2016-06-01",
      heading: "Tech + Restaurant",
      description:
        "I started Smart-up Online. An online training platform/SaaS for restaurant owners & managers to train their staff.",
      Icon: ({ className = "" }) => <StarIcon className={className} />,
    },
  ],
  "2017": [
    {
      date: "2017-05-01",
      heading: "Food Truck, almost.",
      description:
        "My Wife and I were both getting excited to start our own Food Truck and planned out all the details. However, the stars were not aligned for it. We shall get back to it!!",
      Icon: ({ className = "" }) => <FaTruck className={className} />,
    },
    {
      date: "2017-06-01",
      heading: "Full-time Web Development",
      description:
        "I found my first clients to work on the side, which quickly grew to full-time freelancing occupation, where I got hooked on React.js",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
    {
      date: "2017-08-01",
      heading: "Shopify Dev",
      description: "Partnered up to start a small Shopify E-commerce web design studio.",
      Icon: ({ className = "" }) => <SiShopify className={className} />,
    },
  ],
  "2018": [
    {
      date: "2018-01-01",
      heading: "First Custom Project",
      description:
        "I've built AlphabetPIX for a client as my first web-app, learning tons on a new tech domain.",
      Icon: ({ className = "" }) => <CodeBracketSquareIcon className={className} />,
    },
    {
      date: "2018-02-01",
      heading: "Move to Knysna",
      description:
        "My Wife and I made the decision to move to Knysna on the Garden Route to open a Restaurant.",
      Icon: ({ className = "" }) => <FaTruckMoving className={className} />,
    },
    {
      date: "2018-05-01",
      heading: "Start-up Funding",
      description:
        "The first experience acquiring start-up funding for our restaurant. You gotta move early and fast, as everyone else will slow you down.",
      Icon: ({ className = "" }) => <AiOutlineDollar className={className} />,
    },
    {
      date: "2018-05-01",
      heading: "The Burger Exchange",
      description:
        "Its always been a dream Now we took the steps to make it a reality. A 200 seater Restaurant with our own concept of a trendy upmarket Burger Joint.",
      Icon: ({ className = "" }) => <IoMdRestaurant className={className} />,
    },
  ],
  "2019": [
    {
      date: "2019-05-01",
      heading: "Namibia Holidays",
      description:
        "We survived our first holiday season at the restaurant and took a one week holiday which was simply mind blowing.",
      Icon: ({ className = "" }) => <GiAfrica className={className} />,
    },
    {
      date: "2019-05-01",
      heading: "Restaurant Upgrade",
      description:
        "We upgraded the concept to the fit market environment & shifted focus to also include a variety of wood fired grills. 🥩🔥",
      Icon: ({ className = "" }) => <IoMdRestaurant className={className} />,
    },
    {
      date: "2019-05-01",
      heading: "Smart-Up 2.0",
      description:
        "I took a data driven approach to create new training material for Smart-Up Online, and to use internally at the restaurant. Including a deep dive into MySQL & Oracle DB.",
      Icon: ({ className = "" }) => <FireIcon className={className} />,
    },
  ],
  "2020": [
    {
      date: "2020-01-01",
      heading: "Season 2",
      description:
        "We grew the restaurant consistently, with the best season and a blast of a staff party to finish off the holiday times.",
      Icon: ({ className = "" }) => <ChartBarIcon className={className} />,
    },
    {
      date: "2020-02-01",
      heading: "Covid 19",
      description:
        "From a successful restaurant to closing our doors in a matter of weeks. Its been a great journey, the uncertainty of corona and the lockdown have clarified major life-changing questions. Answering them became easy overnight.",
      Icon: ({ className = "" }) => <RiVirusLine className={className} />,
    },
    {
      date: "2020-04-01",
      heading: "Back to Web Dev",
      description:
        "I restarted my freelancing Web dev and got back in touch with clients, jumping into the booming ecommerce train.",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
    {
      date: "2020-07-01",
      heading: "felixtellmann.com",
      description:
        "Finally after a few months of design & redesigns, and other projects in the background, I got my new (now old) page up and running.",
      Icon: ({ className = "" }) => <ComputerDesktopIcon className={className} />,
    },
  ],
  "2021": [
    {
      date: "2021-01-01",
      heading: "Dev tools",
      description:
        "I created created and maintain two open source dev tools: fx-style and shopify-ftp-access.",
      Icon: ({ className = "" }) => <CodeBracketSquareIcon className={className} />,
    },
    {
      date: "2021-04-01",
      heading: "Otter Trail",
      description:
        "I went on a 5 day adventure hike carrying 15kg of gear & provisions for 45km on the Garden Route",
      Icon: ({ className = "" }) => <RiWalkFill className={className} />,
    },
    {
      date: "2021-06-01",
      heading: "New Office",
      description:
        "We moved into our new office on Bree street with a stunning balcony and some great neighbours.",
      Icon: ({ className = "" }) => <BuildingOffice2Icon className={className} />,
    },
    {
      date: "2021-08-01",
      heading: "ClickUpload",
      description:
        "I lead the creation of ClickUpload, a public Shopify app that allows users to upload files with their orders.",
      Icon: ({ className = "" }) => <SiShopify className={className} />,
    },
    {
      date: "2021-11-01",
      heading: "shopify-typed-node-api",
      description:
        "I upgraded shopify-node-api to be fully typesafe and published it as an alternative to the non TS version.",
      Icon: ({ className = "" }) => <CodeBracketIcon className={className} />,
    },
    {
      date: "2021-02-01",
      heading: "Backend API integrations",
      description:
        "Over the year I got heavily involved in some backend custom integrations, building solutions with AWS for our clients.",
      Icon: ({ className = "" }) => <StarIcon className={className} />,
    },
  ],
  "2022": [
    {
      date: "2022-01-01",
      heading: "Lunalemon",
      description:
        "We've launched LunaLemon as a brand to reach a more international audience for app & headless ecommerce solutions.",
      Icon: ({ className = "" }) => <ComputerDesktopIcon className={className} />,
    },
    {
      date: "2022-02-01",
      heading: "LunaTag",
      description:
        "The second Shopify App that's published in the App store allows marchants to Tag their product on any image on their store.",
      Icon: ({ className = "" }) => <SiShopify className={className} />,
    },
    {
      date: "2022-02-01",
      heading: "Shopify-cms",
      description:
        "I always wanted to create a Shopify Theme that was fully React based, I finally figured it out and build shopify-cms along the way.",
      Icon: ({ className = "" }) => <CodeBracketSquareIcon className={className} />,
    },
  ],
};
