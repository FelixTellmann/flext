import { FC } from "react";

type IndexProps = {};

export const Notes: FC<IndexProps> = (props) => {
  return (
    <>
      <section className="rant">
        like WTF! why am I so stuck! okay lets just simply start and see what happens...
        <br />
        They do say though, that writing an outline helps alot
        <br />
        don't get overwhelmed!
      </section>
      <section className="intro">
        <div>Welcome</div>
        <h1>Hi, I am Felix Tellmann.</h1>
        <p>
          I'm a fullstack developer specialized in react based websites and apps with a broad
          spectrum of knowledge from infrastructure/architecture to UX design. I love building clean
          and high performant websites, dev-tools to automate workloads and anything inbetween.
          <br />
          I'm a self-taught web-engineer with a background in restaurants, yet written my first line
          of code in 1998.
          <br />
          Hey, I'm Felix Tellmann. I'm a web developer and ex. Restaurateur living in Cape Town. In
          2016 I made the daring decision to quit my restaurant job (not for good yet) to embrace my
          childhood passion of software development full-time.
          <br />
          Core message:
          <ul>
            <li>Welcome (name)</li>
            <li>1 sentence who am I</li>
            <li>What is my specialization / focus</li>
            <li>A personal touch - not just a robot</li>
            <li>what can a reader get here</li>
            <li>where I've come from</li>
            <li>cta link - Read more about me</li>
            <li>cta primary - Hire / lets work</li>
          </ul>
          Hi, I'm Felix Tellmann. Fullstack web-developer (and ex Restaurateur) with a strong sense
          for business success, currently living in Cape Town. I specialize in building beautiful
          websites and web apps from small to large. I have worked many times through the steps to
          create a new website or app, from the initial idea to feature breakdown, design,
          development, launch and marketing, yet my passion is in the development part. I love
          writing code that takes things next level, building my own dev-tools, private api
          integrations, highly performant websites, and user-experiences that makes you feel "Wow"
          (hover over wow for confetti effect :p).
        </p>
      </section>
      <section>
        Timeline?: last 5 years preview. One 3 line point per year. Option to scroll backwards
        <a href="https://iterative.ai/about">https://iterative.ai/about</a>
      </section>
      <section>
        <h1>A year in Review, 2021 - 2010</h1>
        <h2>Questions for each Year - to be filled as I write</h2>
        <ul>
          <li>What was the major theme for the year?</li>
          <li>Any accomplishments?</li>
          <li>Where was I that year?</li>
          <li>Was I working / employed? Was I studying?</li>
          <li>Major relationships?</li>
          <li>Fun activities / sport / travel / other</li>
          <li>more? fill in here</li>
        </ul>
        <section>
          <h1>2021</h1>
          <p>
            2021 was a year with a fresh start, I recently went non-alcoholic, and kept so for more
            than 4 month. I also did the Otter trail 5 day hike, in honestly not the greatest
            weather. I've grown my business on a good scale. Initially, the outlook wasn't the
            greatest as I had limited financial funds available and expenses that could only be
            covered for a couple of months if I wouldn't find new clients and get more work.
            <br />
            From a knowledge perspective, I challenged myself, building and publishing 2 Apps on the
            Shopify app store, and I took on a lot more work that were backend oriented for my
            clients, automating their internal workflows.
            <br />
            I've also had the opportunity to travel and see Jess and AJ again, after a long time, to
            spend a week with them and their friends for their wedding. It was an absolute blast
            being on a small Alpaca farm with 20 people. We also had a wonderful time as their spend
            their honeymoon in Cape Town and we went on a Wine-tram outing in Franchschoek.
            <br />
            Holidays:
            <ul>
              <li>Otter Trail</li>
              <li>Citrusdal - Cederkloof x2</li>
              <li>Wilderness</li>
              <li>Train - Pringle Bay</li>
              <li></li>
            </ul>
          </p>
        </section>
      </section>
    </>
  );
};

export default Notes;
