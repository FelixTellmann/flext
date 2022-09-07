import { SiFacebook } from "@react-icons/all-files/si/SiFacebook";
import { SiGithub } from "@react-icons/all-files/si/SiGithub";
import { SiLinkedin } from "@react-icons/all-files/si/SiLinkedin";
import { SiTwitter } from "@react-icons/all-files/si/SiTwitter";

export const SOCIAL_ACCOUNTS = {
  github: {
    name: "GitHub",
    href: "https://github.com/FelixTellmann",
    Icon: ({ className = "" }) => <SiGithub className={className} />,
  },

  twitter: {
    name: "Twitter",
    href: "https://twitter.com/FelixTellmann",
    Icon: ({ className = "" }) => <SiTwitter className={className} />,
  },
  facebook: {
    name: "Facebook",
    href: "https://www.facebook.com/felix.tellmann/",
    Icon: ({ className = "" }) => <SiFacebook className={className} />,
  },
  linkedin: {
    name: "LinkedIn",
    href: "https://www.linkedin.com/in/felixtellmann",
    Icon: ({ className = "" }) => <SiLinkedin className={className} />,
  },
};
