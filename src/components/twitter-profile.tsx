import type { FC } from "react";
import type { components } from "twitter-api-sdk/dist/gen/openapi-types";
import { Image } from "~/components/image";
import { Link } from "~/components/link";

type TwitterProfileProps = components["schemas"]["User"];

export const TwitterProfile: FC<TwitterProfileProps> = ({ profile_image_url, name, username, description, public_metrics }) => {
  return (
    <section className="spacing-2 max-w-xs animate-float rounded-lg border-2 border-gray-400/30 bg-white/90 d:bg-gray-800 p-4 backdrop-blur-md will-change-transform lg:bg-white/80">
      <header className="flex gap-4">
        <figure className="overflow-hidden rounded-full border-2 border-gray-400/50">
          <Image width={40} height={40} src={profile_image_url} alt={name} className="rounded-full border-2 border-accent" />
        </figure>
        <div className="flex flex-col justify-center">
          <h2 className="font-semibold text-sm tracking-wide">{name}</h2>
          <h3 className="d:text-gray-300/90 text-gray-500 text-sm tracking-tight">@{username}</h3>
        </div>
        <Link
          target="_blank"
          href={`https://twitter.com/${username}`}
          className="butter-border my-auto ml-auto flex items-center justify-center rounded-full bg-sky-500/90 d:bg-sky-600/90 d:hfa:bg-sky-500/80 hfa:bg-sky-600/80 px-4 py-1.5 text-white text-xs transition-colors"
        >
          Follow
        </Link>
      </header>
      <main>
        <p className="line-clamp-3 pr-2 d:text-gray-300/90 text-[13px] text-gray-500/90 tracking-tight">{description}</p>
      </main>
      <footer>
        <p className="d:text-gray-300/90 text-[13px] text-gray-500">
          <span className="font-semibold d:text-gray-200 text-gray-600">{public_metrics?.following_count}</span> Following{" "}
          <span className="ml-2 font-semibold d:text-gray-200 text-gray-600">{public_metrics?.followers_count}</span> Followers
        </p>
      </footer>
    </section>
  );
};
