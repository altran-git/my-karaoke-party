import Image from "next/image";
import { CreateParty } from "../components/create-party";
import logo from "~/assets/my-karaoke-party-logo.png";
import Link from "next/link";

export default async function Home() {
  return (
    <main className="flex h-[100dvh] flex-col items-center overflow-hidden px-4">
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-6 py-4">
        <div className="relative min-h-0 w-full max-w-xl flex-1">
          <Image
            src={logo}
            alt="My Karaoke Party logo"
            fill
            priority={true}
            placeholder="blur"
            sizes="(max-width: 640px) 100vw, 36rem"
            className="object-contain"
          />
        </div>

        <CreateParty />

        <div className="shrink-0 space-x-4">
          <Link href="/terms-of-service" className="hover:underline">
            Terms of Service
          </Link>
          <Link href="/privacy-policy" className="hover:underline">
            Privacy Policy
          </Link>
        </div>
      </div>
    </main>
  );
}
