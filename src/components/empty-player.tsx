import Image from "next/image";
import { QrCode } from "./qr-code";

import logo from "~/assets/my-karaoke-party-logo.png";
import { cn } from "~/lib/utils";

type Props = {
  joinPartyUrl: string;
  className?: string;
};

export function EmptyPlayer({ joinPartyUrl, className }: Props) {
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
      {/* Same spot as the QR code over a playing song (see player.tsx):
          clear of the edges on TVs that crop the picture (overscan). */}
      <div className="absolute bottom-32 left-0 flex w-full items-end px-4 text-center">
        <QrCode url={joinPartyUrl} className="ml-12" />
        <a
          href={joinPartyUrl}
          target="_blank"
          className="font-mono text-xl text-white pl-4"
        >
          {joinPartyUrl.split("//")[1]}
        </a>
      </div>
    </div>
  );
}
