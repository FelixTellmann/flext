import { Link } from "components/link";
import { SOCIAL_ACCOUNTS } from "content/social-accounts";
import { FC } from "react";

type FooterProps = {};

export const Footer: FC<FooterProps> = ({}) => {
  return (
    <footer className="print:hidden">
      <div className="mx-auto max-w-6xl py-12 px-4 sm:px-6 md:flex md:items-center md:justify-between lg:px-8">
        <div className="flex justify-center space-x-6 md:order-2">
          {Object.values(SOCIAL_ACCOUNTS).map(({ name, Icon, href }) => (
            <Link
              key={name}
              href={href}
              className="p-1 text-gray-400 hover:text-gray-500 d:text-gray-600 d:hover:text-gray-500"
            >
              <span className="sr-only">{name}</span>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </Link>
          ))}
        </div>
        <div className="mt-8 md:order-1 md:mt-0">
          <small className="block text-center text-sm text-gray-400 d:text-gray-600">
            &copy; {new Date().getFullYear()} Felix Tellmann, All rights reserved.
          </small>
        </div>
      </div>
    </footer>
  );
};
