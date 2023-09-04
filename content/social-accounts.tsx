import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import { SiLinkedin } from "@react-icons/all-files/si/SiLinkedin";

export const SOCIAL_ACCOUNTS = {
  github: {
    name: "GitHub",
    href: "https://github.com/mateusneresrb",
    Icon: ({ className = "" }) => <SiGithub className={className} />,
  },
  linkedin: {
    name: "LinkedIn",
    href: "https://www.linkedin.com/in/mateusneresrb",
    Icon: ({ className = "" }) => <SiLinkedin className={className} />,
  },
};
