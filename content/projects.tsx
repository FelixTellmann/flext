import { TECH } from "content/tech-stack";
import ChatGPTStyle from "../public/images/projects/ChatGPTStyle.jpg";
import Futurium from "../public/images/projects/Futurium.png";
import WorkSo from "../public/images/projects/WorkSo.png";
import ByteChat from "../public/images/projects/Bytechat.png";
import VibeDePet from "../public/images/projects/VibedePet.jpg";
import CobyBot from "../public/images/projects/Cobybot.jpg";
import TuroRobot from "../public/images/projects/TuroRobot.png";
import InstaRobot from "../public/images/projects/InstaRobot.jpeg";
import PixPayView from "../public/images/projects/PixPayView.png";
import StockManger from "../public/images/projects/StockManager.png";
import Game2048 from "../public/images/projects/Game2048.png";
import SearchApartments from "../public/images/projects/SearchApartments.png";
import PvPUtils from "../public/images/projects/DragonPvP.jpg";

export const PROJECTS = [
  {
    name: "CobyBot",
    type: ["Application"],
    tech: [TECH.javascript, TECH.jest, TECH.aws, TECH.express],
    year: "2023",
    url: "https://cobybot.com/",
    description:
      "Coby is a virtual assistant for WhatsApp that aims to serve and help everyone who needs it, using the OpenAI API.",
    featuredImage: CobyBot,
  },
  {
    name: "StockManager",
    type: ["Application"],
    tech: [TECH.java, TECH.gradle, TECH.swing, TECH.lombok, TECH.gson, TECH.mysql],
    year: "2023",
    repository: "https://github.com/mateusneresrb/stockmanager",
    description:
      "The project was a work for the OOP 2 (Object-Oriented Programming 2) course at the university. I developed a stock management system in Java using Swing. It includes authentication and saves data in a database.",
    featuredImage: StockManger,
  },
  {
    name: "ByteChat",
    type: ["Application"],
    tech: [TECH.java, TECH.gradle, TECH.swing, TECH.lombok, TECH.gson],
    year: "2023",
    repository: "https://github.com/mateusneresrb/bytechat",
    description:
      "The project involves the development of an application for the distributed systems course, so I developed a real-time chat system using sockets and Swing for all the visual parts.",
    featuredImage: ByteChat,
  },
  {
    name: "ChatGPT Style",
    type: ["Integrations"],
    tech: [TECH.html_5, TECH.javascript, TECH.css_3],
    year: "2023",
    url: "https://chrome.google.com/webstore/detail/chatgpt-style/ooefjbdchgdlfeigfhigjpffppdklnef",
    repository: "https://github.com/mateusneresrb/chatgpt-style",
    description:
      "It’s a browser extension for browsers based on the Chrome engine, which allows you to modify the styling of ChatGPT",
    featuredImage: ChatGPTStyle,
  },
  {
    name: "PixPayView",
    type: ["API's"],
    tech: [TECH.java, TECH.spring, TECH.mysql, TECH.postman],
    year: "2023",
    repository: "https://github.com/mateusneresrb/pixpayview-backend",
    description:
      "I developed the backend of an application that allowed employers to give permission for employees to generate PIX payment QR-Codes and view when the purchase was approved, using the Mercado Pago API.",
    featuredImage: PixPayView,
  },
  {
    name: "2048 Game",
    type: ["Terminal"],
    tech: [TECH.java, TECH.git, TECH.lombok],
    year: "2022",
    repository: "https://github.com/mateusneresrb/Game_2048",
    description:
      "I developed the 2048 game as a project for the OOP (Object-Oriented Programming) course at the university, managing to bring a friendly appearance, even though it was in the terminal.",
    featuredImage: Game2048,
  },
  {
    name: "WorkSo",
    type: ["Terminal"],
    tech: [TECH.java, TECH.git, TECH.lombok],
    year: "2022",
    repository: "https://github.com/mateusneresrb/WorkSo",
    description:
      "In this project, the goal was to simulate scheduling algorithms for the operating systems course at the university. I developed the system in Java with a user-friendly interface in the terminal.",
    featuredImage: WorkSo,
  },
  {
    name: "Futurium",
    type: ["Integrations"],
    tech: [TECH.java, TECH.html_5, TECH.mysql, TECH.aws, TECH.redis],
    year: "2021",
    url: "https://futurium.com.br/",
    description:
      "I actively worked as the development leader of this server and developed dozens of crucial systems for it.",
    featuredImage: Futurium,
  },
  {
    name: "Vibe de Pet",
    type: ["Ecommerce Sites"],
    tech: [TECH.shopify, TECH.javascript, TECH.sass],
    year: "2021",
    description:
      "I was part of the development team for this e-commerce for pets, working specifically on the frontend in the conception of the theme.",
    featuredImage: VibeDePet,
  },
  {
    name: "TuroRobot",
    type: ["Integrations"],
    tech: [TECH.java, TECH.selenium, TECH.chrome, TECH.git],
    year: "2020",
    description:
      "It’s an automation performed in Java that facilitates rentals on the Turo site, automates the sharing of images among rentals and automatic messages.",
    featuredImage: TuroRobot,
  },
  {
    name: "SearchApartments",
    type: ["Automation"],
    tech: [TECH.java, TECH.selenium, TECH.chrome, TECH.git],
    year: "2020",
    description:
      "It’s an automatic system for finding apartments on a Stockholm website and sending an email if it finds any that match the desired specifications.",
    featuredImage: SearchApartments,
  },
  {
    name: "InstaRobot",
    type: ["Automation"],
    tech: [TECH.prettier, TECH.eslint, TECH.typescript],
    year: "2020",
    description:
      "An automated account system for use in Instagram raffles, based on tagging accounts in comments.",
    featuredImage: InstaRobot,
  },
  {
    name: "PvPUtils",
    type: ["Integrations"],
    tech: [TECH.java, TECH.git, TECH.intellij_idea],
    year: "2020",
    description:
      "A mod for the Minecraft game that added extra features to the game, such as autoclicker, auto-armor among other functionalities.",
    featuredImage: PvPUtils,
  },
];
