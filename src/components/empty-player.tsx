import Image from "next/image";
import type { ReactNode } from "react";
import { QrCode } from "./qr-code";

import logo from "~/assets/my-karaoke-party-logo.png";
import { cn } from "~/lib/utils";

type Props = {
  joinPartyUrl: string;
  className?: string;
  /** Songs to pick from, shown in place of the big logo. */
  suggestions?: ReactNode;
};

export function EmptyPlayer({ joinPartyUrl, className, suggestions }: Props) {
  const joinLink = (
    // ml-12 keeps the QR code clear of the edge on TVs that crop the
    // picture (overscan).
    <>
      <QrCode url={joinPartyUrl} className="ml-12" />
      <a
        href={joinPartyUrl}
        target="_blank"
        className="font-mono text-xl text-white pl-4"
      >
        {joinPartyUrl.split("//")[1]}
      </a>
    </>
  );

  if (suggestions) {
    // Like YouTube's end screen: a grid of songs to pick from, with the
    // join link still in view. pb-16 keeps it above the fullscreen button.
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col gap-4 px-6 pb-16 pt-4 lg:px-16",
          className,
        )}
      >
        {suggestions}
        <div className="flex shrink-0 items-end">
          {joinLink}
          <Image
            src={logo}
            alt="My Karaoke Party"
            className="ml-auto h-16 w-auto object-contain lg:h-24"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center p-6 pb-1",
        className
      )}
    >
      <div className="flex w-full basis-3/4 items-center justify-center">
        <Image
          src={logo}
          alt="My Karaoke Party"
          priority
          className="mx-auto object-contain duration-1000 animate-in zoom-in-150 spin-in-180 max-h-[40vh]"
        />
      </div>
      <div className="absolute bottom-32 left-0 flex w-full items-end px-4 text-center">
        {joinLink}
      </div>
    </div>
  );
}
