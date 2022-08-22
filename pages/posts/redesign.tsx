import { FC } from "react";

type RedesignProps = {};

const BlogHeader = (props: {
  image: null;
  createdAt: string;
  publishedAt: null;
  description: string;
  title: string;
}) => {
  return <div>asd</div>;
};

export const Redesign: FC<RedesignProps> = (props) => {
  return (
    <article className="prose mx-auto">
      <BlogHeader
        title="Planning out yet another redesign. "
        description="Over the last 10 years I've re-created my own site many times"
        image={null}
        createdAt="2022-08-22"
        publishedAt={null}
      />
      <main>
        <h2>Why yet another redesign?</h2>
        <p>Its all about continuous improvement.</p>
        <p>
          Over the last 10 years I've re-created my own site many times (unfortunately I haven't
          kept my first site), but you can check out my other sites <a href="#">here</a>. You would
          wonder why I need another site yet again? Well, I'm currently looking for new
          opportunities either in the form of freelancing gigs or a part-time/full-time remote
          position at an innovative tech company. And what better way is there to showcase my skills
          and what I can offer than having a nicely upgraded website?
        </p>
        <p>
          There is more to it though. First, I'm not really happy with my last experimental
          re-design (<a>see more</a>), which I did a bit in a hurry and while having too many work
          projects on that demanded my time and focus. The second reason is, other than having time
          & energy available, is that I deeply enjoy learning new technologies, best practices, and
          patterns. Is there any better way to learn new things than by practicing it? Lastly, my
          aim is to make this site upgrade a much larger one, with all the things I always wanted to
          include (but somehow skipped on) and to seriously take stock of where I am, what I can and
          want to do, and how to go from here 🥳.
        </p>
        <h2>Whats my goal?</h2>
        <p>
          Having covered <em>why</em> I want to redesign & restructure my site, lets dive into what
          I plan to achieve. I like to start off by setting clear SMART Goals (Specific, Measurable,
          Achievable, Relevant, and Time-bound). This helps my a lot to stay on track and reconnect
          with a starting point if I go off track (knowing myself, this can happen a few times a
          day, damn you internet 🌐).
        </p>
        <p>So without further ado, here is what I plan on building:</p>
        <blockquote>
          A beautifully designed, high performant, next gen tech, clean coded, user interactive,
          Portfolio <u>website</u> with lots of features and a great dev experience.
        </blockquote>
        <p>
          Yea, if your goal looks anything like that, you'll probably never start (I certainly
          wouldn't), there is absolutely nothing SMART about that. Let's break it down into its
          parts and make it useful.
        </p>
        <p>
          Here are the individual parts for the website:
          <ul>
            <li>Beautifully designed</li>
            <li>High performant</li>
            <li>Next gen tech</li>
            <li>Clean coded</li>
            <li>user interactive</li>
            <li>Lots of features</li>
            <li>Great dev experience</li>
          </ul>
          And its also possible to group them a bit into common themes: <br />
          There is a <strong>user-experience (UX)</strong> side, which includes the design,
          interactivity, and variety of features.On the other side is the{" "}
          <strong>developer-experience (DX)</strong>, which covers the tech stack, coding practices,
          and anything else internally related. The <em>performance</em> is a bit of an inbetweener
          🥪 as its super important for a good UX as well as the DX.
        </p>
        <h3>User Experience</h3>
        <p>
          Lets digest whats part of the user-experience for my new site. We have design, features,
          interactivity and some aspects about performance. I believe that a site is generally made
          up in the following format:
        </p>
        <blockquote>
          A Website is a composition of features & content, which are design for an intuitive
          experience and a low learning curve, yet have a rich interactivity making the user feel
          part of the site, all while being as fast as possible.
        </blockquote>
        <h4>Features</h4>
        <p>
          This statement highlights a bit that its individual features & content blocks can be
          designed, made interactive, and be performant in its own being. Yes, fitting all
          components together at the end is also important, but it's much easier to plan each
          feature at a time, applying design & interactivity in a <em>one feature at a time</em>{" "}
          approach. What is important though, is to list the desired features from the start and
          then ranking them in order of importance. Its always possible to keep on adding features
          later, but its important to start off with a small and achievable list.
        </p>
        <p>
          Heres whats needed:
          <ol>
            <li>
              <u>List</u> all features in any order, include all ideas (divergent thinking)
            </li>
            <li>
              <u>Rank</u> each feature in order of importance, creating a <em>must</em> have,{" "}
              <em>should</em> have, and <em>could</em> have list.
            </li>
            <li>
              <u>Elaborate & break down</u> content requirements from the top down, covering all
              must have, and the top should have items, while ignoring all could have features for
              now.
            </li>
          </ol>
        </p>
        <h4>Design</h4>
        <p>
          As mentioned above, I want to create a beautifully designed website. But what do I mean
          with beautifully design? Well I'm not really a designer, yet I had my fair share of design
          experience and I've definitely looked at many pretty and many not so pretty sites, so I'm
          at least well opinionated on the topic 🧐. First and foremost, my aim is create a site
          that has a clean and intuitive user experience. I don't care much about fancy animations
          and anything that could look laggy (like those unique cursor effects). The design should
          be <u>clean & simple</u> with a touch of visual <u>hierarchy & depth</u> to bring the
          right content into focus. It's also important to me that the design process is not locked
          in to Figma or Illustrator, but rather focuses on sketching wireframes, creating
          inspiration art-boards from my list favorite sites that form the foundation for
          development.
        </p>
        <p>
          Over the last 5 years or so, I've built quite a few Shopify sites, which all embrace a
          common design pattern: <u>Pages</u> have <u>sections</u>, which can have <u>blocks</u>.
          This design pattern has been revamped recently with{" "}
          <a href="link to 2.0 themes">Shopify's 2.0 Themes</a> and I've built my own{" "}
          <a>dev tool</a> getting the best out of it for headless based sites. Embracing this flow
          of structuring design and content has worked really well for me and I'll make it a
          requirement in the design process.
        </p>
        <p>
          Here are my requirements for the <u>design</u> process:
          <ol>
            <li>
              Each Page needs a list of <u>sections</u> that kinda act as an outline
            </li>
            <li>
              Each section needs an <u>inspiration art-board</u> (Illustrator file) with design
              examples
            </li>
            <li>
              Additionally to the feature content list, each section should have a content structure
              brief.
              <i>
                It should be detailed to the point that for design to work a paragraph should be
                around 25 words, images of a specific aspect ratio & quality.
              </i>
            </li>
            <li>
              To make widely different design inspirations work together, its important to use an{" "}
              <u>iterative process</u>, focusing on 1-2 Sections at most at a time with development
              of a Section before taking on another area of the site.
            </li>
          </ol>
        </p>
      </main>
    </article>
  );
};

export default Redesign;
