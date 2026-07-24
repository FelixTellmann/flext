import { SOCIAL_ACCOUNTS } from "content/social-accounts";
import type { FC } from "react";
import { Link } from "~/components/link";

export const Footer: FC = () => {
  return (
    <footer className="print:hidden">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:flex md:items-center md:justify-between lg:px-8">
        <div className="flex justify-center space-x-6 md:order-2">
          {Object.values(SOCIAL_ACCOUNTS).map(({ name, Icon, href }) => (
            <Link key={name} href={href} className="p-1 d:text-gray-600 text-gray-400 d:hover:text-gray-500 hover:text-gray-500">
              <span className="sr-only">{name}</span>
              <Icon className="h-5 w-5" aria-hidden="true" />
            </Link>
          ))}
        </div>
        <div className="mt-8 md:order-1 md:mt-0">
          <small className="block text-center d:text-gray-600 text-gray-400 text-sm">
            &copy; {new Date().getFullYear()} Felix Tellmann, All rights reserved.
          </small>
        </div>
      </div>
    </footer>
  );
};
