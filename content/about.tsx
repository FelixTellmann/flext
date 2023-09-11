// @ts-ignore
import MyPhoto from "../public/images/about/my_photo.jpg";

export const ABOUT = {
  stats: [
    {
      statistic: `${
        new Date(Date.now() - new Date("2000-08-15T01:30:00").getTime()).getFullYear() - 1970
      }`,
      tooltip: `${Math.round(
        (Date.now() - new Date("2000-08-15T01:30:00").getTime()) / 1000
      )} seconds`,
      caption: "Years Old",
    },
    {
      statistic: "5+",
      tooltip: "First line of code written in 2016",
      caption: "Years Dev",
    },
    {
      statistic: "1",
      tooltip: "Who also loves running.",
      caption: "Amazing dog",
    },
    {
      statistic: "749",
      tooltip: "13 GitHub Stars",
      caption: "Commits",
    },
  ],
  description: (
    <>
      <p>
        I am a backend developer currently residing in Brazil. I have extensive experience both as a
        freelancer and as a team member, working with various languages and frameworks. However, my
        primary focus in recent times has been on the <strong>Java</strong> ecosystem, particularly
        using the <strong>Spring Framework</strong>, <strong>Cloud</strong>,{" "}
        <strong>Messaging</strong> and other related technologies.
      </p>
      <p>
        Since the moment I wrote my first line of code, I knew that this was the professional path I
        wanted to pursue. I find fulfillment in solving problems and developing innovative,
        high-impact applications.
      </p>
    </>
  ),
  images: [
    {
      src: MyPhoto,
      alt: "My profile picture",
    },
  ],
};
