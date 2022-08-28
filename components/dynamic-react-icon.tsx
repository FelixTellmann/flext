import dynamic from "next/dynamic";
import { ComponentType, FC } from "react";
import type * as Icons from "react-icons/all";

export type ReactIconProps = Omit<JSX.IntrinsicElements["svg"], "name"> & {
  name: keyof typeof Icons;
};
export const ReactIcon: FC<ReactIconProps> = ({ name, ...props }) => {
  const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(
    () => {
      const asyncImport = {
        FaGithub: import("@react-icons/all-files/fa/FaGithub"),
        FaShopify: import("@react-icons/all-files/fa/FaShopify"),
        SiNextdotjs: import("@react-icons/all-files/si/SiNextDotJs"),
        SiTailwindcss: import("@react-icons/all-files/si/SiTailwindcss"),
        SiReact: import("@react-icons/all-files/si/SiReact"),
        SiShopify: import("@react-icons/all-files/si/SiShopify"),
        SiNodedotjs: import("@react-icons/all-files/si/SiNodeDotJs"),
        FiCopy: import("@react-icons/all-files/fi/FiCopy"),
        FaFacebook: import("@react-icons/all-files/fa/FaFacebook"),
        FaGoogle: import("@react-icons/all-files/fa/FaGoogle"),
        FaTwitter: import("@react-icons/all-files/fa/FaTwitter"),
        FaInstagram: import("@react-icons/all-files/fa/FaInstagram"),
        BsThreeDotsVertical: import("@react-icons/all-files/bs/BsThreeDotsVertical"),
      }[name];
      if (asyncImport) {
        return asyncImport.then((mod) => {
          return mod[Object.keys(mod)[0]];
        });
      }
      return null;
    },
    {
      ssr: false,
    }
  );

  return <Icon {...props} />;
};
