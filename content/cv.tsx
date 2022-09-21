import { TECH } from "content/tech-stack";
import { Link } from "components/link";

export const CV = {
  name: "Felix Tellmann",
  title: "Senior Fullstack Engineer",
  primary_stack: [TECH.typescript, TECH.react, TECH.nodejs, TECH.tailwindcss, TECH.mysql],
  address: "Cape Town, Vredehoek 8001, South Africa",
  email: "hello@flext.dev",
  website: "https://flext.dev",
  mobile: {
    href: `tel:+27760313590`,
    number: "+27 (0)76 031 3590",
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
  eduction: [
    {
      dateFrom: "1992-08-01",
      dateTo: "1996-08-01",
      city: "Mönchengladbach",
      country: "Germany",
      institution: "Primary School Gertraudenstraße",
      certificate: "Primary School Certificate",
      level: "School",
      type: [],
    },
    {
      dateFrom: "1996-08-01",
      dateTo: "2002-08-01",
      city: "Mönchengladbach",
      country: "Germany",
      institution: "Comprehensive School Espenstraße",
      certificate: "Secondary School Certificate",
      level: "School",
      type: [],
    },
    {
      dateFrom: "2002-08-01",
      dateTo: "2004-08-01",
      city: "Mönchengladbach",
      country: "Germany",
      institution: "Vocational College of Technology and Media",
      certificate: "High School Certificate",
      level: "School",
      type: [],
    },
    {
      dateFrom: "2008-01-01",
      dateTo: "2008-07-01",
      city: "Cape Town",
      country: "South Africa",
      institution: "International Hotel School",
      certificate: "Skills, Tasks and Result Training Certificate",
      level: "Higher Education",
      type: ["restaurant", "management"],
    },
    {
      dateFrom: "2009-07-01",
      dateTo: "2012-07-01",
      city: "Cape Town",
      country: "South Africa",
      institution: "International Hotel School",
      certificate: "Higher Diploma in Professional Cookery & Kitchen Management",
      level: "Higher Education",
      type: ["restaurant", "management"],
    },
    /*{
      dateFrom: "2009-07-01",
      dateTo: "2012-07-01",
      city: "Cape Town",
      country: "South Africa",
      institution: "International Hotel School",
      certificate: "Higher Diploma in Food & Beverage Management",
      level: "Higher Education",
      type: ["restaurant", "management"],
    },
    {
      dateFrom: "2013-01-01",
      dateTo: "2013-07-01",
      city: "Cape Town",
      country: "South Africa",
      institution: "International Hotel School",
      certificate: "Higher Diploma in Hospitality Management",
      level: "Higher Education",
      type: ["restaurant", "management"],
    },*/
    {
      dateFrom: "2009-07-01",
      dateTo: "2013-07-01",
      city: "Cape Town",
      country: "South Africa",
      institution: "International Hotel School",
      certificate: (
        <div>
          <div>Higher Diploma in Hospitality Management,</div>
          <div>Higher Diploma in Food & Beverage Management, </div>
          <div>Higher Diploma in Professional Cookery & Kitchen Management</div>
        </div>
      ),
      level: "Higher Education",
      type: ["relevant", "management", "restaurant"],
    },
    {
      dateFrom: "2015-01-01",
      dateTo: "2015-12-01",
      city: "Cape Town",
      country: "South Africa",
      institution: "University of Cape Town",
      certificate: "Postgraduate Diploma in Business Management & Entrepreneurship",
      level: "Higher Education",
      type: ["relevant", "web / tech dev", "management", "entrepreneurial"],
    },
  ],
  experience: [
    {
      dateFrom: "2005-01-01",
      dateTo: "2005-07-01",
      city: "Mönchengladbach",
      country: "Germany",
      company: "Internet Cafe Matrix",
      title: "IT Technical Assistant",
      description: "",
      type: ["web / tech dev"],
      responsibilities: [
        {
          content: "Assisted in hardware infrastructure & wired network installation",
          type: ["web / tech dev"],
        },
        {
          content: "Created automated on-demand user-profile setup using Windows XP",
          type: ["web / tech dev"],
        },
        {
          content: "Programmed Windows XP user access roles to restrict sensitive file access",
          type: ["web / tech dev"],
        },
        {
          content: "Handling of day-to-day user queries & requests",
          type: ["web / tech dev"],
        },
      ],
    },
    {
      dateFrom: "2005-07-01",
      dateTo: "2006-03-01",
      city: "Mönchengladbach",
      country: "Germany",
      company: "Social Holding MG",
      title: "Civilian Alternative Service",
      type: [],
      responsibilities: [
        {
          content: "Delivery of food for elderly people",
          type: [],
        },
        {
          content: "Caregiver to disabled individuals",
          type: [],
        },
      ],
    },
    {
      dateFrom: "2006-05-01",
      dateTo: "2007-06-01",
      city: "Mönchengladbach",
      country: "Germany",
      company: "Schröder & Tellmann Design Agency",
      title: "Internship in Media & Graphic Design",
      type: ["web / tech dev"],
      responsibilities: [
        {
          content: "Assisted in the creation of print advertisements",
          type: ["design"],
        },
        {
          content: "Handling client service & communicating project requirements",
          type: ["web / tech dev"],
        },
      ],
    },
    {
      dateFrom: "2008-01-01",
      dateTo: "2008-07-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Cape Milner Hotel",
      title: "Front-Office, Housekeeping and Food & Beverage Training",
      type: ["restaurant", "management"],
      responsibilities: [
        {
          content: "Handling daily Check-ins/Check-outs",
          type: ["restaurant"],
        },
        {
          content: "Assisted in scheduling & managing the housekeeping team",
          type: ["restaurant", "management"],
        },
        {
          content: "Provided all waiter related service duties",
          type: ["restaurant"],
        },
        {
          content: "Worked in all waiter related duties",
          type: ["restaurant"],
        },
      ],
    },
    {
      dateFrom: "2008-08-01",
      dateTo: "2008-12-01",
      city: "Düsseldorf",
      country: "Germany",
      company: "Monkey's Gastronomy",
      title: "Apprenticeship as a Chef",
      type: ["restaurant", "management"],
      responsibilities: [
        {
          content: "Demi-chef de Partie in the cold kitchen",
          type: ["restaurant"],
        },
        {
          content: "Developed daily menu specials together with the Executive Chef",
          type: ["restaurant"],
        },
        {
          content: "Supervised an outsourced team of 10 staff for events",
          type: ["restaurant", "management"],
        },
        {
          content: "Planned and organized setup of the outside area and for functions",
          type: ["restaurant"],
        },
        {
          content: "Inventory management, including purchasing and control",
          type: ["restaurant", "management"],
        },
      ],
    },
    {
      dateFrom: "2009-02-01",
      dateTo: "2009-06-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Cape Milner Hotel",
      title: "Assistant Front-Office Manager",
      type: ["restaurant", "management"],
      responsibilities: [
        {
          content: "Assisted with reservations and booking of functions",
          type: ["restaurant"],
        },
        {
          content: "Handling guest queries and complaints",
          type: ["Service"],
        },
        {
          content: "Prepared reports for the Rooms division manager",
          type: ["restaurant", "management"],
        },
      ],
    },
    {
      dateFrom: "2009-07-01",
      dateTo: "2010-06-01",
      city: "Cape Town",
      country: "South Africa",
      company: "The Winchester Mansion Hotel",
      title: "Junior Chef de Partie",
      type: ["restaurant", "management"],
      responsibilities: [
        {
          content: "Training as Saucier, Entremetier, Garde-manger, and Pâtissier",
          type: ["restaurant"],
        },
        {
          content: "Involved with the training of new staff",
          type: ["restaurant"],
        },
        {
          content: "Helped developing menus for special events",
          type: ["restaurant"],
        },
        {
          content: "Improved existing set-up and breakdown work procedures",
          type: ["restaurant", "management"],
        },
      ],
    },
    {
      dateFrom: "2010-02-01",
      dateTo: "2018-01-01",
      city: "Cape Town",
      country: "South Africa",
      company: "33 Degrees - Catering & Events",
      title: "Founder & Caterer",
      type: ["entrepreneurial", "restaurant", "management"],
      responsibilities: [
        {
          content: "Founded the business to cater for small scale catering needs",
          type: ["entrepreneurial"],
        },
        {
          content:
            "Event management from planning, purchasing, production, venue setup to on-the-day coordination.",
          type: ["management"],
        },
        {
          content: "Menu planning, development and costing, creating standardized recipe cards.",
          type: ["restaurant", "management"],
        },
        {
          content: "Hired & trained part-time employees for on the day event execution",
          type: ["entrepreneurial", "management"],
        },
      ],
    },
    {
      dateFrom: "2010-07-01",
      dateTo: "2011-06-01",
      city: "Cape Town",
      country: "South Africa",
      company: "The Mount Restaurant",
      title: "Chef de Partie / Junior Sous-Chef",
      type: ["restaurant", "management"],
      responsibilities: [
        {
          content: "Responsible for the smooth progress of work in the kitchen",
          type: ["restaurant", "management"],
        },
        {
          content: "Involved in the development of monthly specials",
          type: ["restaurant"],
        },
        {
          content:
            "Created standard recipe files for all menu items and daily production worksheets",
          type: ["restaurant", "management"],
        },
        {
          content: "Assisted in purchasing and inventory management",
          type: ["restaurant", "management"],
        },
      ],
    },
    {
      dateFrom: "2011-11-01",
      dateTo: "2012-05-01",
      city: "",
      country: "Caribbean & Mediterranean Sea",
      company: "The Yachts of Seabourn – Six-Star Cruise Line",
      title: "Waiter / Buffet Manager",
      type: ["restaurant", "management"],
      responsibilities: [
        {
          content: "Providing personalized restaurant service to guests",
          type: ["restaurant"],
        },
        {
          content: "Responsible for the buffet for breakfast and lunch",
          type: ["restaurant", "management"],
        },
        {
          content: "Training of new hired employees",
          type: ["restaurant", "management"],
        },
        {
          content: "Assisted in all other areas of the service operation",
          type: ["restaurant"],
        },
        {
          content: "Setup and preparation of service areas",
          type: ["restaurant"],
        },
      ],
    },
    {
      dateFrom: "2012-08-01",
      dateTo: "2013-05-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Salt Restaurant",
      title: "Assistant Restaurant Manager",
      type: ["restaurant", "management"],
      responsibilities: [
        {
          content: "Managing a team of 20 employees",
          type: ["restaurant", "management"],
        },
        {
          content: "Responsible for recruiting, training, performance reviews and team motivation",
          type: ["restaurant", "management"],
        },
        {
          content: "Ensured tight inventory management & cost control",
          type: ["restaurant", "management"],
        },
        {
          content: "Coordinated all in-house functions and events",
          type: ["restaurant", "management"],
        },
      ],
    },
    {
      dateFrom: "2013-07-01",
      dateTo: "2015-01-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Kitima Restaurant",
      title: "Restaurant Manager",
      type: ["restaurant", "management", "web / tech dev"],
      responsibilities: [
        {
          content: "Managing a team of 50 employees",
          type: ["restaurant", "management"],
        },
        {
          content: "Helped achieve high levels of revenue through effective staffing & training",
          type: ["restaurant", "management"],
        },
        {
          content: "Ensured service standards were maintained at the highest level",
          type: ["restaurant", "management"],
        },
        {
          content: "Programming & troubleshooting of Micros POS computer system",
          type: ["web / tech dev"],
        },
        {
          content: "Developed the restaurants website using Wordpress",
          type: ["web / tech dev"],
        },
        {
          content:
            "In charge of daily service operation, assisting waiters and filling in where needed",
          type: ["restaurant"],
        },
      ],
    },
    {
      dateFrom: "2015-02-01",
      dateTo: "2015-10-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Kitima Restaurant",
      title: "Consulting Manager",
      type: ["management", "restaurant", "web / tech dev"],
      responsibilities: [
        {
          content: "Creating & maintaining training programs.",
          type: ["restaurant", "Management"],
        },
        {
          content: "Created information systems involving all food/beverage production.",
          type: ["restaurant", "web / tech dev"],
        },
        {
          content: "Web design, Micros POS programming, IT solutions",
          type: ["web / tech dev"],
        },
      ],
    },
    {
      dateFrom: "2015-02-01",
      dateTo: "2015-10-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Simply Stuck - Vinyl Accessories",
      title: "Co-Founder, CFO & Product Development Lead",
      type: ["entrepreneurial", "management", "web / tech dev"],
      responsibilities: [
        {
          content: "Starting of new business venture in visual marketing products",
          type: ["entrepreneurial"],
        },
        {
          content: "Managing of all financial information and reporting",
          type: ["management"],
        },
        {
          content:
            "Created the company website & designed artworks for production according to vinyl specifications",
          type: ["web / tech dev"],
        },
      ],
    },
    {
      dateFrom: "2015-11-01",
      dateTo: "2016-05-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Raya Kitchen by Kitima",
      title: "General Manager",
      type: ["entrepreneurial", "restaurant", "management", "web / tech dev", "relevant"],
      responsibilities: [
        {
          content:
            "I partnered with my previous employer to develop and open a new Restaurant in the centre of Cape Town",
          type: ["restaurant", "entrepreneurial", "management", "relevant"],
        },
        {
          content:
            "I grew the team from 1 to 25 employees and developed training manuals, operational systems and service procedures for all aspects of the day-to-day operation",
          type: ["restaurant", "management", "relevant"],
        },
        {
          content:
            "Oversaw all aspects of the construction & shop fitting and setup the IT office infrastructure and programmed the POS system",
          type: ["restaurant", "management", "relevant", "web / tech dev"],
        },
        {
          content:
            "Created the wine & cocktail list and worked closely with the head chef to establish the food menu",
          type: ["restaurant", "management", "relevant"],
        },
        {
          content:
            "I developed the launch marketing campaign and the restaurants website using Wordpress",
          type: ["restaurant", "management", "web / tech dev", "relevant"],
        },
        {
          content:
            "Handled most financial aspects from budgeting to menu item costing, reporting directly to the owner",
          type: ["restaurant", "management", "relevant"],
        },
      ],
    },
    {
      dateFrom: "2016-06-01",
      dateTo: "2017-03-01",
      city: "Cape Town",
      country: "South Africa",
      company: "SmartUp Online (Pty) Ltd. - Restaurant Training & Development",
      title: "Co-Founder & Managing Director / Web Developer",
      type: ["entrepreneurial", "management", "web / tech dev", "relevant"],
      responsibilities: [
        {
          content:
            "Co-founded SmartUp Online (Pty) Ltd in 2016 as a SAAS Restaurant training platform with the goal to provide high quality training to restaurant workers in South Africa",
          type: ["entrepreneurial", "relevant", "web / tech dev"],
        },
        {
          content:
            "Working as the lead developer and content director for training material, where I developed the online platform using the LAMP stack (Linux, Apache, Mysql, Php) with a MVC (model, view, controller) Architecture",
          type: ["web / tech dev", "management", "relevant"],
        },
        {
          content:
            "Involved in the UX design process, providing feedback, discussing technical challenges and performing qualitative user testing",
          type: ["web / tech dev", "management", "relevant"],
        },
      ],
    },
    {
      dateFrom: "2017-03-01",
      dateTo: "2018-06-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Liquix (Pty) Ltd. – Web Agency",
      title: "Senior Front-end Developer",
      type: ["management", "web / tech dev", "relevant"],
      responsibilities: [
        {
          content:
            "Developed custom Shopify themes for clients using Liquid, Javascript, HTML5 & SASS",
          type: ["web / tech dev", "relevant"],
        },
        {
          content:
            "Assisted in the hiring of new developers and helped grow the team by mentored junior developers through pair programming, code reviews and 1-on-1s",
          type: ["management", "relevant", "web / tech dev"],
        },
        {
          content:
            "Developed the Agency marketing site using React.js and Shopify as a headless cms",
          type: ["web / tech dev", "relevant"],
        },
        {
          content: "Created documentation & coding standards for internal use across projects",
          type: ["web / tech dev", "relevant"],
        },
        {
          content:
            "Handled large scale data migrations, using database SQL queries and developed web-scrapers for legacy systems",
          type: ["web / tech dev", "relevant"],
        },
        {
          content:
            "Improved test coverage by writing unit and integration tests with Jest and Enzyme",
          type: ["web / tech dev", "relevant"],
        },
      ],
    },
    {
      dateFrom: "2018-07-01",
      dateTo: "2020-04-01",
      city: "Knysna",
      country: "South Africa",
      company: "The Burger Exchange (Pty) Ltd",
      title: "Co-Founder, Managing Director",
      type: [
        "management",
        "web / tech dev",
        "relevant",
        "web / tech dev",
        "restaurant",
        "entrepreneurial",
      ],
      responsibilities: [
        {
          content:
            "Envisioned & opened a 200 seater restaurant with my wife with a unique Grill & Burger theme at a beautiful spot on the Knysna lagoon",
          type: ["entrepreneurial", "restaurant", "relevant"],
        },
        {
          content:
            "Covered all aspects of the restaurant, from creating the initial business plan, to sourcing funding, to the day-to-day operations",
          type: ["entrepreneurial", "restaurant", "relevant"],
        },
        {
          content:
            "Project management, shop fitting, operations and establishing a team of 35 employees during peak season with up to 800 guests per day",
          type: ["management", "restaurant", "entrepreneurial", "relevant"],
        },
        {
          content: "Handled all Legal, IT & Financial responsibilities for the company",
          type: ["management", "relevant", "web / tech dev"],
        },
        {
          content:
            "Supported the overall marketing strategy with graphic design, food photography and I developed the restaurants website",
          type: ["web / tech dev", "relevant"],
        },
        {
          content: "Managed the day-to-day operations and filled in any floor position as needed",
          type: ["management", "relevant"],
        },
        {
          content:
            "De-registered and properly closed the business in March 2018 due to the economic effects of Covid on the Tourism industry",
          type: ["management", "entrepreneurial", "relevant"],
        },
      ],
    },
    {
      dateFrom: "2020-04-01",
      dateTo: "2022-12-01",
      city: "Cape Town",
      country: "South Africa",
      company: "Tellmann – Web Design Studio",
      title: "Founder & Fullstack Developer",
      type: ["management", "web / tech dev", "relevant", "entrepreneurial"],
      responsibilities: [
        {
          content:
            "I founded Tellmann - Web Design Studio in 2020 during the first lockdown as a small scale web agency to provide exclusive web development services surrounding the Shopify ecosystem",
          type: ["entrepreneurial", "management", "relevant", "web / tech dev"],
        },
        {
          content: "I worked as the company's managing director and lead developer on all projects",
          type: ["web / tech dev", "relevant"],
        },
        {
          content: "Responsible for finding & on-boarding new clients and handling business growth",
          type: ["web / tech dev", "entrepreneurial", "management", "relevant"],
        },

        {
          content:
            "Planned, developed and published 2 web apps on the Shopify App store, built with Next.js, Turborepo, AWS S3 & Dynamo DB",
          type: ["web / tech dev", "entrepreneurial", "management", "relevant"],
        },

        {
          content: "Developed and maintained client, internal, and open source projects",
          type: ["web / tech dev", "management", "relevant"],
        },
        {
          content: "Providing of web-, data-, tech- and on-site support to clients",
          type: ["web / tech dev", "relevant"],
        },
        {
          content: (
            <>
              Comprehensive portfolio of projects available at{" "}
              <Link href="https://flext.dev" target="_blank">
                flext.dev
              </Link>
            </>
          ),
          type: ["web / tech dev", "relevant"],
        },
      ],
    },
  ],
  capabilities: {
    languages: [
      {
        name: "German - native",
        Icon: null,
      },
      {
        name: "English - bilingual",
        Icon: null,
      },
      {
        name: "French - basic",
        Icon: null,
      },
    ],
    programmingLanguages: [
      TECH.typescript,
      TECH.javascript,
      TECH.html_5,
      TECH.css_3,
      TECH.sass,
      TECH.graphql,
      TECH.markdown,
      TECH.liquid,
      TECH.sql,
      TECH.ruby,
      TECH.php,
    ],
    librariesFrameworks: [
      TECH.react,
      TECH.tailwindcss,
      TECH.nextjs,
      TECH.trpc,
      TECH.prisma,
      TECH.react_query,
      TECH.remix,
      TECH.jest,
      TECH.turborepo,
      TECH.nodejs,
      TECH.express,
      TECH.webpack,
      TECH.framer,
      TECH.redis,
    ],
    serviceProviders: [
      TECH.vercel,
      TECH.aws,
      TECH.firebase,
      TECH.netlify,
      TECH.planetscale,
      TECH.github,
    ],
    dataProviders: [TECH.shopify, TECH.vend, TECH.erply, TECH.dear, TECH.micros, TECH.wordpress],
    tools: [
      TECH.intellij_idea,
      TECH.git,
      TECH.yarn,
      TECH.npm,
      TECH.illustrator,
      TECH.photoshop,
      TECH.figma,
      TECH.postman,
      TECH.ftp,
      TECH.office,
      TECH.dev_tools,
    ],
  },
  certifications: [
    {
      date: "2016",
      name: "FreeCodeCamp - Front-end Developer Certification",
      type: ["web / tech dev", "relevant"],
    },
    {
      date: "2017",
      name: "FreeCodeCamp - Back-end Developer Certification",
      type: ["web / tech dev", "relevant"],
    },
    {
      date: "2017",
      name: "Shopify - Theme Development Certification",
      type: ["web / tech dev", "relevant"],
    },
    {
      date: "2017",
      name: "Shopify - Product Fundamentals Certification",
      type: ["web / tech dev", "relevant"],
    },
    {
      date: "2017",
      name: "Shopify - App Development Certification",
      type: ["web / tech dev", "relevant"],
    },
    {
      date: "2018",
      name: "Shopify - Business Fundamentals Certification",
      type: ["web / tech dev", "relevant"],
    },
    {
      date: "2018",
      name: "CodeCademy - React.js Certification",
      type: ["web / tech dev", "relevant"],
    },
    {
      date: "2016",
      name: "Diners Club - Diamond Wine list award",
      type: ["restaurant"],
    },
    {
      date: "2015",
      name: "Diners Club - Diamond Wine list award",
      type: ["restaurant"],
    },
    {
      date: "2015",
      name: "Eat out Magazine - Best Asian Restauth with Kitima Restaurant ",
      type: ["restaurant"],
    },
  ],
  other: [
    {
      name: "Cape Wine Academy - Wine Certificate",
    },
    {
      name: "First Aid Course - Level one",
    },
    {
      name: "ICDL - International Computer Drivers License",
    },
    {
      name: "Cardio Pulmonary Resuscitation Certificate",
    },
    {
      name: "Crowd Management & Passenger Service Safety Certificate",
    },
    {
      name: "Artful Food Competition - 1st price",
    },
  ],
  references: [
    {
      author: "Jeroen Hartgers",
      title: "Managing Director",
      company: "Kids Living",
      reference:
        "It is a pleasure to work with Felix as a design and development partner and ecommerce specialist. You can point out a problem to him and know that it will be handled, and he brings a positive vibe to the team at the same time. His approach to web is modern and progressive, and it is very refreshing. Furthermore, he has a real passion for web development, producing excellent results, being up to date with all the latest technology and being reliable and easy to work with. Ask him about anything from performance to accessibility or on-site tech support, he'll go out of his way to find a solution.",
    },
    {
      author: "Thomas Fuss",
      title: "Managing Director",
      company: "Ademas Solutions",
      reference:
        "Felix has a highly technical aptitude, which is further enhanced by his experience and general desire to be the best. My favorite thing about working with Felix is his ability to tell when a problem needs to be fixed right away and when a problem needs to be solved quickly. Whatever he does, he is always dedicated to doing an excellent job, and he makes the right engineering decisions for the project. In addition to learning new technologies at an exceptionally fast rate, he is often the first one to come to when a technical problem arises. In his role as a team player, Felix appears equally comfortable joining a project team and working directly on it, mentoring less experienced developers, or leading a project as a technical lead. Felix has always been a pleasant presence at customer meetings, as he is able to answer questions clearly and accurately, and he is not afraid to express his opinion on technical issues as well. I will miss working with Felix and will be confident in recommending him for any technical position in the future. He is well liked and highly respected by his colleagues from all areas of the business.",
    },
    {
      author: "Juan De Bruyn",
      title: "Restaurant Manager",
      company: "The Exchange Restaurant",
      reference: `I have been fortunate enough to be working both along & with Felix Tellmann for the past 8 months. Felix has been an absolute light and strength in the team he runs. His approach to every challenge with a calm, firm & respectful attitude is something to be admired and to be learned by everyone. In spite of the challenges, this type of leadership makes a happy and productive work environment because it brings everyone together. I wish Felix all the best for his future endeavors. He is sure to make any challenge he takes on an absolute success.`,
    },
  ],
  personal: `After spending my childhood in Germany and early work career, I moved to Cape Town 14 years ago. Cooking and hosting dinners for family and friends are some of my favorite activities, and I enjoy connecting with people through good food, technology, and intelligent discussion. You will often find me on and around Table Mountain, hiking or running with my dog Alpha. I am very excited about the new age Space Race and the innovation it brings, and I would like to witness a rocket launch in my lifetime. It is also important to me to keep up with web technology and UX design developments by listening to podcasts, attending local events, attending conferences, and using Twitter.`,
};
