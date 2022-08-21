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
    }
    // @ts-ignore
  );

  return <Icon {...props} />;
};

/*
;

type ReactIconTypes =
  | "ai"
  | "bi"
  | "bs"
  | "cg"
  | "di"
  | "fa"
  | "fc"
  | "fi"
  | "gi"
  | "go"
  | "gr"
  | "hi"
  | "im"
  | "io"
  | "io5"
  | "lib"
  | "md"
  | "ri"
  | "si"
  | "tb"
  | "ti"
  | "vsc"
  | "wi";

const ReactIcon2: FC<ReactIconProps> = ({ name, ...props }) => {
  const route = name.substring(0, 2).toLowerCase();
  switch (name.substring(0, 2).toLowerCase() as ReactIconTypes) {
    case "ai": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/ai`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "bi": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/bi`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "bs": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/bs`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "cg": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/cg`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "di": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/di`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "fc": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/fc`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "fi": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/fi`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "gi": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/gi`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "go": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/go`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "gr": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/gr`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "hi": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/hi`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "im": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/im`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "io": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/io`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "io5": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/io5`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "lib": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/lib`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "md": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/md`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "ri": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/ri`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "si": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/si`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "tb": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/tb`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "ti": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/ti`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "vsc": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/vsc`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "wi": {
      const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
        import(`react-icons/wi`).then(
          (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
        )
      );
      return <Icon {...props} />;
    }
    case "fa": {
      {
        const Icon: ComponentType<JSX.IntrinsicElements["svg"]> = dynamic(() =>
          import(`react-icons/fa`).then(
            (mod) => mod[name] as ComponentType<JSX.IntrinsicElements["svg"]>
          )
        );
        return <Icon {...props} />;
      }
    }
  }
};

export default ReactIcon;
*/
