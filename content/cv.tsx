import { TECH } from "content/tech-stack";
import { Link } from "components/link";

export const CV = {
  name: "Mateus Neres",
  title: "Middle Software Engineer",
  primary_stack: [TECH.java, TECH.kotlin, TECH.react, TECH.nodejs, TECH.mysql],
  address: "Rio de Janeiro, Brazil",
  email: "contato@mateusneres.dev",
  website: "https://mateusneres.dev",
  mobile: {
    href: `tel:+5521995228642`,
    number: "+55 (21)995228642",
  },
  intro: (
    <>
      I am a passionate self-taught software developer (and former restaurateur & chef) looking for
      a new challenge. I specialize in front-end- and serverless backend- development using
      Typescript, React.js, and Node.js. As an advocate for web performance, accessibility, and an
      evangelist for the{" "}
      <Link href="https://jamstack.org/" target="_blank">
        JAM Stack
      </Link>{" "}
      and the newer{" "}
      <Link href="https://init.tips/#why" target="_blank">
        T3 stack
      </Link>
      , I create amazing web applications to make the internet a better place. I love encountering
      hard-to-solve-problems and approach them with patience, determination, and relentless
      perseverance.
    </>
  ),
  experience: [
    {
      dateFrom: "2020-03-01",
      dateTo: "2020-06-31",
      city: "Remote",
      country: "North America",
      company: "Turo",
      title: "Software Engineer - Freelancer",
      type: ["all", "relevant"],
      responsibilities: [
        {
          content:
            "Development of an automation script in java, using the selenium framework to automate the process of sending messages and photos between rentals on the turo website.",
          type: ["all", "relevant"],
        },
      ],
    },
    {
      dateFrom: "2020-11-01",
      dateTo: "2023-01-01",
      city: "Remote",
      country: "Brazil",
      company: "Futurium – Minecraft Server",
      title: "Lead Developer",
      type: ["all", "relevant"],
      responsibilities: [
        {
          content:
            "Developed custom Shopify themes for clients using Liquid, Javascript, HTML5 & SASS",
          type: ["all", "relevant"],
        },
      ],
    },
    {
      dateFrom: "2019-02-01",
      dateTo: "2023-05-01",
      city: "Remote",
      country: "Worldwide",
      company: "UpWork",
      title: "Software Engineer - Freelancer",
      type: ["all", "relevant"],
      responsibilities: [
        {
          content:
            "Envisioned & opened a 200 seater restaurant with my wife with a unique Grill & Burger theme at a beautiful spot on the Knysna lagoon",
          type: ["all", "relevant"],
        },
      ],
    },
    {
      dateFrom: "2023-05-05",
      city: "Remote",
      country: "Brazil",
      company: "Compass UOL",
      title: "Software Engineer",
      type: ["all", "relevant"],
      responsibilities: [
        {
          content:
            "I founded Tellmann - Web Design Studio in 2020 during the first lockdown as a small scale web agency to provide exclusive web development services surrounding the Shopify ecosystem",
          type: ["all", "relevant"],
        },
      ],
    },
  ],
  education: [
    {
      dateFrom: "2008-01-01",
      dateTo: "2017-12-21",
      city: "Rio de Janeiro",
      country: "Brazil",
      institution: "C.E Desembargador José Augusto C. R. Jr",
      certificate: "High School Diploma",
      level: "High School",
      type: ["all"],
    },
    {
      dateFrom: "2020-01-01",
      dateTo: "2024-12-01",
      city: "Rio de Janeiro",
      country: "Brazil",
      institution: "Anhanguera Educacional",
      certificate: "Bachelor’s Degree in Computer Science",
      level: "Higher Education",
      type: ["all", "relevant"],
    },
  ],
  capabilities: {
    languages: [
      {
        name: "Portuguese - native",
        Icon: null,
      },
      {
        name: "English - intermediate",
        Icon: null,
      },
      {
        name: "Spanish - basic",
        Icon: null,
      },
    ],
    programmingLanguages: [
      TECH.java,
      TECH.kotlin,
      TECH.javascript,
      TECH.html_5,
      TECH.css_3,
      TECH.markdown,
      TECH.sql,
      TECH.php,
    ],
    librariesFrameworks: [
      TECH.spring,
      TECH.hibernate,
      TECH.kafka,
      TECH.mockito,
      TECH.junit,
      TECH.redis,
      TECH.react,
      TECH.nextjs,
      TECH.jest,
      TECH.nodejs,
      TECH.express,
    ],
    serviceProviders: [
      TECH.aws,
      TECH.gcp,
      TECH.oraclecloud,
      TECH.vercel,
      TECH.aws,
      TECH.netlify,
      TECH.planetscale,
      TECH.github,
    ],
    tools: [
      TECH.intellij_idea,
      TECH.vscode,
      TECH.git,
      TECH.maven,
      TECH.gradle,
      TECH.npm,
      TECH.figma,
      TECH.insomnia,
      TECH.dbeaver,
    ],
  },
  certifications: [
    {
      date: "2023",
      name: "AWS Certified Cloud Practitioner",
      type: ["all", "relevant"],
    },
    {
      date: "2023",
      name: "Rocketseat Discover Especializar",
      type: ["all", "relevant"],
    },
  ],
};
